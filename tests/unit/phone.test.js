'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePhone, toProviderFormat } = require('../../backend/utils/phone');

test('Ghana local formats normalise to E.164', () => {
  for (const raw of ['0241234567', '024 123 4567', '024-123-4567', '233241234567', '+233241234567', '00233241234567', '241234567']) {
    const r = normalizePhone(raw);
    assert.equal(r.ok, true, raw);
    assert.equal(r.e164, '+233241234567', raw);
  }
});
test('Excel scientific notation and numeric cells are handled', () => {
  assert.equal(normalizePhone('2.33241234567E+11').e164, '+233241234567');
  assert.equal(normalizePhone(233241234567).e164, '+233241234567');
});
test('invalid Ghana numbers are rejected', () => {
  for (const raw of ['', '   ', '024123456', '02412345678', '0111234567', 'abc', '+233111234567', null, undefined]) {
    assert.equal(normalizePhone(raw).ok, false, String(raw));
  }
});
test('international numbers need a plus or 00 prefix', () => {
  assert.equal(normalizePhone('+447700900123').e164, '+447700900123');
  assert.equal(normalizePhone('00447700900123').e164, '+447700900123');
  assert.equal(normalizePhone('+2348012345678').country, 'INTL');
  assert.equal(normalizePhone('447700900123').ok, false); // ambiguous without +
  assert.equal(normalizePhone('+0447700900123').ok, false);
  assert.equal(normalizePhone('+1234').ok, false);
});
test('provider format has no plus sign', () => assert.equal(toProviderFormat('+233241234567'), '233241234567'));
