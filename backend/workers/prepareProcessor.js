'use strict';
const env = require('../config/env');
const { School, Parent, SmsMessage, SmsRecipient, SmsProviderConfig } = require('../models');
const fair = require('../queues/fairScheduler');
const { recompute } = require('../services/messageStats');
const logger = require('../utils/logger');

async function failMessage(schoolId, messageId, reason) {
  await SmsMessage.updateOne({ _id: messageId, schoolId }, { $set: { status: 'failed', lastError: reason, completedAt: new Date() } });
  logger.warn('message_failed_prepare', { messageId: String(messageId), reason });
}

async function insertChunk(rows) {
  if (!rows.length) return;
  try {
    await SmsRecipient.insertMany(rows, { ordered: false });
  } catch (e) {
    // Re-running a half-finished job hits the unique (messageId, phone) index: that is expected and safe.
    const writeErrors = e.writeErrors || (e.result && e.result.result && e.result.result.writeErrors) || [];
    const onlyDup = e.code === 11000 || (writeErrors.length && writeErrors.every((w) => (w.code || (w.err && w.err.code)) === 11000));
    if (!onlyDup) throw e;
  }
}

/** Builds the recipient list (one row per unique phone), assigns batch numbers, hands batches to the fair scheduler. */
async function processPrepare(job) {
  const { schoolId: sid, messageId: mid } = job.data;
  const school = await School.findById(sid);
  const msg = await SmsMessage.findOne({ _id: mid, schoolId: school ? school._id : sid });
  if (!school || !msg) return;
  const schoolId = school._id;
  if (msg.status !== 'preparing' || msg.preparedAt) return; // idempotent: already prepared, cancelled, or done
  if (school.status !== 'active') return failMessage(schoolId, msg._id, 'School account is not active');
  const cfg = await SmsProviderConfig.findOne({ schoolId });
  if (!cfg || !cfg.isActive) return failMessage(schoolId, msg._id, 'SMS provider is not configured or is switched off');

  const filter = { schoolId, status: 'active' };
  if (msg.audience.kind === 'selected') filter._id = { $in: msg.audience.parentIds };

  const seen = new Set();
  let buffer = [];
  let index = 0;
  const cursor = Parent.find(filter).select('fullName phones').lean().cursor();
  for await (const parent of cursor) {
    for (const ph of parent.phones) {
      if (seen.has(ph.number)) continue;
      seen.add(ph.number);
      buffer.push({
        schoolId, messageId: msg._id, parentId: parent._id, parentName: parent.fullName, phone: ph.number,
        batchNo: Math.floor(index / env.sms.batchSize) + 1, status: 'queued',
      });
      index += 1;
      if (buffer.length >= 1000) { await insertChunk(buffer); buffer = []; }
    }
  }
  await insertChunk(buffer);
  if (index === 0) return failMessage(schoolId, msg._id, 'No recipients');

  const last = await SmsRecipient.findOne({ schoolId, messageId: msg._id }).sort({ batchNo: -1 }).select('batchNo').lean();
  const batchCount = last.batchNo;
  await SmsMessage.updateOne({ _id: msg._id, schoolId }, { $set: { batchCount } });
  await recompute(schoolId, msg._id); // sets counts.total / queued from the database

  const descriptors = [];
  for (let b = 1; b <= batchCount; b++) descriptors.push({ s: String(schoolId), m: String(msg._id), b, r: 0 });
  await fair.pushBatches(schoolId, descriptors);
  await SmsMessage.updateOne({ _id: msg._id, schoolId, status: 'preparing' }, { $set: { status: 'sending', startedAt: new Date(), preparedAt: new Date() } });
  logger.info('message_prepared', { messageId: String(msg._id), recipients: index, batches: batchCount });
}

module.exports = { processPrepare };
