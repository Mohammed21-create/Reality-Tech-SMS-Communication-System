'use strict';
const { getRedis } = require('../config/redis');
const { E } = require('../utils/errors');
const logger = require('../utils/logger');
const { withTimeout } = require('../utils/timeout');

// Redis-backed fixed-window limiter so limits hold across multiple web instances.
// Falls back to a per-process memory window if Redis is unreachable (fail-soft, logged).
const memory = new Map();
function memoryHit(key, windowSec) {
  const now = Date.now();
  let e = memory.get(key);
  if (!e || e.reset <= now) { e = { count: 0, reset: now + windowSec * 1000 }; memory.set(key, e); }
  e.count += 1;
  if (memory.size > 50000) for (const [k, v] of memory) if (v.reset <= now) memory.delete(k);
  return { count: e.count, ttl: Math.ceil((e.reset - now) / 1000) };
}

async function hit(key, windowSec) {
  try {
    const redis = getRedis();
    const k = `rl:${key}`;
    const count = await withTimeout(redis.incr(k), 400, 'redis incr');
    if (count === 1) await withTimeout(redis.expire(k, windowSec), 400, 'redis expire');
    const ttl = count === 1 ? windowSec : await withTimeout(redis.ttl(k), 400, 'redis ttl');
    return { count, ttl: ttl > 0 ? ttl : windowSec };
  } catch (e) {
    logger.warn('ratelimit_redis_fallback', { message: e.message });
    return memoryHit(key, windowSec);
  }
}

/**
 * @param {{name:string, windowSec:number, max:number, key?:(req)=>string, message?:string}} o
 */
function rateLimit({ name, windowSec, max, key, message }) {
  return async (req, res, next) => {
    try {
      const id = key ? key(req) : req.ip;
      const { count, ttl } = await hit(`${name}:${id}`, windowSec);
      res.set('RateLimit-Limit', String(max));
      res.set('RateLimit-Remaining', String(Math.max(0, max - count)));
      if (count > max) {
        res.set('Retry-After', String(ttl));
        return next(E.tooMany(message));
      }
      return next();
    } catch (e) { return next(e); }
  };
}

module.exports = { rateLimit, hit };
