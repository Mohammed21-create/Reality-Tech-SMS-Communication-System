'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { clean, sanitizeInput } = require('../../backend/utils/sanitize');
const { toCsv, cell } = require('../../backend/utils/csv');
const { parsePagination, pageResult } = require('../../backend/utils/pagination');

test('NoSQL operator keys are stripped recursively', () => {
  assert.deepEqual(clean({ email: { $ne: null }, a: [{ $gt: 1, ok: 1 }], 'x.y': 1, __proto__: { bad: 1 }, fine: 'yes' }), { email: {}, a: [{ ok: 1 }], fine: 'yes' });
});
test('middleware cleans body, query and params', () => {
  const req = { body: { $where: '1', a: 1 }, query: { 'a.b': '1', q: 'x' }, params: { id: '1' } };
  sanitizeInput(req, {}, () => {});
  assert.deepEqual(req.body, { a: 1 }); assert.deepEqual({ ...req.query }, { q: 'x' });
});
test('CSV escapes and neutralises spreadsheet formulas', () => {
  assert.equal(cell('=SUM(A1)'), "'=SUM(A1)"); assert.equal(cell('+1'), "'+1"); assert.equal(cell('a,"b"'), '"a,""b"""'); assert.equal(cell(null), '');
  assert.ok(toCsv(['A'], [['x']]).includes('A\r\nx'));
});
test('pagination bounds', () => {
  assert.deepEqual(parsePagination({}), { page: 1, limit: 20, skip: 0 });
  assert.equal(parsePagination({ limit: '9999' }).limit, 100); assert.equal(parsePagination({ page: '-3' }).page, 1);
  assert.equal(pageResult([], 101, { page: 1, limit: 20 }).pagination.pages, 6);
});
