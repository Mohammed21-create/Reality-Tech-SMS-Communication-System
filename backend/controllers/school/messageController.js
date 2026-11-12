'use strict';
const { SmsMessage, SmsRecipient } = require('../../models');
const svc = require('../../services/messageService');
const asyncHandler = require('../../utils/asyncHandler');
const { E } = require('../../utils/errors');
const v = require('../../utils/validate');
const { parsePagination, pageResult } = require('../../utils/pagination');
const { toCsv } = require('../../utils/csv');
const { audit } = require('../../utils/audit');

exports.preview = asyncHandler(async (req, res) => {
  res.json(await svc.preview(req.tenantId, req.body || {}));
});

exports.create = asyncHandler(async (req, res) => {
  const { message, duplicate } = await svc.create({ schoolId: req.tenantId, user: req.user, body: req.body || {} });
  if (!duplicate) {
    await audit(req, {
      action: message.status === 'scheduled' ? 'sms.schedule' : 'sms.send', targetType: 'SmsMessage', targetId: message._id,
      meta: { recipients: message.estimatedRecipients, segments: message.segmentsPerMessage, scheduledAt: message.scheduledAt },
    });
  }
  res.status(duplicate ? 200 : 201).json({ message: svc.messageDto(message), duplicate });
});

exports.list = asyncHandler(async (req, res) => {
  const page = parsePagination(req.query);
  const filter = { schoolId: req.tenantId };
  const status = v.str(req.query.status, { max: 20 });
  if (status) filter.status = v.oneOf(status, ['scheduled', 'preparing', 'sending', 'completed', 'cancelled', 'failed'], 'Status');
  const q = v.str(req.query.q, { max: 80 });
  if (q) filter.body = { $regex: v.escapeRegex(q), $options: 'i' };
  if (req.query.from || req.query.to) {
    const { from, to } = v.dateRange(req.query);
    filter.createdAt = { $gte: from, $lte: to };
  }
  const [items, total] = await Promise.all([
    SmsMessage.find(filter).sort({ createdAt: -1 }).skip(page.skip).limit(page.limit).lean(),
    SmsMessage.countDocuments(filter),
  ]);
  res.json(pageResult(items.map(svc.messageDto), total, page));
});

async function load(req) {
  const m = await SmsMessage.findOne({ _id: v.toObjectId(req.params.id), schoolId: req.tenantId }).lean();
  if (!m) throw E.notFound('Message not found');
  return m;
}

exports.get = asyncHandler(async (req, res) => res.json({ message: svc.messageDto(await load(req)) }));

exports.recipients = asyncHandler(async (req, res) => {
  const m = await load(req);
  const page = parsePagination(req.query, { defaultLimit: 25, maxLimit: 200 });
  const filter = { schoolId: req.tenantId, messageId: m._id };
  if (req.query.status) filter.status = v.oneOf(req.query.status, SmsRecipient.STATUSES, 'Status');
  const q = v.str(req.query.q, { max: 40 });
  if (q) filter.$or = [{ phone: { $regex: v.escapeRegex(q.replace(/^0/, '')) } }, { parentName: { $regex: v.escapeRegex(q), $options: 'i' } }];
  const [items, total] = await Promise.all([
    SmsRecipient.find(filter).sort({ _id: 1 }).skip(page.skip).limit(page.limit).lean(),
    SmsRecipient.countDocuments(filter),
  ]);
  res.json(pageResult(items.map((r) => ({
    id: r._id, parentName: r.parentName, phone: r.phone, status: r.status, attempts: r.attempts, lastError: r.lastError,
    retryable: r.retryable, acceptedAt: r.acceptedAt, deliveredAt: r.deliveredAt, failedAt: r.failedAt,
  })), total, page));
});

exports.cancel = asyncHandler(async (req, res) => {
  const m = await svc.cancelScheduled(req.tenantId, v.toObjectId(req.params.id));
  await audit(req, { action: 'sms.cancel', targetType: 'SmsMessage', targetId: m._id });
  res.json({ message: svc.messageDto(m) });
});

exports.retry = asyncHandler(async (req, res) => {
  const result = await svc.retryFailed({ schoolId: req.tenantId, messageId: v.toObjectId(req.params.id), includeUncertain: v.bool(req.body && req.body.includeUncertain) });
  await audit(req, { action: 'sms.retry', targetType: 'SmsMessage', targetId: req.params.id, meta: result });
  res.json(result);
});

exports.exportRecipients = asyncHandler(async (req, res) => {
  const m = await load(req);
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="message-${m._id}-recipients.csv"` });
  const rows = [];
  const cursor = SmsRecipient.find({ schoolId: req.tenantId, messageId: m._id }).sort({ _id: 1 }).lean().cursor();
  const { cell } = require('../../utils/csv');
  res.write('\uFEFF' + ['Parent', 'Phone', 'Status', 'Accepted at', 'Delivered at', 'Error'].join(',') + '\r\n');
  for await (const r of cursor) res.write([r.parentName, r.phone, r.status, r.acceptedAt, r.deliveredAt, r.lastError].map(cell).join(',') + '\r\n');
  void rows; void toCsv;
  res.end();
});
