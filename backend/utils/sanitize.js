'use strict';
// Defence against NoSQL operator injection: strip keys starting with "$" or containing "."
// from user-controlled objects. Controllers additionally coerce every input to a primitive type.
function clean(value, depth = 0) {
  if (depth > 8) return undefined;
  if (Array.isArray(value)) return value.map((v) => clean(v, depth + 1));
  if (value && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k.startsWith('$') || k.includes('.') || k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      out[k] = clean(v, depth + 1);
    }
    return out;
  }
  return value;
}
const sanitizeInput = (req, _res, next) => {
  if (req.body && typeof req.body === 'object') req.body = clean(req.body);
  if (req.query) { const q = clean(req.query); for (const k of Object.keys(req.query)) delete req.query[k]; Object.assign(req.query, q); }
  if (req.params) req.params = clean(req.params);
  next();
};
module.exports = { sanitizeInput, clean };
