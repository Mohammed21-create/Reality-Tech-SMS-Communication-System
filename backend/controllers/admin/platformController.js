'use strict';
const os = require('os');
const mongoose = require('mongoose');
const { School, Parent, SmsMessage, AuditLog, PlatformSettings, Session } = require('../../models');
const { getRedis } = require('../../config/redis');
const { queueStats } = require('../../queues');
const { pendingStats } = require('../../queues/fairScheduler');
const asyncHandler = require('../../utils/asyncHandler');
const v = require('../../utils/validate');
const { parsePagination, pageResult } = require('../../utils/pagination');
const { audit } = require('../../utils/audit');
const { withTimeout } = require('../../utils/timeout');
const { listProviders } = require('../../services/sms');

exports.overview = asyncHandler(async (req, res) => {
  const { from, to } = v.dateRange(req.query, { defaultDays: 30 });
  const skip = { skipTenantGuard: true };
  const [schoolsByStatus, parents, totals, daily, top] = await Promise.all([
    School.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    Parent.estimatedDocumentCount(),
    SmsMessage.aggregate([{ $group: { _id: null, messages: { $sum: 1 }, recipients: { $sum: '$counts.total' }, accepted: { $sum: '$counts.acceptedTotal' }, delivered: { $sum: '$counts.delivered' }, failed: { $sum: '$counts.failed' }, uncertain: { $sum: '$counts.uncertain' }, queued: { $sum: { $add: ['$counts.queued', '$counts.sending'] } }, segments: { $sum: { $multiply: ['$counts.acceptedTotal', '$segmentsPerMessage'] } } } }]).option(skip),
    SmsMessage.aggregate([{ $match: { createdAt: { $gte: from, $lte: to } } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, accepted: { $sum: '$counts.acceptedTotal' }, delivered: { $sum: '$counts.delivered' }, failed: { $sum: '$counts.failed' } } }, { $sort: { _id: 1 } }]).option(skip),
    SmsMessage.aggregate([{ $match: { createdAt: { $gte: from, $lte: to } } }, { $group: { _id: '$schoolId', accepted: { $sum: '$counts.acceptedTotal' }, delivered: { $sum: '$counts.delivered' }, failed: { $sum: '$counts.failed' }, messages: { $sum: 1 } } }, { $sort: { accepted: -1 } }, { $limit: 8 }]).option(skip),
  ]);
  const names = await School.find({ _id: { $in: top.map((t) => t._id) } }).select('name').lean();
  const nm = new Map(names.map((n) => [String(n._id), n.name]));
  const t = totals[0] || {}; delete t._id;
  const byStatus = Object.fromEntries(schoolsByStatus.map((s) => [s._id, s.n]));
  res.json({
    schools: { total: Object.values(byStatus).reduce((a, b) => a + b, 0), ...byStatus }, parents,
    sms: { messages: 0, recipients: 0, accepted: 0, delivered: 0, failed: 0, uncertain: 0, queued: 0, segments: 0, ...t },
    daily: daily.map((d) => ({ date: d._id, accepted: d.accepted, delivered: d.delivered, failed: d.failed })),
    topSchools: top.map((x) => ({ schoolId: x._id, name: nm.get(String(x._id)) || 'Unknown', accepted: x.accepted, delivered: x.delivered, failed: x.failed, messages: x.messages })),
  });
});

exports.health = asyncHandler(async (req, res) => {
  // Every check has its own timeout, so one dead dependency can never make this page hang.
  const out = { time: new Date(), uptimeSeconds: Math.round(process.uptime()), node: process.version };
  const T = (p, label, ms = 3000) => withTimeout(p, ms, label);
  const checkMongo = async () => {
    const t0 = Date.now();
    try { await T(mongoose.connection.db.admin().ping(), 'MongoDB ping'); out.mongo = { ok: true, latencyMs: Date.now() - t0, state: mongoose.connection.readyState }; } catch (e) { out.mongo = { ok: false, error: e.message }; }
  };
  const checkRedis = async () => {
    const t1 = Date.now();
    try {
      await T(getRedis().ping(), 'Redis ping');
      const info = await T(getRedis().info('memory'), 'Redis info');
      const used = /used_memory:(\d+)/.exec(info); const max = /maxmemory:(\d+)/.exec(info);
      out.redis = { ok: true, latencyMs: Date.now() - t1, usedMemoryMb: used ? Math.round(used[1] / 1048576) : null, maxMemoryMb: max && Number(max[1]) ? Math.round(max[1] / 1048576) : null };
    } catch (e) { out.redis = { ok: false, error: `Cannot reach Redis (${e.message}). Check REDIS_URL and that Redis is running.` }; }
  };
  const checkQueues = async () => {
    if (!out.redis || !out.redis.ok) { out.queues = { error: 'Redis unavailable' }; return; }
    try { out.queues = await T(queueStats(), 'queue stats'); out.fairScheduler = await T(pendingStats(), 'scheduler stats'); } catch (e) { out.queues = { error: e.message }; }
  };
  const checkStorage = async () => {
    try {
      const st = await T(mongoose.connection.db.stats(), 'MongoDB stats');
      out.storage = { dataSizeMb: Number((st.dataSize / 1048576).toFixed(1)), storageSizeMb: Number((st.storageSize / 1048576).toFixed(1)), indexSizeMb: Number((st.indexSize / 1048576).toFixed(1)), collections: st.collections };
    } catch { out.storage = null; }
  };
  const checkCounts = async () => {
    try {
      out.activeSessions = await T(Session.estimatedDocumentCount(), 'sessions count');
      out.failedMessages24h = await T(SmsMessage.countDocuments({ status: 'failed', createdAt: { $gte: new Date(Date.now() - 24 * 3600 * 1000) } }).setOptions({ skipTenantGuard: true }), 'failed count');
    } catch { out.activeSessions = 0; out.failedMessages24h = 0; }
  };
  await Promise.all([checkMongo(), checkRedis().then(checkQueues), checkStorage(), checkCounts()]);
  const mem = process.memoryUsage();
  out.server = { rssMb: Math.round(mem.rss / 1048576), heapUsedMb: Math.round(mem.heapUsed / 1048576), loadAvg: os.loadavg().map((n) => Number(n.toFixed(2))), cpus: os.cpus().length, totalMemMb: Math.round(os.totalmem() / 1048576), freeMemMb: Math.round(os.freemem() / 1048576) };
  out.providers = listProviders().map((p) => p.id);
  res.json(out);
});

exports.getSettings = asyncHandler(async (req, res) => {
  const s = await PlatformSettings.get();
  res.json({ settings: { maintenanceMode: s.maintenanceMode, maintenanceMessage: s.maintenanceMessage, perSchoolMaxInflight: s.perSchoolMaxInflight, maxRecipientsPerMessage: s.maxRecipientsPerMessage, defaultTrialDays: s.defaultTrialDays } });
});

exports.updateSettings = asyncHandler(async (req, res) => {
  const b = req.body || {};
  const set = {
    maintenanceMode: v.bool(b.maintenanceMode),
    maintenanceMessage: v.str(b.maintenanceMessage, { label: 'Maintenance message', max: 300 }),
    perSchoolMaxInflight: v.int(b.perSchoolMaxInflight, { label: 'Per-school parallel batches', min: 1, max: 20 }),
    maxRecipientsPerMessage: v.int(b.maxRecipientsPerMessage, { label: 'Max recipients per message', min: 1, max: 1000000 }),
    defaultTrialDays: v.int(b.defaultTrialDays, { label: 'Default trial days', min: 1, max: 365 }),
  };
  await PlatformSettings.get();
  const s = await PlatformSettings.findOneAndUpdate({ key: 'global' }, { $set: set }, { new: true });
  await audit(req, { action: 'platform.settings_update', meta: set });
  res.json({ settings: set, updatedAt: s.updatedAt });
});

exports.logs = asyncHandler(async (req, res) => {
  const page = parsePagination(req.query, { defaultLimit: 30, maxLimit: 100 });
  const filter = {};
  if (req.query.schoolId) filter.schoolId = v.toObjectId(req.query.schoolId, 'school id');
  const action = v.str(req.query.action, { max: 60 });
  if (action) filter.action = { $regex: '^' + v.escapeRegex(action) };
  if (req.query.status === 'success' || req.query.status === 'failure') filter.status = req.query.status;
  if (req.query.from || req.query.to) { const { from, to } = v.dateRange(req.query); filter.createdAt = { $gte: from, $lte: to }; }
  const [items, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip(page.skip).limit(page.limit).lean(),
    AuditLog.countDocuments(filter),
  ]);
  const ids = [...new Set(items.filter((i) => i.schoolId).map((i) => String(i.schoolId)))];
  const schools = await School.find({ _id: { $in: ids } }).select('name').lean();
  const nm = new Map(schools.map((s) => [String(s._id), s.name]));
  res.json(pageResult(items.map((i) => ({ id: i._id, at: i.createdAt, action: i.action, status: i.status, actorType: i.actorType, actorEmail: i.actorEmail, school: i.schoolId ? nm.get(String(i.schoolId)) || String(i.schoolId) : null, targetType: i.targetType, targetId: i.targetId, ip: i.ip, meta: i.meta })), total, page));
});
