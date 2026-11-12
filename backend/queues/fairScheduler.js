'use strict';
/**
 * Fair, multi-tenant dispatching on top of BullMQ.
 *
 * Problem: a single FIFO queue lets one school with 100k recipients starve everyone else.
 * Solution: every school has its own pending list in Redis (`sms:pending:<school>`). A dispatcher
 * loop (runs inside each worker process) round-robins across schools with pending work and moves
 * ONE batch at a time into the shared BullMQ `sms-send` queue, never letting a school have more
 * than N batches in flight (default 2) and never letting the send queue backlog exceed a limit.
 * Redis Lua makes "check in-flight cap + pop" atomic, so many dispatchers/workers can run at once.
 */
const env = require('../config/env');
const { getBullConnection } = require('../config/redis');
const { getQueues } = require('./index');
const logger = require('../utils/logger');
const { PlatformSettings } = require('../models');

const ACTIVE = 'sms:active';
const pendingKey = (s) => `sms:pending:${s}`;
const inflightKey = (s) => `sms:inflight:${s}`;

const LUA_POP = `
local inflight = tonumber(redis.call('GET', KEYS[2]) or '0')
if inflight >= tonumber(ARGV[1]) then return false end
local item = redis.call('LPOP', KEYS[1])
if not item then redis.call('SREM', KEYS[3], ARGV[2]) return false end
redis.call('INCR', KEYS[2])
redis.call('EXPIRE', KEYS[2], 900)
return item
`;
const LUA_RELEASE = `
local v = tonumber(redis.call('GET', KEYS[1]) or '0')
if v <= 1 then redis.call('DEL', KEYS[1]) return 0 end
return redis.call('DECR', KEYS[1])
`;

let defined = false;
function redis() {
  const r = getBullConnection(); // reliable connection (queues commands while reconnecting)
  if (!defined) {
    r.defineCommand('fairPop', { numberOfKeys: 3, lua: LUA_POP });
    r.defineCommand('fairRelease', { numberOfKeys: 1, lua: LUA_RELEASE });
    defined = true;
  }
  return r;
}

/** descriptors: [{s: schoolId, m: messageId, b: batchNo, r: retryRound}] */
async function pushBatches(schoolId, descriptors) {
  const r = redis();
  for (let i = 0; i < descriptors.length; i += 500) {
    await r.rpush(pendingKey(schoolId), ...descriptors.slice(i, i + 500).map((d) => JSON.stringify(d)));
  }
  await r.sadd(ACTIVE, String(schoolId));
}

const releaseInflight = (schoolId) => redis().fairRelease(inflightKey(schoolId));

let capCache = { at: 0, value: env.sms.perSchoolMaxInflight };
async function perSchoolCap() {
  if (Date.now() - capCache.at < 10000) return capCache.value;
  try {
    const ps = await PlatformSettings.get();
    capCache = { at: Date.now(), value: ps.perSchoolMaxInflight || env.sms.perSchoolMaxInflight };
  } catch { capCache.at = Date.now(); }
  return capCache.value;
}

function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

/** One fairness round. Returns number of batches moved into the send queue. */
async function dispatchOnce() {
  const r = redis();
  const schools = shuffle(await r.smembers(ACTIVE));
  if (!schools.length) return 0;
  const { send } = getQueues();
  const waiting = await send.getWaitingCount();
  let budget = env.sms.backlogLimit - waiting;
  if (budget <= 0) return 0;
  const cap = await perSchoolCap();
  let moved = 0;
  for (const s of schools) {
    if (budget <= 0) break;
    const raw = await r.fairPop(pendingKey(s), inflightKey(s), ACTIVE, cap, s);
    if (!raw) continue;
    const d = JSON.parse(raw);
    const jobId = `send_${d.m}_${d.b}_${d.r || 0}`;
    if (await send.getJob(jobId)) { await releaseInflight(s); continue; } // already queued/retained: do not double count
    await send.add('send', d, { jobId });
    budget -= 1; moved += 1;
  }
  return moved;
}

function startDispatcher() {
  let running = true;
  const loop = (async () => {
    while (running) {
      let moved = 0;
      try { moved = await dispatchOnce(); } catch (e) { logger.warn('dispatch_error', { message: e.message }); }
      await new Promise((res) => setTimeout(res, moved ? 25 : 400));
    }
  })();
  return async () => { running = false; await loop; };
}

/** Per-school provider rate limit (messages/second) shared by all worker instances. */
async function throttle(schoolId, count, maxPerSecond) {
  const r = redis();
  for (let guard = 0; guard < 60; guard++) {
    const sec = Math.floor(Date.now() / 1000);
    const key = `sms:rate:${schoolId}:${sec}`;
    const used = await r.incrby(key, count);
    if (used === count) await r.expire(key, 5);
    if (used <= maxPerSecond || used === count) return; // a batch bigger than the limit still goes through alone
    await new Promise((res) => setTimeout(res, 1000 - (Date.now() % 1000) + 5));
  }
}

async function pendingStats() {
  const r = redis();
  const schools = await r.smembers(ACTIVE);
  let batches = 0;
  for (const s of schools.slice(0, 1000)) batches += await r.llen(pendingKey(s));
  return { schoolsWithPendingBatches: schools.length, pendingBatches: batches };
}

module.exports = { pushBatches, releaseInflight, dispatchOnce, startDispatcher, throttle, pendingStats };
