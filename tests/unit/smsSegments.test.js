'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeSms, composeFinalText } = require('../../backend/utils/smsSegments');

test('GSM-7 single and multipart boundaries', () => {
  assert.deepEqual([analyzeSms('a'.repeat(160)).segments, analyzeSms('a'.repeat(160)).encoding], [1, 'GSM-7']);
  assert.equal(analyzeSms('a'.repeat(161)).segments, 2);
  assert.equal(analyzeSms('a'.repeat(306)).segments, 2);
  assert.equal(analyzeSms('a'.repeat(307)).segments, 3);
  assert.equal(analyzeSms('').segments, 0);
});
test('extension characters count double', () => assert.equal(analyzeSms('{'.repeat(81)).segments, 2)); // 162 units
test('unicode switches to UCS-2 with smaller segments', () => {
  const a = analyzeSms('Hello 😀');
  assert.equal(a.encoding, 'UCS-2');
  assert.equal(analyzeSms('é'.repeat(70)).encoding, 'GSM-7'); // é is GSM
  assert.equal(analyzeSms('\u2019'.repeat(70)).segments, 1);
  assert.equal(analyzeSms('\u2019'.repeat(71)).segments, 2);
  assert.equal(analyzeSms('\u2019'.repeat(135)).segments, 3);
});
test('signature is appended once', () => {
  assert.equal(composeFinalText('Hello', '- ABC School', true), 'Hello - ABC School');
  assert.equal(composeFinalText('Hello - ABC School', '- ABC School', true), 'Hello - ABC School');
  assert.equal(composeFinalText('Hello', '- ABC School', false), 'Hello');
  assert.equal(composeFinalText('Hello', '', true), 'Hello');
});
