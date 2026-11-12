'use strict';
const { SchoolSettings, School } = require('../../models');
const providerSvc = require('../../services/providerConfigService');
const asyncHandler = require('../../utils/asyncHandler');
const { E } = require('../../utils/errors');
const v = require('../../utils/validate');
const { audit } = require('../../utils/audit');

const dto = (s, school) => ({
  schoolName: school.name,
  displayName: s ? s.displayName : '', contactPhone: s ? s.contactPhone : '', contactEmail: s ? s.contactEmail : '',
  address: s ? s.address : '', website: s ? s.website : '', preferredSenderId: s ? s.preferredSenderId : '',
  signature: s ? s.signature : '', appendSignatureByDefault: s ? s.appendSignatureByDefault : true,
  timezone: s ? s.timezone : 'Africa/Accra', hasLogo: !!(s && s.logo && s.logo.size),
});

exports.get = asyncHandler(async (req, res) => {
  const s = await SchoolSettings.findOne({ schoolId: req.tenantId }).lean();
  res.json({ settings: dto(s, req.school) });
});

exports.update = asyncHandler(async (req, res) => {
  const b = req.body || {};
  const senderId = v.str(b.preferredSenderId, { label: 'Sender ID', max: 11 });
  if (senderId && !/^[A-Za-z0-9]{3,11}$/.test(senderId)) throw E.badRequest('Sender ID must be 3-11 letters or numbers with no spaces');
  const website = v.str(b.website, { label: 'Website', max: 200 });
  if (website && !/^https?:\/\/[^\s]+\.[^\s]+$/i.test(website)) throw E.badRequest('Website must start with http:// or https://');
  const tz = v.str(b.timezone, { label: 'Time zone', max: 60 }) || 'Africa/Accra';
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); } catch { throw E.badRequest('Unknown time zone'); }
  const contactEmail = b.contactEmail ? v.email(b.contactEmail, 'Contact email') : '';
  const set = {
    displayName: v.str(b.displayName, { label: 'School name', max: 150 }),
    contactPhone: v.str(b.contactPhone, { label: 'Contact phone', max: 30 }),
    contactEmail, address: v.str(b.address, { label: 'Address', max: 300 }), website,
    preferredSenderId: senderId, signature: v.str(b.signature, { label: 'Signature', max: 160 }),
    appendSignatureByDefault: v.bool(b.appendSignatureByDefault), timezone: tz,
  };
  const s = await SchoolSettings.findOneAndUpdate({ schoolId: req.tenantId }, { $set: set, $setOnInsert: { schoolId: req.tenantId } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  await audit(req, { action: 'settings.update' });
  res.json({ settings: dto(s, req.school) });
});

const MAGIC = [
  { type: 'image/png', test: (b) => b.length > 8 && b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { type: 'image/jpeg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: 'image/webp', test: (b) => b.length > 12 && b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP' },
];

exports.uploadLogo = asyncHandler(async (req, res) => {
  if (!req.file) throw E.badRequest('Choose an image file');
  const kind = MAGIC.find((m) => m.test(req.file.buffer)); // trust file content, not the extension / client MIME type
  if (!kind) throw E.badRequest('Logo must be a PNG, JPG or WebP image');
  await SchoolSettings.findOneAndUpdate({ schoolId: req.tenantId }, { $set: { logo: { data: req.file.buffer, contentType: kind.type, size: req.file.size, updatedAt: new Date() } }, $setOnInsert: { schoolId: req.tenantId } }, { upsert: true, setDefaultsOnInsert: true });
  await audit(req, { action: 'settings.logo_upload' });
  res.json({ ok: true });
});

exports.getLogo = asyncHandler(async (req, res) => {
  const s = await SchoolSettings.findOne({ schoolId: req.tenantId }).select('+logo.data logo.contentType logo.size');
  if (!s || !s.logo || !s.logo.data) throw E.notFound('No logo');
  res.set({ 'Content-Type': s.logo.contentType, 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' });
  res.send(s.logo.data);
});

exports.deleteLogo = asyncHandler(async (req, res) => {
  await SchoolSettings.updateOne({ schoolId: req.tenantId }, { $unset: { logo: 1 } });
  await audit(req, { action: 'settings.logo_delete' });
  res.json({ ok: true });
});

// ---- SMS provider ----
exports.providerTypes = (req, res) => res.json({ providers: providerSvc.providerTypes() });
exports.getProvider = asyncHandler(async (req, res) => res.json({ config: await providerSvc.getConfigDto(req.tenantId) }));
exports.saveProvider = asyncHandler(async (req, res) => {
  const config = await providerSvc.saveConfig(req.tenantId, req.body || {});
  await audit(req, { action: 'provider.update', meta: { provider: config.provider, isActive: config.isActive } }); // never log credentials
  res.json({ config });
});
exports.testProvider = asyncHandler(async (req, res) => {
  const result = await providerSvc.testConnection(req.tenantId);
  await audit(req, { action: 'provider.test', status: result.ok ? 'success' : 'failure' });
  res.json(result);
});
exports.balance = asyncHandler(async (req, res) => res.json(await providerSvc.getBalance(req.tenantId)));
exports.regenerateWebhook = asyncHandler(async (req, res) => {
  const config = await providerSvc.regenerateWebhookToken(req.tenantId);
  await audit(req, { action: 'provider.webhook_token_regenerated' });
  res.json({ config });
});
void School;
