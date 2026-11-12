'use strict';
const env = require('../../config/env');
const { SmsProvider, ProviderError, mapDeliveryStatus } = require('./BaseProvider');
const { toProviderFormat } = require('../../utils/phone');

const BASE = 'https://sms.arkesel.com/api/v2';
const TIMEOUT_MS = 20000;

async function http(method, path, apiKey, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new ProviderError(e.name === 'AbortError' ? 'Arkesel request timed out' : `Could not reach Arkesel: ${e.message}`, { retryable: true, code: 'NETWORK' });
  } finally { clearTimeout(timer); }

  let json = null;
  try { json = await res.json(); } catch { /* non-JSON body */ }
  if (res.status === 401 || res.status === 403) throw new ProviderError('Arkesel rejected the API key', { retryable: false, code: 'AUTH' });
  if (res.status === 429 || res.status >= 500) throw new ProviderError(`Arkesel temporary error (HTTP ${res.status})`, { retryable: true, code: 'TEMPORARY' });
  if (!res.ok) throw new ProviderError((json && json.message) || `Arkesel error (HTTP ${res.status})`, { retryable: false, code: 'REJECTED' });
  return json || {};
}

/**
 * Arkesel SMS API v2 adapter (https://developers.arkesel.com).
 * NOTE: response shapes below follow Arkesel's public v2 documentation; verify against your
 * account with a small live test before production use (see README, "Provider verification").
 */
class ArkeselProvider extends SmsProvider {
  static get meta() {
    return {
      id: 'arkesel', label: 'Arkesel', supportsBalance: true, supportsDeliveryReports: true,
      fields: [{ key: 'apiKey', label: 'API key', secret: true, required: true }],
    };
  }
  get limits() { return { maxPerSecond: env.sms.arkeselMaxPerSecond, maxBatch: 200 }; }
  get supportsStatusCheck() { return false; } // delivery reports arrive through the webhook

  async send({ recipients, message, senderId }) {
    const payload = { sender: senderId, message, recipients: recipients.map(toProviderFormat) };
    if (env.sms.arkeselSendCallback && this.context.webhookUrl) payload.callback_url = this.context.webhookUrl;
    const json = await http('POST', '/sms/send', this.credentials.apiKey, payload);
    if (String(json.status).toLowerCase() !== 'success') {
      throw new ProviderError(json.message || 'Arkesel did not accept the request', { retryable: false, code: 'REJECTED' });
    }
    const byNumber = new Map();
    const data = Array.isArray(json.data) ? json.data : [];
    for (const d of data) {
      const num = String(d.recipient || d.to || '').replace(/\D/g, '');
      if (num) byNumber.set(num, d.id || d.message_id || null);
    }
    return recipients.map((to) => {
      const id = byNumber.get(toProviderFormat(to));
      return id ? { to, status: 'accepted', providerMessageId: String(id) } : { to, status: 'unknown', error: 'Provider response did not include this number' };
    });
  }

  async getBalance() {
    const json = await http('GET', '/clients/balance-details', this.credentials.apiKey);
    const d = json.data || {};
    const raw = d.sms_balance ?? d.balance ?? d.main_balance;
    const amount = Number(raw);
    return Number.isFinite(amount) ? { amount, unit: 'credits' } : null;
  }

  async testConnection() {
    try {
      const bal = await this.getBalance();
      return { ok: true, message: bal ? `Connected to Arkesel. Balance: ${bal.amount} ${bal.unit}.` : 'Connected to Arkesel.' };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  }

  parseWebhook(req) {
    const b = { ...(req.query || {}), ...(req.body || {}) };
    const list = Array.isArray(b.data) ? b.data : [b];
    return list.map((x) => {
      const id = x.id || x.message_id || x.sms_id || x.uuid;
      const raw = x.status || x.delivery_status || x.state;
      return id ? { providerMessageId: String(id), status: mapDeliveryStatus(raw), providerStatus: String(raw || ''), reason: x.reason || x.error } : null;
    }).filter(Boolean);
  }
}
module.exports = ArkeselProvider;
