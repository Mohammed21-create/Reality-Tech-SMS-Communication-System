'use strict';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { encryptJson, decryptJson, encrypt, decrypt, sha256, safeEqual } = require('../../backend/utils/crypto');

test('round trip with tenant binding', () => {
  const blob = encryptJson({ apiKey: 'SECRET-123' }, { aad: 'school1' });
  assert.ok(!blob.includes('SECRET'));
  assert.deepEqual(decryptJson(blob, { aad: 'school1' }), { apiKey: 'SECRET-123' });
});
test('ciphertext cannot be decrypted for another tenant', () => {
  const blob = encrypt('secret', { aad: 'school1' });
  assert.throws(() => decrypt(blob, { aad: 'school2' }));
});
test('tampering is detected', () => {
  const parts = encrypt('secret').split(':'); parts[3] = Buffer.from('xxxxxxxx').toString('base64');
  assert.throws(() => decrypt(parts.join(':')));
});
test('same plaintext encrypts differently each time', () => assert.notEqual(encrypt('x'), encrypt('x')));
test('wrong key fails', () => assert.throws(() => decrypt(encrypt('x'), { keyHex: 'b'.repeat(64) })));
test('helpers', () => { assert.equal(sha256('a').length, 64); assert.equal(safeEqual('abc', 'abc'), true); assert.equal(safeEqual('abc', 'abd'), false); assert.equal(safeEqual('a', 'abc'), false); });
