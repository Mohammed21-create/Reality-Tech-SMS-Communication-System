'use strict';
const crypto = require('crypto');
const env = require('../config/env');

const VERSION = 'v1';

function keyBuf(keyHex) {
  const b = Buffer.from(keyHex || '', 'hex');
  if (b.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex characters)');
  return b;
}

/**
 * AES-256-GCM. `aad` binds the ciphertext to a context (we use the school id) so that a blob
 * copied from one school's document cannot be decrypted as another school's.
 * Format: v1:<iv>:<tag>:<ciphertext> (base64 parts).
 */
function encrypt(plaintext, { aad = '', keyHex = env.encryptionKey } = {}) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBuf(keyHex), iv);
  if (aad) cipher.setAAD(Buffer.from(String(aad)));
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}

function decrypt(payload, { aad = '', keyHex = env.encryptionKey } = {}) {
  const parts = String(payload || '').split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error('Unsupported ciphertext format');
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuf(keyHex), Buffer.from(parts[1], 'base64'));
  if (aad) decipher.setAAD(Buffer.from(String(aad)));
  decipher.setAuthTag(Buffer.from(parts[2], 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64')), decipher.final()]).toString('utf8');
}

const encryptJson = (obj, opts) => encrypt(JSON.stringify(obj), opts);
const decryptJson = (payload, opts) => JSON.parse(decrypt(payload, opts));

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

function safeEqual(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

module.exports = { encrypt, decrypt, encryptJson, decryptJson, sha256, randomToken, safeEqual };
