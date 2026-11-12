'use strict';
const env = require('../config/env');
const { SmsMessage, SmsRecipient, School } = require('../models');
const { enqueuePrepare } = require('../queues');
const { recompute } = require('../services/messageStats');
const { applyDeliveryUpdates } = require('../services/deliveryService');
const { loadProvider } = require('../services/providerConfigService');
const logger = require('../utils/logger');

const SKIP = { skipTenantGuard: true }; // platform job: legitimately spans all schools

/** Promote due scheduled messages. The status flip is atomic, so only one instance wins each message. */
async function schedulerTick() {
  const due = await SmsMessage.find({ status: 'scheduled', scheduledAt: { $lte: new Date() } }).setOptions(SKIP).select('_id schoolId').limit(200).lean();
  let promoted = 0;
  for (const d of due) {
    const r = await SmsMessage.updateOne({ _id: d._id, schoolId: d.schoolId, status: 'scheduled' }, { $set: { status: 'preparing' } });
    if (r.modifiedCount) { await enqueuePrepare(d.schoolId, d._id); promoted += 1; }
  }
  return promoted;
}

/** Ask providers that support it for delivery status of accepted-but-unconfirmed recipients. */
async function pollDeliveryStatus() {
  const olderThan = new Date(Date.now() - env.sms.dlrMinAgeSeconds * 1000);
  const recheck = new Date(Date.now() - 60 * 1000);
  const since = new Date(Date.now() - 3 * 24 * 3600 * 1000);
  const rows = await SmsRecipient.find({
    status: 'accepted', acceptedAt: { $lte: olderThan, $gte: since },
    $or: [{ lastStatusCheckAt: { $exists: false } }, { lastStatusCheckAt: { $lte: recheck } }],
  }).setOptions(SKIP).select('schoolId providerMessageId').limit(1000).lean();
  const bySchool = new Map();
  for (const r of rows) { const k = String(r.schoolId); if (!bySchool.has(k)) bySchool.set(k, []); bySchool.get(k).push(r); }
  let applied = 0;
  for (const [sid, list] of bySchool) {
    try {
      const school = await School.findById(sid).select('status');
      if (!school) continue;
      const loaded = await loadProvider(school._id);
      if (!loaded || !loaded.provider.supportsStatusCheck) continue;
      const ids = list.map((r) => r.providerMessageId).filter(Boolean);
      const updates = await loaded.provider.checkStatus(ids);
      await SmsRecipient.updateMany({ schoolId: school._id, providerMessageId: { $in: ids } }, { $set: { lastStatusCheckAt: new Date() } });
      applied += await applyDeliveryUpdates({ schoolId: school._id, provider: loaded.cfg.provider, updates, source: 'poll' });
    } catch (e) { logger.warn('dlr_poll_failed', { schoolId: sid, message: e.message }); }
  }
  return applied;
}

/**
 * Recipients stuck in "sending" (worker crashed mid-request) are moved to "uncertain": we cannot know if the
 * provider sent them, so they are NEVER re-sent automatically - the school decides whether to retry.
 */
async function reapStaleClaims() {
  const cutoff = new Date(Date.now() - 10 * 60 * 1000);
  const stale = await SmsRecipient.find({ status: 'sending', updatedAt: { $lte: cutoff } }).setOptions(SKIP).select('schoolId messageId').limit(5000).lean();
  if (!stale.length) return 0;
  const ids = stale.map((s) => s._id);
  await SmsRecipient.updateMany({ _id: { $in: ids }, status: 'sending', schoolId: { $in: [...new Set(stale.map((s) => s.schoolId))] } }, { $set: { status: 'uncertain', lastError: 'Worker stopped while sending; outcome unknown', retryable: false }, $unset: { claimToken: 1 } }).setOptions(SKIP);
  const msgs = new Map(stale.map((s) => [String(s.messageId), s]));
  for (const s of msgs.values()) await recompute(s.schoolId, s.messageId);
  return stale.length;
}

/** Counters are updated incrementally on the hot path; this fixes any drift. */
async function reconcileActiveMessages() {
  const active = await SmsMessage.find({ status: { $in: ['sending', 'preparing'] }, preparedAt: { $exists: true } }).setOptions(SKIP).select('_id schoolId').limit(200).lean();
  for (const m of active) await recompute(m.schoolId, m._id);
  const recent = await SmsMessage.find({ status: 'completed', completedAt: { $gte: new Date(Date.now() - 3600 * 1000) } }).setOptions(SKIP).select('_id schoolId').limit(200).lean();
  for (const m of recent) await recompute(m.schoolId, m._id);
  return active.length + recent.length;
}

async function processMaintenance(job) {
  switch (job.name) {
    case 'scheduler-tick': return schedulerTick();
    case 'dlr-poll': return pollDeliveryStatus();
    case 'reap-stale': return reapStaleClaims();
    case 'reconcile': return reconcileActiveMessages();
    default: return null;
  }
}

module.exports = { processMaintenance, schedulerTick, pollDeliveryStatus, reapStaleClaims, reconcileActiveMessages };
