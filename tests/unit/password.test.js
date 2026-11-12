'use strict';
process.env.BCRYPT_ROUNDS = '4';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, verifyPassword, passwordProblem, generateTempPassword } = require('../../backend/utils/password');

test('hash and verify', async () => {
  const h = await hashPassword('Correct-Horse-9');
  assert.equal(await verifyPassword('Correct-Horse-9', h), true);
  assert.equal(await verifyPassword('wrong', h), false);
  assert.equal(await verifyPassword('anything', undefined), false); // unknown user path
});
test('policy', () => {
  assert.ok(passwordProblem('short1'));
  assert.ok(passwordProblem('onlyletterslong'));
  assert.ok(passwordProblem('1234567890'));
  assert.ok(passwordProblem('password123'));
  assert.ok(passwordProblem('yahaya12345', { email: 'yahaya@x.com' }));
  assert.equal(passwordProblem('Correct-Horse-9'), null);
});
test('temp passwords satisfy the policy and are random', () => {
  const a = generateTempPassword(); const b = generateTempPassword();
  assert.notEqual(a, b); assert.equal(passwordProblem(a), null); assert.equal(a.length, 14);
});
