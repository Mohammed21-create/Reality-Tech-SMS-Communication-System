'use strict';
// Shared setup for integration tests. Requires a REAL MongoDB and Redis:
//   TEST_MONGODB_URI=mongodb://127.0.0.1:27017/rt_test TEST_REDIS_URL=redis://127.0.0.1:6379/1 npm run test:integration
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = process.env.TEST_MONGODB_URI || '';
process.env.REDIS_URL = process.env.TEST_REDIS_URL || '';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'c'.repeat(64);
process.env.BCRYPT_ROUNDS = '4';
process.env.ALLOW_MOCK_PROVIDER = 'true';
process.env.DLR_MIN_AGE_SECONDS = '0';
process.env.SMS_BATCH_SIZE = '10';

const enabled = !!(process.env.TEST_MONGODB_URI && process.env.TEST_REDIS_URL);
module.exports.enabled = enabled;
module.exports.skipReason = 'Set TEST_MONGODB_URI and TEST_REDIS_URL to run integration tests';

if (enabled) {
  const { Worker } = require('bullmq');
  const mongoose = require('mongoose');
  const request = require('supertest');
  const { connectDb, disconnectDb } = require('../../backend/config/db');
  const { createWorkerConnection, closeRedis, getRedis } = require('../../backend/config/redis');
  const { createApp } = require('../../backend/app');
  const { NAMES, closeQueues } = require('../../backend/queues');
  const { startDispatcher } = require('../../backend/queues/fairScheduler');
  const { processPrepare } = require('../../backend/workers/prepareProcessor');
  const { processSend } = require('../../backend/workers/sendProcessor');
  const models = require('../../backend/models');
  const { hashPassword } = require('../../backend/utils/password');

  /** Supertest agent that keeps cookies and sends the CSRF token automatically. */
  function client(app) {
    const agent = request.agent(app);
    let csrf = '';
    const wrap = (method) => (url, body) => {
      const r = agent[method](url);
      if (method !== 'get') r.set('X-CSRF-Token', csrf);
      return body !== undefined && method !== 'get' && method !== 'delete' ? r.send(body) : r;
    };
    return {
      get: wrap('get'), post: wrap('post'), put: wrap('put'), patch: wrap('patch'), del: wrap('delete'), raw: agent,
      upload: (url, field, buffer, filename) => agent.post(url).set('X-CSRF-Token', csrf).attach(field, buffer, filename),
      setCsrf: (t) => { csrf = t; },
      async login(base, email, password) { const r = await agent.post(`${base}/auth/login`).send({ email, password }); if (r.body.csrfToken) csrf = r.body.csrfToken; return r; },
    };
  }

  module.exports.setup = async () => {
    await connectDb(); await mongoose.connection.dropDatabase(); await getRedis().flushdb();
    for (const m of Object.values(models)) await m.syncIndexes();
    const app = createApp();
    const workers = [
      new Worker(NAMES.prepare, processPrepare, { connection: createWorkerConnection(), concurrency: 2 }),
      new Worker(NAMES.send, processSend, { connection: createWorkerConnection(), concurrency: 3 }),
    ];
    const stopDispatcher = startDispatcher();
    return { app, client, models, request, workers, stopDispatcher };
  };
  module.exports.teardown = async (ctx) => {
    await ctx.stopDispatcher(); await Promise.all(ctx.workers.map((w) => w.close()));
    await closeQueues(); await closeRedis(); await disconnectDb();
  };
  module.exports.seedSuperAdmin = async (email = 'root@rt.test', password = 'Sup3r-Secret-Pass') => {
    await models.User.create({ email, name: 'Root', role: 'super_admin', passwordHash: await hashPassword(password), mustChangePassword: false });
    return { email, password };
  };
  module.exports.waitFor = async (fn, { timeout = 30000, interval = 250 } = {}) => {
    const end = Date.now() + timeout; let last;
    while (Date.now() < end) { last = await fn(); if (last) return last; await new Promise((r) => setTimeout(r, interval)); }
    throw new Error('waitFor timed out');
  };
}
