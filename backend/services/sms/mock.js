'use strict';
const crypto = require('crypto');
const { SmsProvider, ProviderError } = require('./BaseProvider');

/**
 * Development/testing provider. Sends nothing and costs nothing, but behaves like a real
 * provider: it returns "accepted" (never "delivered") and reports delivery later via
 * checkStatus(). Behaviour is controlled through the "mode" credential and phone numbers:
 *   mode=ok                 accept everything (default)
 *   mode=temporary_failure  every send throws a retryable error (tests retry/backoff/DLQ)
 *   mode=down               every send throws a retryable error
 *   mode=auth_error         every send throws a permanent auth error
 *   numbers ending 0000     rejected by the "provider" (permanent per-recipient failure)
 *   provider ids ending 'f' report FAILED on status check, all others DELIVERED
 */
class MockProvider extends SmsProvider {
  static get meta() {
    return {
      id: 'mock', label: 'Mock provider (testing only)', supportsBalance: true, supportsDeliveryReports: true,
      fields: [{ key: 'mode', label: 'Simulation mode', secret: false, required: false, options: ['ok', 'temporary_failure', 'down', 'auth_error'] }],
    };
  }
  get limits() { return { maxPerSecond: Number(process.env.MOCK_MAX_PER_SECOND) || 2000, maxBatch: 500 }; }
  get supportsStatusCheck() { return true; }

  async send({ recipients }) {
    const mode = this.credentials.mode || 'ok';
    if (mode === 'temporary_failure' || mode === 'down') throw new ProviderError('Mock provider temporary failure', { retryable: true, code: 'MOCK_TEMPORARY' });
    if (mode === 'auth_error') throw new ProviderError('Mock provider rejected the credentials', { retryable: false, code: 'AUTH' });
    return recipients.map((to) => {
      if (to.endsWith('0000')) return { to, status: 'failed', error: 'Mock: number rejected by provider', retryable: false };
      return { to, status: 'accepted', providerMessageId: 'mock_' + crypto.randomBytes(8).toString('hex') };
    });
  }

  async checkStatus(ids) {
    return ids.map((providerMessageId) => ({
      providerMessageId,
      status: providerMessageId.endsWith('f') ? 'failed' : 'delivered',
      reason: providerMessageId.endsWith('f') ? 'Mock: handset unreachable' : undefined,
    }));
  }

  async getBalance() { return { amount: 1000, unit: 'credits' }; }
  async testConnection() {
    const mode = this.credentials.mode || 'ok';
    if (mode === 'auth_error') return { ok: false, message: 'Mock provider: invalid credentials (simulated)' };
    if (mode === 'down') return { ok: false, message: 'Mock provider: service unavailable (simulated)' };
    return { ok: true, message: 'Mock provider connection OK. No real SMS will be sent.' };
  }
  parseWebhook(req) {
    const b = req.body || {};
    return b.id ? [{ providerMessageId: String(b.id), status: b.status === 'delivered' ? 'delivered' : 'failed', providerStatus: String(b.status || ''), reason: b.reason }] : [];
  }
}
module.exports = MockProvider;
