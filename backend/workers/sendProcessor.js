'use strict';
const crypto = require('crypto');
const { School, SmsMessage, SmsRecipient } = require('../models');
const { loadProvider } = require('../services/providerConfigService');
const { ProviderError } = require('../services/sms/BaseProvider');
const { bump, finalizeIfDone } = require('../services/messageStats');
const fair = require('../queues/fairScheduler');
const { getQueues } = require('../queues');
const logger = require('../utils/logger');

const trunc = (s) => String(s || '').slice(0, 300);

async function releaseClaim(schoolId, messageId, claimToken, ids) {
  const r = await SmsRecipient.updateMany(
    { schoolId, messageId, claimToken, status: 'sending', ...(ids ? { _id: { $in: ids } } : {}) },
    { $set: { status: 'queued' }, $unset: { claimToken: 1 } },
  );
  if (r.modifiedCount) await bump(schoolId, messageId, { sending: -r.modifiedCount, queued: r.modifiedCount });
}

async function failClaimed(schoolId, messageId, claimToken, ids, reason, retryable) {
  const r = await SmsRecipient.updateMany(
    { schoolId, messageId, claimToken, status: 'sending', ...(ids ? { _id: { $in: ids } } : {}) },
    { $set: { status: 'failed', lastError: trunc(reason), retryable, failedAt: new Date() }, $unset: { claimToken: 1 } },
  );
  if (r.modifiedCount) await bump(schoolId, messageId, { sending: -r.modifiedCount, failed: r.modifiedCount });
}

async function applyResults(schoolId, messageId, claimToken, recipients, results) {
  const byPhone = new Map(results.map((r) => [r.to, r]));
  const ops = [];
  let accepted = 0, failed = 0, uncertain = 0;
  const now = new Date();
  for (const rec of recipients) {
    const res = byPhone.get(rec.phone);
    const base = { schoolId, _id: rec._id, claimToken, status: 'sending' };
    if (res && res.status === 'accepted') {
      accepted++;
      ops.push({ updateOne: { filter: base, update: { $set: { status: 'accepted', providerMessageId: res.providerMessageId, acceptedAt: now, retryable: false }, $unset: { claimToken: 1, lastError: 1 } } } });
    } else if (res && res.status === 'failed') {
      failed++;
      ops.push({ updateOne: { filter: base, update: { $set: { status: 'failed', lastError: trunc(res.error || 'Rejected by provider'), retryable: !!res.retryable, failedAt: now }, $unset: { claimToken: 1 } } } });
    } else {
      uncertain++; // provider gave no answer for this number: never auto-resend (could duplicate)
      ops.push({ updateOne: { filter: base, update: { $set: { status: 'uncertain', lastError: trunc((res && res.error) || 'Provider did not report an outcome'), retryable: false }, $unset: { claimToken: 1 } } } });
    }
  }
  if (ops.length) await SmsRecipient.bulkWrite(ops, { ordered: false });
  await bump(schoolId, messageId, { sending: -recipients.length, accepted, acceptedTotal: accepted, failed, uncertain });
}

async function deadLetter(job, reason) {
  await getQueues().dead.add('dead-send', { descriptor: job.data, reason: trunc(reason), failedAt: new Date().toISOString() });
}

async function handleBatch(job, finalAttempt) {
  const { s: sid, m: mid, b: batchNo } = job.data;
  const school = await School.findById(sid);
  if (!school) return { retrying: false };
  const schoolId = school._id;
  const msg = await SmsMessage.findOne({ _id: mid, schoolId });
  if (!msg) return { retrying: false };

  const claimToken = crypto.randomBytes(8).toString('hex');
  // Atomic claim: only 'queued' recipients are taken, so duplicate/retried jobs can never double-send.
  const claim = await SmsRecipient.updateMany({ schoolId, messageId: msg._id, batchNo, status: 'queued' }, { $set: { status: 'sending', claimToken }, $inc: { attempts: 1 } });
  if (!claim.modifiedCount) return { retrying: false };
  await bump(schoolId, msg._id, { queued: -claim.modifiedCount, sending: claim.modifiedCount });
  const recipients = await SmsRecipient.find({ schoolId, messageId: msg._id, claimToken, status: 'sending' }).select('phone').lean();

  if (school.status !== 'active') { await failClaimed(schoolId, msg._id, claimToken, null, 'School account is not active', true); return { retrying: false }; }
  let loaded;
  try { loaded = await loadProvider(schoolId); } catch (e) { loaded = null; logger.error('provider_load_failed', { message: e.message }); }
  if (!loaded || !loaded.cfg.isActive) { await failClaimed(schoolId, msg._id, claimToken, null, 'SMS provider is not configured or is switched off', true); return { retrying: false }; }

  const { provider } = loaded;
  const maxBatch = provider.limits.maxBatch || 100;
  for (let i = 0; i < recipients.length; i += maxBatch) {
    const chunk = recipients.slice(i, i + maxBatch);
    try {
      await fair.throttle(schoolId, chunk.length, provider.limits.maxPerSecond);
      const results = await provider.send({ recipients: chunk.map((r) => r.phone), message: msg.finalText, senderId: msg.senderId });
      await applyResults(schoolId, msg._id, claimToken, chunk, results);
    } catch (err) {
      const rest = recipients.slice(i).map((r) => r._id);
      const temporary = !(err instanceof ProviderError) || err.retryable; // unexpected errors are treated as temporary
      logger.warn('send_batch_error', { messageId: String(msg._id), batchNo, temporary, message: err.message, attempt: job.attemptsMade + 1 });
      if (!temporary) {
        await failClaimed(schoolId, msg._id, claimToken, rest, err.message, err.code === 'AUTH'); // after fixing credentials the school can retry
        return { retrying: false };
      }
      if (!finalAttempt) { await releaseClaim(schoolId, msg._id, claimToken, rest); throw err; } // BullMQ retries with exponential backoff
      await failClaimed(schoolId, msg._id, claimToken, rest, `Provider unavailable after ${job.attemptsMade + 1} attempts: ${err.message}`, true);
      await deadLetter(job, err.message);
      return { retrying: false };
    }
  }
  return { retrying: false };
}

async function processSend(job) {
  const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts || 1);
  let retrying = false;
  try {
    await handleBatch(job, finalAttempt);
  } catch (err) {
    retrying = !finalAttempt; // while BullMQ will retry, keep the school's in-flight slot
    throw err;
  } finally {
    if (!retrying) {
      await fair.releaseInflight(job.data.s).catch(() => {});
      await finalizeIfDone(job.data.s, job.data.m).catch(() => {});
    }
  }
}

module.exports = { processSend };
