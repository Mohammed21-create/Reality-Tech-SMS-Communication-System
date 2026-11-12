'use strict';
const { School, User, Session, SchoolSettings, SmsProviderConfig, Parent, SmsMessage, PlatformSettings } = require('../../models');
const asyncHandler = require('../../utils/asyncHandler');
const { E } = require('../../utils/errors');
const v = require('../../utils/validate');
const { parsePagination, pageResult } = require('../../utils/pagination');
const { hashPassword, generateTempPassword } = require('../../utils/password');
const { audit } = require('../../utils/audit');

const STATUSES = ['pending', 'active', 'suspended', 'deactivated'];

const dto = (s, extra = {}) => ({
  id: s._id, name: s.name, status: s.status, statusReason: s.statusReason, contactEmail: s.contactEmail, contactPhone: s.contactPhone,
  address: s.address, region: s.region, subscription: s.subscription, notes: s.notes, createdAt: s.createdAt, ...extra,
});

exports.list = asyncHandler(async (req, res) => {
  const page = parsePagination(req.query);
  const filter = {};
  if (req.query.status) filter.status = v.oneOf(req.query.status, STATUSES, 'Status');
  const q = v.str(req.query.q, { max: 80 });
  if (q) filter.name = { $regex: v.escapeRegex(q), $options: 'i' };
  const [items, total] = await Promise.all([
    School.find(filter).sort({ createdAt: -1 }).skip(page.skip).limit(page.limit).lean(),
    School.countDocuments(filter),
  ]);
  const ids = items.map((s) => s._id);
  const [parents, msgs] = await Promise.all([
    Parent.aggregate([{ $match: { schoolId: { $in: ids } } }, { $group: { _id: '$schoolId', n: { $sum: 1 } } }]).option({ skipTenantGuard: true }),
    SmsMessage.aggregate([{ $match: { schoolId: { $in: ids } } }, { $group: { _id: '$schoolId', messages: { $sum: 1 }, accepted: { $sum: '$counts.acceptedTotal' }, delivered: { $sum: '$counts.delivered' } } }]).option({ skipTenantGuard: true }),
  ]);
  const pm = new Map(parents.map((p) => [String(p._id), p.n]));
  const mm = new Map(msgs.map((m) => [String(m._id), m]));
  res.json(pageResult(items.map((s) => dto(s, {
    parents: pm.get(String(s._id)) || 0,
    messages: (mm.get(String(s._id)) || {}).messages || 0,
    accepted: (mm.get(String(s._id)) || {}).accepted || 0,
    delivered: (mm.get(String(s._id)) || {}).delivered || 0,
  })), total, page));
});

exports.create = asyncHandler(async (req, res) => {
  const b = req.body || {};
  const name = v.str(b.name, { label: 'School name', required: true, min: 2, max: 150 });
  const adminName = v.str(b.adminName, { label: 'Administrator name', required: true, min: 2, max: 120 });
  const adminEmail = v.email(b.adminEmail, 'Administrator email');
  const status = v.oneOf(b.status, ['pending', 'active'], 'Status', 'active');
  if (await School.exists({ nameLower: name.toLowerCase().replace(/\s+/g, ' ') })) throw E.conflict('A school with this name already exists', undefined, 'DUPLICATE_SCHOOL');
  if (await User.exists({ email: adminEmail })) throw E.conflict('That email address is already in use', undefined, 'DUPLICATE_EMAIL');
  const platform = await PlatformSettings.get();
  const trialEnds = new Date(Date.now() + platform.defaultTrialDays * 24 * 3600 * 1000);

  const school = await School.create({
    name, status, statusChangedAt: new Date(),
    contactEmail: b.contactEmail ? v.email(b.contactEmail, 'Contact email') : '',
    contactPhone: v.str(b.contactPhone, { label: 'Contact phone', max: 30 }),
    address: v.str(b.address, { label: 'Address', max: 300 }), region: v.str(b.region, { label: 'Region', max: 80 }),
    subscription: { plan: v.oneOf(b.plan, ['trial', 'standard', 'premium'], 'Plan', 'trial'), status: 'trial', expiresAt: trialEnds },
    createdBy: req.user._id,
  });
  const tempPassword = generateTempPassword();
  try {
    await User.create({ email: adminEmail, name: adminName, role: 'school_admin', schoolId: school._id, passwordHash: await hashPassword(tempPassword), mustChangePassword: true });
    await SchoolSettings.create({ schoolId: school._id, displayName: name, contactEmail: school.contactEmail, contactPhone: school.contactPhone, address: school.address, signature: `- ${name}` });
  } catch (e) {
    await School.deleteOne({ _id: school._id }); await User.deleteMany({ schoolId: school._id }); await SchoolSettings.deleteMany({ schoolId: school._id });
    throw e;
  }
  await audit(req, { action: 'school.create', schoolId: school._id, targetType: 'School', targetId: school._id, meta: { name, status } });
  // The temporary password is returned ONCE and never stored in plain text.
  res.status(201).json({ school: dto(school), admin: { email: adminEmail, name: adminName, temporaryPassword: tempPassword } });
});

exports.get = asyncHandler(async (req, res) => {
  const id = v.toObjectId(req.params.id);
  const school = await School.findById(id).lean();
  if (!school) throw E.notFound('School not found');
  const [admins, parents, cfg, totals] = await Promise.all([
    User.find({ schoolId: id }).select('name email status lastLoginAt mustChangePassword lockUntil').lean(),
    Parent.countDocuments({ schoolId: id }),
    SmsProviderConfig.findOne({ schoolId: id }).select('provider isActive lastTestOk lastTestAt').lean(),
    SmsMessage.aggregate([{ $match: { schoolId: id } }, { $group: { _id: null, messages: { $sum: 1 }, recipients: { $sum: '$counts.total' }, accepted: { $sum: '$counts.acceptedTotal' }, delivered: { $sum: '$counts.delivered' }, failed: { $sum: '$counts.failed' }, segments: { $sum: { $multiply: ['$counts.acceptedTotal', '$segmentsPerMessage'] } } } }]).option({ skipTenantGuard: true }),
  ]);
  const t = totals[0] || {}; delete t._id;
  res.json({
    school: dto(school, { parents }),
    admins: admins.map((a) => ({ id: a._id, name: a.name, email: a.email, status: a.status, lastLoginAt: a.lastLoginAt, mustChangePassword: a.mustChangePassword, locked: !!(a.lockUntil && a.lockUntil > new Date()) })),
    provider: cfg ? { provider: cfg.provider, isActive: cfg.isActive, lastTestOk: cfg.lastTestOk, lastTestAt: cfg.lastTestAt } : null, // never credentials
    usage: t,
  });
});

exports.update = asyncHandler(async (req, res) => {
  const b = req.body || {};
  const school = await School.findById(v.toObjectId(req.params.id));
  if (!school) throw E.notFound('School not found');
  if (b.name !== undefined) {
    const name = v.str(b.name, { label: 'School name', required: true, min: 2, max: 150 });
    const clash = await School.findOne({ nameLower: name.toLowerCase().replace(/\s+/g, ' '), _id: { $ne: school._id } }).select('_id');
    if (clash) throw E.conflict('A school with this name already exists', undefined, 'DUPLICATE_SCHOOL');
    school.name = name;
  }
  if (b.contactEmail !== undefined) school.contactEmail = b.contactEmail ? v.email(b.contactEmail, 'Contact email') : '';
  if (b.contactPhone !== undefined) school.contactPhone = v.str(b.contactPhone, { label: 'Contact phone', max: 30 });
  if (b.address !== undefined) school.address = v.str(b.address, { label: 'Address', max: 300 });
  if (b.region !== undefined) school.region = v.str(b.region, { label: 'Region', max: 80 });
  if (b.notes !== undefined) school.notes = v.str(b.notes, { label: 'Notes', max: 1000 });
  if (b.plan !== undefined) school.subscription.plan = v.oneOf(b.plan, ['trial', 'standard', 'premium'], 'Plan');
  if (b.subscriptionStatus !== undefined) school.subscription.status = v.oneOf(b.subscriptionStatus, ['trial', 'active', 'past_due', 'expired', 'cancelled'], 'Subscription status');
  if (b.subscriptionExpiresAt !== undefined) school.subscription.expiresAt = v.date(b.subscriptionExpiresAt, 'Expiry date');
  await school.save();
  await audit(req, { action: 'school.update', schoolId: school._id, targetType: 'School', targetId: school._id });
  res.json({ school: dto(school) });
});

exports.setStatus = asyncHandler(async (req, res) => {
  const status = v.oneOf(req.body && req.body.status, STATUSES, 'Status');
  const reason = v.str(req.body.reason, { label: 'Reason', max: 300 });
  if (status !== 'active' && !reason) throw E.badRequest('Please give a reason for suspending or deactivating a school');
  const school = await School.findById(v.toObjectId(req.params.id));
  if (!school) throw E.notFound('School not found');
  const previous = school.status;
  school.status = status; school.statusReason = status === 'active' ? '' : reason; school.statusChangedAt = new Date();
  await school.save();
  if (status !== 'active') {
    const admins = await User.find({ schoolId: school._id }).select('_id').lean();
    await Session.deleteMany({ userId: { $in: admins.map((a) => a._id) } }); // sign everyone out immediately
  }
  await audit(req, { action: `school.status.${status}`, schoolId: school._id, targetType: 'School', targetId: school._id, meta: { previous, reason } });
  res.json({ school: dto(school) });
});

exports.resetAdminPassword = asyncHandler(async (req, res) => {
  const schoolId = v.toObjectId(req.params.id);
  const user = await User.findOne({ _id: v.toObjectId(req.body && req.body.userId, 'administrator id'), schoolId, role: 'school_admin' });
  if (!user) throw E.notFound('Administrator not found for this school');
  const temp = generateTempPassword();
  user.passwordHash = await hashPassword(temp);
  user.mustChangePassword = true; user.failedLoginCount = 0; user.lockUntil = undefined; user.passwordChangedAt = new Date();
  await user.save();
  await Session.deleteMany({ userId: user._id });
  await audit(req, { action: 'school.admin_password_reset', schoolId, targetType: 'User', targetId: user._id });
  res.json({ email: user.email, temporaryPassword: temp }); // shown once; user must change it at first login
});

exports.addAdmin = asyncHandler(async (req, res) => {
  const schoolId = v.toObjectId(req.params.id);
  if (!(await School.exists({ _id: schoolId }))) throw E.notFound('School not found');
  const email = v.email(req.body && req.body.email, 'Email');
  const name = v.str(req.body.name, { label: 'Name', required: true, min: 2, max: 120 });
  if (await User.exists({ email })) throw E.conflict('That email address is already in use', undefined, 'DUPLICATE_EMAIL');
  const temp = generateTempPassword();
  const u = await User.create({ email, name, role: 'school_admin', schoolId, passwordHash: await hashPassword(temp), mustChangePassword: true });
  await audit(req, { action: 'school.admin_create', schoolId, targetType: 'User', targetId: u._id });
  res.status(201).json({ admin: { id: u._id, email, name, temporaryPassword: temp } });
});

exports.usage = asyncHandler(async (req, res) => {
  const schoolId = v.toObjectId(req.params.id);
  const { from, to } = v.dateRange(req.query);
  const rows = await SmsMessage.aggregate([
    { $match: { schoolId, createdAt: { $gte: from, $lte: to } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, messages: { $sum: 1 }, accepted: { $sum: '$counts.acceptedTotal' }, delivered: { $sum: '$counts.delivered' }, failed: { $sum: '$counts.failed' } } },
    { $sort: { _id: 1 } },
  ]).option({ skipTenantGuard: true });
  res.json({ from, to, daily: rows.map((r) => ({ date: r._id, messages: r.messages, accepted: r.accepted, delivered: r.delivered, failed: r.failed })) });
});
