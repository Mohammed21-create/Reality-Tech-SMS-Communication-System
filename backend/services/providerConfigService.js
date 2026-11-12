'use strict';
const env = require('../config/env');
const { SmsProviderConfig, SchoolSettings } = require('../models');
const { encryptJson, decryptJson, randomToken, sha256, encrypt, decrypt } = require('../utils/crypto');
const { listProviders, getProviderMeta, createProvider } = require('./sms');
const { E } = require('../utils/errors');

const aad = (schoolId) => ({ aad: String(schoolId) });
const hint = (v) => (v && String(v).length > 4 ? '••••' + String(v).slice(-4) : '••••');
const webhookUrl = (provider, token) => `${env.baseUrl}/api/webhooks/sms/${provider}/${token}`;

/** Safe representation: NEVER includes secrets. */
function toDto(cfg, tokenPlain) {
  if (!cfg) return null;
  const meta = getProviderMetaSafe(cfg.provider);
  return {
    provider: cfg.provider,
    providerLabel: meta ? meta.label : cfg.provider,
    isActive: cfg.isActive,
    costPerSegment: cfg.costPerSegment,
    currency: cfg.currency,
    credentialHints: Object.fromEntries(cfg.credentialHints || []),
    lastTestAt: cfg.lastTestAt, lastTestOk: cfg.lastTestOk, lastTestMessage: cfg.lastTestMessage,
    lastBalance: cfg.lastBalance && cfg.lastBalance.checkedAt ? cfg.lastBalance : null,
    webhookUrl: tokenPlain ? webhookUrl(cfg.provider, tokenPlain) : undefined,
    updatedAt: cfg.updatedAt,
  };
}
function getProviderMetaSafe(id) { try { return getProviderMeta(id); } catch { return null; } }

async function getConfigDto(schoolId) {
  const cfg = await SmsProviderConfig.findOne({ schoolId }).select('+webhookTokenEnc');
  if (!cfg) return null;
  let token; try { token = cfg.webhookTokenEnc ? decrypt(cfg.webhookTokenEnc, aad(schoolId)) : undefined; } catch { token = undefined; }
  return toDto(cfg, token);
}

async function saveConfig(schoolId, body) {
  const meta = getProviderMeta(String(body.provider || ''));
  const existing = await SmsProviderConfig.findOne({ schoolId }).select('+encryptedCredentials');
  let old = {};
  if (existing && existing.provider === meta.id) {
    try { old = decryptJson(existing.encryptedCredentials, aad(schoolId)); } catch { old = {}; }
  }
  const creds = {};
  const hints = {};
  for (const f of meta.fields) {
    let v = body.credentials && typeof body.credentials[f.key] === 'string' ? body.credentials[f.key].trim() : '';
    if (!v && old[f.key]) v = old[f.key]; // blank secret field = keep the stored value
    if (!v && f.required) throw E.badRequest(`${f.label} is required`);
    if (f.options && v && !f.options.includes(v)) throw E.badRequest(`${f.label} is not valid`);
    if (v.length > 300) throw E.badRequest(`${f.label} is too long`);
    if (v) { creds[f.key] = v; if (f.secret) hints[f.key] = hint(v); }
  }
  const cost = Number(body.costPerSegment);
  if (!Number.isFinite(cost) || cost < 0 || cost > 100) throw E.badRequest('Cost per SMS segment must be a number between 0 and 100');
  const update = {
    provider: meta.id,
    encryptedCredentials: encryptJson(creds, aad(schoolId)),
    credentialHints: hints,
    costPerSegment: cost,
    currency: String(body.currency || 'GHS').toUpperCase().slice(0, 5),
    isActive: body.isActive !== false,
  };
  let token;
  if (!existing || !existing.webhookTokenHash) {
    token = randomToken(24);
    update.webhookTokenHash = sha256(token);
    update.webhookTokenEnc = encrypt(token, aad(schoolId));
  }
  // Changing credentials invalidates the previous connection test result.
  update.$unset = { lastTestOk: 1, lastTestAt: 1, lastTestMessage: 1, lastBalance: 1 };
  const { $unset, ...set } = update;
  const cfg = await SmsProviderConfig.findOneAndUpdate({ schoolId }, { $set: set, $unset, $setOnInsert: { schoolId } }, { upsert: true, new: true, setDefaultsOnInsert: true }).select('+webhookTokenEnc');
  const plain = token || (cfg.webhookTokenEnc ? decrypt(cfg.webhookTokenEnc, aad(schoolId)) : undefined);
  return toDto(cfg, plain);
}

async function regenerateWebhookToken(schoolId) {
  const token = randomToken(24);
  const cfg = await SmsProviderConfig.findOneAndUpdate({ schoolId }, { $set: { webhookTokenHash: sha256(token), webhookTokenEnc: encrypt(token, aad(schoolId)) } }, { new: true });
  if (!cfg) throw E.badRequest('Configure an SMS provider first', undefined, 'PROVIDER_NOT_CONFIGURED');
  return toDto(cfg, token);
}

/** Load config + build a ready-to-use provider instance (decrypts in memory only). */
async function loadProvider(schoolId) {
  const cfg = await SmsProviderConfig.findOne({ schoolId }).select('+encryptedCredentials +webhookTokenEnc');
  if (!cfg) return null;
  const creds = decryptJson(cfg.encryptedCredentials, aad(schoolId));
  let token; try { token = cfg.webhookTokenEnc ? decrypt(cfg.webhookTokenEnc, aad(schoolId)) : undefined; } catch { /* ignore */ }
  const provider = createProvider(cfg.provider, creds, { schoolId: String(schoolId), webhookUrl: token ? webhookUrl(cfg.provider, token) : undefined });
  return { cfg, provider };
}

async function testConnection(schoolId) {
  const loaded = await loadProvider(schoolId);
  if (!loaded) throw E.badRequest('Save your SMS provider settings first', undefined, 'PROVIDER_NOT_CONFIGURED');
  let result;
  try { result = await loaded.provider.testConnection(); } catch (e) { result = { ok: false, message: e.message }; }
  await SmsProviderConfig.updateOne({ schoolId }, { $set: { lastTestAt: new Date(), lastTestOk: !!result.ok, lastTestMessage: String(result.message || '').slice(0, 300) } });
  return result;
}

async function getBalance(schoolId) {
  const loaded = await loadProvider(schoolId);
  if (!loaded) throw E.badRequest('Save your SMS provider settings first', undefined, 'PROVIDER_NOT_CONFIGURED');
  try {
    const bal = await loaded.provider.getBalance();
    if (!bal) return { supported: false, message: 'This provider did not return a balance.' };
    await SmsProviderConfig.updateOne({ schoolId }, { $set: { lastBalance: { amount: bal.amount, unit: bal.unit, checkedAt: new Date() } } });
    return { supported: true, ...bal, checkedAt: new Date() };
  } catch (e) {
    throw E.badRequest(`Could not fetch balance: ${e.message}`, undefined, 'BALANCE_FAILED');
  }
}

const providerTypes = () => listProviders().map((m) => ({ id: m.id, label: m.label, fields: m.fields, supportsBalance: m.supportsBalance, supportsDeliveryReports: m.supportsDeliveryReports }));

/** Ensure a school's sender id + provider are ready before accepting a message. */
async function assertReadyToSend(schoolId) {
  const [cfg, settings] = await Promise.all([SmsProviderConfig.findOne({ schoolId }), SchoolSettings.findOne({ schoolId })]);
  if (!cfg) throw E.badRequest('Set up your SMS provider in Settings before sending.', undefined, 'PROVIDER_NOT_CONFIGURED');
  if (!cfg.isActive) throw E.badRequest('Your SMS provider is switched off in Settings.', undefined, 'PROVIDER_INACTIVE');
  if (!settings || !settings.preferredSenderId) throw E.badRequest('Set your SMS sender ID in Settings before sending.', undefined, 'SENDER_ID_MISSING');
  return { cfg, settings };
}

module.exports = { getConfigDto, saveConfig, regenerateWebhookToken, loadProvider, testConnection, getBalance, providerTypes, assertReadyToSend };
