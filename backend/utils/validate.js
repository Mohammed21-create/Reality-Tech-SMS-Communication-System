'use strict';
const mongoose = require('mongoose');
const { E } = require('./errors');

const isObjectId = (v) => typeof v === 'string' && /^[a-f\d]{24}$/i.test(v);
const toObjectId = (v, label = 'id') => {
  if (!isObjectId(v)) throw E.badRequest(`Invalid ${label}`);
  return new mongoose.Types.ObjectId(v);
};

function str(v, { label = 'Value', min = 0, max = 500, required = false, trim = true } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw E.badRequest(`${label} is required`);
    return '';
  }
  if (typeof v !== 'string') throw E.badRequest(`${label} must be text`);
  const s = trim ? v.trim() : v;
  if (required && !s) throw E.badRequest(`${label} is required`);
  if (s.length < min) throw E.badRequest(`${label} must be at least ${min} characters`);
  if (s.length > max) throw E.badRequest(`${label} must be at most ${max} characters`);
  return s;
}

function email(v, label = 'Email') {
  const s = str(v, { label, required: true, max: 254 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) throw E.badRequest(`${label} is not a valid email address`);
  return s;
}

function oneOf(v, allowed, label = 'Value', fallback) {
  if ((v === undefined || v === null || v === '') && fallback !== undefined) return fallback;
  if (!allowed.includes(v)) throw E.badRequest(`${label} must be one of: ${allowed.join(', ')}`);
  return v;
}

function int(v, { label = 'Value', min = -Infinity, max = Infinity, fallback } = {}) {
  if ((v === undefined || v === null || v === '') && fallback !== undefined) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw E.badRequest(`${label} must be a whole number between ${min} and ${max}`);
  return n;
}

function num(v, { label = 'Value', min = -Infinity, max = Infinity, fallback } = {}) {
  if ((v === undefined || v === null || v === '') && fallback !== undefined) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw E.badRequest(`${label} must be a number between ${min} and ${max}`);
  return n;
}

function date(v, label = 'Date', { required = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw E.badRequest(`${label} is required`);
    return null;
  }
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw E.badRequest(`${label} is not a valid date`);
  return d;
}

const bool = (v) => v === true || v === 'true' || v === '1' || v === 1;
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Date range from ?from=YYYY-MM-DD&to=YYYY-MM-DD (inclusive of whole `to` day). */
function dateRange(query, { defaultDays = 30 } = {}) {
  let to = date(query.to, 'To date');
  let from = date(query.from, 'From date');
  if (!to) to = new Date();
  else to = new Date(to.getTime() + 24 * 3600 * 1000 - 1);
  if (!from) from = new Date(to.getTime() - defaultDays * 24 * 3600 * 1000);
  if (from > to) throw E.badRequest('From date must be before To date');
  if (to - from > 366 * 24 * 3600 * 1000) throw E.badRequest('Date range cannot exceed one year');
  return { from, to };
}

module.exports = { isObjectId, toObjectId, str, email, oneOf, int, num, date, bool, escapeRegex, dateRange };
