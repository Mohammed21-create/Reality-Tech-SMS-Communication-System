'use strict';
const mongoose = require('mongoose');
const { getRedis } = require('../config/redis');
const { withTimeout } = require('../utils/timeout');

exports.live = (req, res) => res.json({ ok: true });
exports.ready = async (req, res) => {
  const checks = { mongo: mongoose.connection.readyState === 1, redis: false };
  try { checks.redis = (await withTimeout(getRedis().ping(), 2000, 'redis ping')) === 'PONG'; } catch { checks.redis = false; }
  const ok = checks.mongo && checks.redis;
  res.status(ok ? 200 : 503).json({ ok, checks });
};
