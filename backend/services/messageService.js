'use strict';
const mongoose = require('mongoose');
const env = require('../config/env');
const { Parent, SmsMessage, SmsRecipient, PlatformSettings } = require('../models');
const { analyzeSms, composeFinalText } = require('../utils/smsSegments');
const { assertReadyToSend } = require('./providerConfigService');
const { enqueuePrepare } = require('../queues');
const fair = require('../queues/fairScheduler');
const { recompute } = require('./messageStats');
const { E } = require('../utils/errors');
const v = require('../utils/validate');

/** Unique recipient phone numbers for an audience (one SMS per number). */
async function countAudience(schoolId, audience) {
  const match = { schoolId, status: 'active' };
  if (audience.kind === 'selected') match._id = { $in: audience.parentIds };
  const rows = await Parent.aggregate([
    { $match: match },
    { $unwind: '$phones' },
    { $group: { _id: '$phones.number' } },
    { $count: 'n' },
  ]);
  return rows.length ? rows[0].n : 0;
}

async function parseAudience(schoolId, raw) {
  const kind = v.oneOf(raw && raw.type, ['all', 'selected'], 'Audience');
  if (kind === 'all') return { kind };
  const ids = Array.isArray(raw.parentIds) ? raw.parentIds : [];
  if (!ids.length) throw E.badRequest('Select at least one parent');
  if (ids.length > 5000) throw E.badRequest('You can select at most 5000 parents. Use "All parents" for bigger sends.');
  const parentIds = [...new Set(ids.map((i) => v.toObjectId(i, 'parent id').toString()))].map((i) => new mongoose.Types.ObjectId(i));
  const owned = await Parent.countDocuments({ schoolId, _id: { $in: parentIds } });
  if (owned !== parentIds.length) throw E.badRequest('Some selected parents were not found');
  return { kind, parentIds };
}

function parseText(body, settings) {
  const text = v.str(body.body, { label: 'Message', required: true, max: 1000 });
  const includeSignature = body.includeSignature === undefined ? settings.appendSignatureByDefault : v.bool(body.includeSignature);
  const finalText = composeFinalText(text, settings.signature, includeSignature);
  const a = analyzeSms(finalText);
  if (a.segments > 10) throw E.badRequest('Message is too long (more than 10 SMS segments). Please shorten it.');
  return { text, includeSignature, finalText, analysis: a };
}

async function preview(schoolId, body) {
  const { cfg, settings } = await assertReadyToSend(schoolId);
  const { finalText, analysis } = parseText(body, settings);
  const audience = await parseAudience(schoolId, body.audience);
  const recipients = await countAudience(schoolId, audience);
  return {
    finalText, encoding: analysis.encoding, characters: analysis.characters, segmentsPerMessage: analysis.segments,
    recipients, totalSegments: recipients * analysis.segments,
    costPerSegment: cfg.costPerSegment, currency: cfg.currency,
    estimatedCost: Number((recipients * analysis.segments * cfg.costPerSegment).toFixed(4)),
    senderId: settings.preferredSenderId, provider: cfg.provider,
    note: 'Cost is an estimate from the rate you entered in Settings. Your provider\'s own billing is final.',
  };
}

async function create({ schoolId, user, body }) {
  const platform = await PlatformSettings.get();
  if (platform.maintenanceMode) throw E.badRequest(platform.maintenanceMessage || 'Sending is temporarily paused for maintenance.', undefined, 'MAINTENANCE');
  if (body.confirm !== true) throw E.badRequest('Please confirm before sending.', undefined, 'CONFIRMATION_REQUIRED');

  const { cfg, settings } = await assertReadyToSend(schoolId);
  const t = parseText(body, settings);
  const audience = await parseAudience(schoolId, body.audience);

  const idempotencyKey = body.idempotencyKey ? v.str(body.idempotencyKey, { label: 'Idempotency key', max: 80 }) : undefined;
  if (idempotencyKey) {
    const dup = await SmsMessage.findOne({ schoolId, idempotencyKey });
    if (dup) return { message: dup, duplicate: true };
  }

  const recipients = await countAudience(schoolId, audience);
  if (recipients === 0) throw E.badRequest('There are no active parents with phone numbers to send to.', undefined, 'NO_RECIPIENTS');
  if (recipients > platform.maxRecipientsPerMessage) throw E.badRequest(`A single message can reach at most ${platform.maxRecipientsPerMessage} recipients.`);
  if (body.expectedRecipients !== undefined && Number(body.expectedRecipients) !== recipients) {
    throw E.conflict('The number of recipients changed since you previewed. Please review and confirm again.', { recipients }, 'RECIPIENT_COUNT_CHANGED');
  }

  let scheduledAt = v.date(body.scheduledAt, 'Schedule time');
  if (scheduledAt) {
    const now = Date.now();
    if (scheduledAt.getTime() < now + 60 * 1000) throw E.badRequest('Scheduled time must be at least one minute in the future.');
    if (scheduledAt.getTime() > now + 365 * 24 * 3600 * 1000) throw E.badRequest('Scheduled time must be within one year.');
  }

  let message;
  try {
    message = await SmsMessage.create({
      schoolId, createdBy: user._id, createdByName: user.name,
      body: t.text, finalText: t.finalText, includeSignature: t.includeSignature,
      encoding: t.analysis.encoding, segmentsPerMessage: t.analysis.segments,
      audience, senderId: settings.preferredSenderId, provider: cfg.provider,
      costPerSegment: cfg.costPerSegment, currency: cfg.currency, estimatedRecipients: recipients,
      status: scheduledAt ? 'scheduled' : 'preparing', scheduledAt: scheduledAt || undefined,
      idempotencyKey,
    });
  } catch (e) {
    if (e.code === 11000 && idempotencyKey) return { message: await SmsMessage.findOne({ schoolId, idempotencyKey }), duplicate: true };
    throw e;
  }
  if (!scheduledAt) await enqueuePrepare(schoolId, message._id);
  return { message, duplicate: false };
}

async function cancelScheduled(schoolId, messageId) {
  const m = await SmsMessage.findOneAndUpdate({ _id: messageId, schoolId, status: 'scheduled' }, { $set: { status: 'cancelled', cancelledAt: new Date() } }, { new: true });
  if (!m) {
    const exists = await SmsMessage.exists({ _id: messageId, schoolId });
    if (!exists) throw E.notFound('Message not found');
    throw E.conflict('This message can no longer be cancelled because processing has already started.', undefined, 'CANNOT_CANCEL');
  }
  return m;
}

/**
 * Re-queue recipients that failed with a retryable reason. Recipients are re-claimed atomically
 * (status failed -> queued) so repeated clicks cannot create duplicate sends; "uncertain" recipients
 * (we could not tell whether the provider sent them) are only retried when explicitly requested.
 */
async function retryFailed({ schoolId, messageId, includeUncertain }) {
  const msg = await SmsMessage.findOne({ _id: messageId, schoolId });
  if (!msg) throw E.notFound('Message not found');
  if (!['completed', 'failed'].includes(msg.status)) throw E.conflict('You can retry once the message has finished processing.', undefined, 'NOT_FINISHED');
  const lock = await SmsMessage.findOneAndUpdate({ _id: messageId, schoolId, status: { $in: ['completed', 'failed'] } }, { $set: { status: 'sending' }, $inc: { retryCount: 1 } }, { new: true });
  if (!lock) throw E.conflict('A retry is already in progress.', undefined, 'RETRY_IN_PROGRESS');

  const eligible = [{ status: 'failed', retryable: true }];
  if (includeUncertain) eligible.push({ status: 'uncertain' });
  const cursor = SmsRecipient.find({ schoolId, messageId, $or: eligible }).select('_id').lean().cursor();
  let batchNo = lock.batchCount;
  let chunk = [];
  const descriptors = [];
  let requeued = 0;
  const flush = async () => {
    if (!chunk.length) return;
    batchNo += 1;
    const r = await SmsRecipient.updateMany(
      { schoolId, messageId, _id: { $in: chunk }, $or: eligible },
      { $set: { status: 'queued', batchNo, retryable: false }, $unset: { claimToken: 1, lastError: 1 } },
    );
    if (r.modifiedCount) { descriptors.push({ s: String(schoolId), m: String(messageId), b: batchNo, r: lock.retryCount }); requeued += r.modifiedCount; }
    chunk = [];
  };
  for await (const doc of cursor) { chunk.push(doc._id); if (chunk.length >= env.sms.batchSize) await flush(); }
  await flush();

  await SmsMessage.updateOne({ _id: messageId, schoolId }, { $set: { batchCount: batchNo } });
  await recompute(schoolId, messageId);
  if (!descriptors.length) {
    await SmsMessage.updateOne({ _id: messageId, schoolId }, { $set: { status: 'completed', completedAt: new Date() }, $inc: { retryCount: -1 } });
    return { requeued: 0 };
  }
  await fair.pushBatches(schoolId, descriptors);
  return { requeued };
}

const messageDto = (m) => ({
  id: m._id, body: m.body, finalText: m.finalText, status: m.status, encoding: m.encoding,
  segmentsPerMessage: m.segmentsPerMessage, senderId: m.senderId, provider: m.provider,
  audienceType: m.audience && m.audience.kind, scheduledAt: m.scheduledAt, createdAt: m.createdAt,
  startedAt: m.startedAt, completedAt: m.completedAt, createdByName: m.createdByName,
  estimatedRecipients: m.estimatedRecipients, counts: m.counts, retryCount: m.retryCount, lastError: m.lastError,
  costPerSegment: m.costPerSegment, currency: m.currency,
  estimatedCost: Number(((m.counts && m.counts.acceptedTotal ? m.counts.acceptedTotal : 0) * m.segmentsPerMessage * (m.costPerSegment || 0)).toFixed(4)),
});

module.exports = { preview, create, cancelScheduled, retryFailed, countAudience, messageDto };
