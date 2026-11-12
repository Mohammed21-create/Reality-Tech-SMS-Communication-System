'use strict';

class ProviderError extends Error {
  /** @param {string} message @param {{retryable?:boolean, code?:string}} o */
  constructor(message, { retryable = false, code = 'PROVIDER_ERROR' } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.retryable = retryable;
    this.code = code;
  }
}

/**
 * Contract every SMS provider adapter implements. To add a provider:
 *   1. create backend/services/sms/<name>.js extending SmsProvider
 *   2. register it in backend/services/sms/index.js
 * No other part of the application needs to change.
 *
 * send() must return one result per input recipient:
 *   { to: '+233...', status: 'accepted'|'failed'|'unknown', providerMessageId?, error?, retryable? }
 *   - 'accepted' = provider took the message (NOT delivered)
 *   - 'unknown'  = request succeeded but the provider did not say what happened to this number
 * Throw ProviderError({retryable:true}) for whole-request temporary failures (network, 429, 5xx);
 * throw ProviderError({retryable:false}) for permanent request-level failures (bad credentials...).
 */
class SmsProvider {
  constructor(credentials = {}, context = {}) {
    this.credentials = credentials;
    this.context = context; // { schoolId, webhookUrl }
  }
  static get meta() { throw new Error('meta not implemented'); }
  get limits() { return { maxPerSecond: 20, maxBatch: 100 }; }
  get supportsStatusCheck() { return false; }
  async send(/* { recipients, message, senderId } */) { throw new Error('send not implemented'); }
  async checkStatus(/* providerMessageIds */) { return []; } // -> [{providerMessageId, status:'delivered'|'failed'|'pending', reason?}]
  async getBalance() { return null; } // -> { amount:number, unit:string } | null
  async testConnection() { throw new Error('testConnection not implemented'); } // -> { ok, message }
  /** Parse an inbound delivery-report webhook -> [{providerMessageId, status, reason, providerStatus}] */
  parseWebhook(/* req */) { return []; }
}

/** Map arbitrary provider status words to our delivered/failed/pending. */
function mapDeliveryStatus(word) {
  const s = String(word || '').toLowerCase();
  if (!s) return 'pending';
  if (/(undeliver|fail|reject|expire|error|invalid|blacklist|blocked)/.test(s)) return 'failed';
  if (/deliver/.test(s)) return 'delivered';
  return 'pending';
}

module.exports = { SmsProvider, ProviderError, mapDeliveryStatus };
