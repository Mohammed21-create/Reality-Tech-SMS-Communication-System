'use strict';
const ExcelJS = require('exceljs');
const { Parent, Student, SmsMessage, SchoolSettings } = require('../../models');
const asyncHandler = require('../../utils/asyncHandler');
const v = require('../../utils/validate');
const { toCsv, safeCell } = require('../../utils/csv');
const { messageDto } = require('../../services/messageService');
const { audit } = require('../../utils/audit');

const sumCounts = {
  messages: { $sum: 1 },
  recipients: { $sum: '$counts.total' },
  accepted: { $sum: '$counts.acceptedTotal' },
  delivered: { $sum: '$counts.delivered' },
  failed: { $sum: '$counts.failed' },
  uncertain: { $sum: '$counts.uncertain' },
  queued: { $sum: { $add: ['$counts.queued', '$counts.sending'] } },
  awaitingDelivery: { $sum: '$counts.accepted' },
  segments: { $sum: { $multiply: ['$counts.acceptedTotal', '$segmentsPerMessage'] } },
  cost: { $sum: { $multiply: ['$counts.acceptedTotal', '$segmentsPerMessage', { $ifNull: ['$costPerSegment', 0] }] } },
};

async function timezone(schoolId) {
  const s = await SchoolSettings.findOne({ schoolId }).select('timezone').lean();
  return (s && s.timezone) || 'Africa/Accra';
}

async function summarize(schoolId, from, to) {
  const tz = await timezone(schoolId);
  const match = { schoolId, createdAt: { $gte: from, $lte: to }, status: { $ne: 'cancelled' } };
  const [tot, daily] = await Promise.all([
    SmsMessage.aggregate([{ $match: match }, { $group: { _id: null, ...sumCounts } }]),
    SmsMessage.aggregate([
      { $match: match },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: tz } }, ...sumCounts } },
      { $sort: { _id: 1 } },
    ]),
  ]);
  const t = tot[0] || { messages: 0, recipients: 0, accepted: 0, delivered: 0, failed: 0, uncertain: 0, queued: 0, awaitingDelivery: 0, segments: 0, cost: 0 };
  delete t._id;
  return {
    totals: {
      ...t, cost: Number((t.cost || 0).toFixed(4)),
      // "accepted" = taken by the provider; "delivered" = confirmed by delivery receipt.
      deliveryRate: t.accepted ? Number(((t.delivered / t.accepted) * 100).toFixed(1)) : null,
    },
    daily: daily.map((d) => ({ date: d._id, messages: d.messages, accepted: d.accepted, delivered: d.delivered, failed: d.failed, segments: d.segments, cost: Number((d.cost || 0).toFixed(4)) })),
  };
}

exports.dashboard = asyncHandler(async (req, res) => {
  const schoolId = req.tenantId;
  const to = new Date(); const from = new Date(to.getTime() - 14 * 24 * 3600 * 1000);
  const [parents, students, all, recent, scheduled, last14] = await Promise.all([
    Parent.countDocuments({ schoolId }),
    Student.countDocuments({ schoolId }),
    SmsMessage.aggregate([{ $match: { schoolId, status: { $ne: 'cancelled' } } }, { $group: { _id: null, ...sumCounts } }]),
    SmsMessage.find({ schoolId }).sort({ createdAt: -1 }).limit(6).lean(),
    SmsMessage.countDocuments({ schoolId, status: 'scheduled' }),
    summarize(schoolId, from, to),
  ]);
  const t = all[0] || {};
  res.json({
    parents, students, scheduledMessages: scheduled,
    sms: {
      messages: t.messages || 0, recipients: t.recipients || 0, accepted: t.accepted || 0, delivered: t.delivered || 0,
      failed: (t.failed || 0) + (t.uncertain || 0), pending: t.queued || 0, awaitingDelivery: t.awaitingDelivery || 0,
      segments: t.segments || 0, estimatedCost: Number((t.cost || 0).toFixed(4)),
    },
    daily: last14.daily,
    recent: recent.map(messageDto),
  });
});

exports.summary = asyncHandler(async (req, res) => {
  const { from, to } = v.dateRange(req.query);
  res.json({ from, to, ...(await summarize(req.tenantId, from, to)) });
});

exports.exportReport = asyncHandler(async (req, res) => {
  const { from, to } = v.dateRange(req.query);
  const format = req.query.format === 'xlsx' ? 'xlsx' : 'csv';
  const msgs = await SmsMessage.find({ schoolId: req.tenantId, createdAt: { $gte: from, $lte: to } }).sort({ createdAt: -1 }).limit(20000).lean();
  const headers = ['Date', 'Status', 'Message', 'Recipients', 'Accepted by provider', 'Delivered (confirmed)', 'Failed', 'Unknown outcome', 'Segments used', 'Estimated cost', 'Currency', 'Sent by'];
  const rows = msgs.map((m) => {
    const c = m.counts || {};
    const segs = (c.acceptedTotal || 0) * m.segmentsPerMessage;
    return [m.createdAt.toISOString(), m.status, m.body, c.total || 0, c.acceptedTotal || 0, c.delivered || 0, c.failed || 0, c.uncertain || 0, segs, Number((segs * (m.costPerSegment || 0)).toFixed(4)), m.currency, m.createdByName || ''];
  });
  await audit(req, { action: 'report.export', meta: { format, rows: rows.length } });
  if (format === 'csv') {
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="sms-report.csv"' });
    return res.send(toCsv(headers, rows));
  }
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('SMS report');
  ws.addRow(headers).font = { bold: true };
  rows.forEach((r) => ws.addRow(r.map(safeCell)));
  ws.columns.forEach((c, i) => { c.width = i === 2 ? 50 : 18; });
  res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="sms-report.xlsx"' });
  await wb.xlsx.write(res);
  return res.end();
});
