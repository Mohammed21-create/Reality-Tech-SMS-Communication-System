'use strict';
const { SmsRecipient, SmsDeliveryReport } = require('../models');
const { bump, finalizeIfDone } = require('./messageStats');

/**
 * Record provider delivery receipts. A recipient is only ever marked "delivered" when the
 * provider says so; delivered recipients are never downgraded.
 * updates: [{providerMessageId, status:'delivered'|'failed', reason?, providerStatus?}]
 */
async function applyDeliveryUpdates({ schoolId, provider, updates, source }) {
  let applied = 0;
  for (const u of updates.slice(0, 1000)) {
    if (!u || !u.providerMessageId || !['delivered', 'failed'].includes(u.status)) continue;
    const rec = await SmsRecipient.findOne({ schoolId, providerMessageId: String(u.providerMessageId) }).select('_id messageId status').lean();
    if (!rec || rec.status !== 'accepted') continue; // unknown id, or already final -> ignore duplicates/out-of-order
    const now = new Date();
    const set = u.status === 'delivered'
      ? { status: 'delivered', deliveredAt: now }
      : { status: 'failed', failedAt: now, lastError: String(u.reason || 'Reported as undelivered by the provider').slice(0, 300), retryable: true };
    const r = await SmsRecipient.updateOne({ _id: rec._id, schoolId, status: 'accepted' }, { $set: set });
    if (!r.modifiedCount) continue;
    applied += 1;
    await bump(schoolId, rec.messageId, { accepted: -1, [u.status]: 1 });
    await SmsDeliveryReport.create({
      schoolId, messageId: rec.messageId, recipientId: rec._id, provider, providerMessageId: String(u.providerMessageId),
      status: u.status, providerStatus: u.providerStatus, reason: u.reason ? String(u.reason).slice(0, 300) : undefined, source,
    });
    await finalizeIfDone(schoolId, rec.messageId);
  }
  return applied;
}

module.exports = { applyDeliveryUpdates };
