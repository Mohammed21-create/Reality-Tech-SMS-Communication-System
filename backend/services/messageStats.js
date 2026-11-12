'use strict';
const mongoose = require('mongoose');
const { SmsMessage, SmsRecipient } = require('../models');
const oid = (v) => new mongoose.Types.ObjectId(String(v));

const FIELDS = ['queued', 'sending', 'accepted', 'delivered', 'failed', 'uncertain', 'cancelled'];

/** Hot-path counter update: deltas = { queued: -5, sending: +5, acceptedTotal: +3 ... } */
async function bump(schoolId, messageId, deltas) {
  const inc = {};
  for (const [k, v] of Object.entries(deltas)) if (v) inc[`counts.${k}`] = v;
  if (!Object.keys(inc).length) return;
  await SmsMessage.updateOne({ _id: messageId, schoolId }, { $inc: inc });
}

/** Mark a message completed when nothing is waiting or in flight any more. */
async function finalizeIfDone(schoolId, messageId) {
  const m = await SmsMessage.findOne({ _id: messageId, schoolId }).select('status counts').lean();
  if (!m || m.status !== 'sending') return false;
  if ((m.counts.queued || 0) > 0 || (m.counts.sending || 0) > 0) return false;
  const r = await SmsMessage.updateOne({ _id: messageId, schoolId, status: 'sending' }, { $set: { status: 'completed', completedAt: new Date() } });
  return r.modifiedCount > 0;
}

/** Authoritative recount from recipients (used after retries and by the periodic reconciler). */
async function recompute(schoolId, messageId) {
  const rows = await SmsRecipient.aggregate([
    { $match: { schoolId: oid(schoolId), messageId: oid(messageId) } },
    { $group: { _id: '$status', n: { $sum: 1 }, acc: { $sum: { $cond: [{ $ifNull: ['$acceptedAt', false] }, 1, 0] } } } },
  ]);
  const counts = { total: 0, acceptedTotal: 0 };
  FIELDS.forEach((f) => { counts[f] = 0; });
  for (const r of rows) { counts[r._id] = r.n; counts.total += r.n; counts.acceptedTotal += r.acc; }
  const set = {};
  for (const [k, v] of Object.entries(counts)) set[`counts.${k}`] = v;
  await SmsMessage.updateOne({ _id: messageId, schoolId }, { $set: set });
  await finalizeIfDone(schoolId, messageId);
  return counts;
}

module.exports = { bump, finalizeIfDone, recompute };
