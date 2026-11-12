'use strict';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const Mock = require('../../backend/services/sms/mock');
const { mapDeliveryStatus, ProviderError } = require('../../backend/services/sms/BaseProvider');

test('mock provider accepts but never claims delivery on send', async () => {
  const r = await new Mock({ mode: 'ok' }).send({ recipients: ['+233241234567', '+233240000000'], message: 'hi', senderId: 'X' });
  assert.equal(r[0].status, 'accepted'); assert.ok(r[0].providerMessageId.startsWith('mock_'));
  assert.equal(r[1].status, 'failed'); assert.equal(r[1].retryable, false);
});
test('mock failure modes', async () => {
  await assert.rejects(() => new Mock({ mode: 'temporary_failure' }).send({ recipients: ['+233241234567'] }), (e) => e instanceof ProviderError && e.retryable === true);
  await assert.rejects(() => new Mock({ mode: 'auth_error' }).send({ recipients: ['+233241234567'] }), (e) => e.retryable === false);
});
test('delivery is only reported by checkStatus', async () => {
  const s = await new Mock({}).checkStatus(['mock_aaaa', 'mock_aaaf']);
  assert.deepEqual(s.map((x) => x.status), ['delivered', 'failed']);
});
test('status word mapping', () => {
  assert.equal(mapDeliveryStatus('DELIVERED'), 'delivered'); assert.equal(mapDeliveryStatus('Undelivered'), 'failed');
  assert.equal(mapDeliveryStatus('REJECTED'), 'failed'); assert.equal(mapDeliveryStatus('sent'), 'pending'); assert.equal(mapDeliveryStatus(''), 'pending');
});
