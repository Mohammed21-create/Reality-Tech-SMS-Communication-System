'use strict';
const IORedis = require('ioredis');
const env = require('./env');
const logger = require('../utils/logger');

let general = null; // fast-fail client for rate limiting, health, fairness keys
let bull = null; // shared connection for BullMQ (requires maxRetriesPerRequest = null)

function build(opts) {
  const client = new IORedis(env.redisUrl, { ...opts });
  client.on('error', (e) => logger.warn('redis_error', { message: e.message }));
  return client;
}

/** General-purpose client. Commands fail quickly if Redis is down. */
function getRedis() {
  // Fail fast: if Redis is down, commands error immediately instead of queueing (keeps pages responsive).
  if (!general) general = build({ maxRetriesPerRequest: 1, enableOfflineQueue: false, connectTimeout: 3000, retryStrategy: (n) => Math.min(n * 300, 3000) });
  return general;
}

/** Connection for BullMQ queues (producers). */
function getBullConnection() {
  if (!bull) bull = build({ maxRetriesPerRequest: null, enableReadyCheck: false });
  return bull;
}

/** Dedicated connection (BullMQ workers each need their own blocking connection). */
function createWorkerConnection() {
  return build({ maxRetriesPerRequest: null, enableReadyCheck: false });
}

async function closeRedis() {
  const jobs = [];
  if (general) jobs.push(general.quit().catch(() => {}));
  if (bull) jobs.push(bull.quit().catch(() => {}));
  general = null; bull = null;
  await Promise.all(jobs);
}

module.exports = { getRedis, getBullConnection, createWorkerConnection, closeRedis };
