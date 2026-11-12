'use strict';
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const env = require('../config/env');

const COMMON = new Set(['password', 'password1', 'password123', '123456789', '1234567890', 'qwertyuiop', 'letmein123', 'admin12345', 'welcome123', 'realitytech']);
// Fixed hash used to equalize timing when a user does not exist.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 8);

const hashPassword = (plain) => bcrypt.hash(plain, env.bcryptRounds);
const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash || DUMMY_HASH);

/** Returns an error message, or null if acceptable. */
function passwordProblem(pw, { email = '', name = '' } = {}) {
  if (typeof pw !== 'string') return 'Password is required';
  if (pw.length < 10) return 'Password must be at least 10 characters';
  if (pw.length > 128) return 'Password must be at most 128 characters';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Password must contain letters and numbers';
  const low = pw.toLowerCase();
  if (COMMON.has(low)) return 'That password is too common';
  const local = String(email).split('@')[0].toLowerCase();
  if (local.length >= 4 && low.includes(local)) return 'Password must not contain your email name';
  const first = String(name).split(/\s+/)[0].toLowerCase();
  if (first.length >= 4 && low.includes(first)) return 'Password must not contain your name';
  return null;
}

/** Random temporary password (shown once, must be changed at first login). */
function generateTempPassword(len = 14) {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const all = upper + lower + digits;
  const pick = (set) => set[crypto.randomInt(set.length)];
  const chars = [pick(upper), pick(lower), pick(digits)];
  while (chars.length < len) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

module.exports = { hashPassword, verifyPassword, passwordProblem, generateTempPassword };
