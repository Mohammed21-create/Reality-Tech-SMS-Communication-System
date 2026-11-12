'use strict';
const { Queue } = require('bullmq');
const env = require('../config/env');
const { getBullConnection } = require('../config/redis');

const NAMES = { prepare: 'sms-prepare', send: 'sms-send', maintenance: 'sms-maintenance', dead: 'sms-dead' };
const backoff = { type: 'exponential', delay: 5000 }; // 5s, 10s, 20s, 40s ...
const retention = { removeOnComplete: { age: 3600, count: 2000 }, removeOnFail: { age: 7 * 24 * 3600 } };

let queues = null;
function getQueues() {
  if (!queues) {
    const connection = getBullConnection();
    queues = {
      prepare: new Queue(NAMES.prepare, { connection, defaultJobOptions: { attempts: 3, backoff, ...retention } }),
      send: new Queue(NAMES.send, { connection, defaultJobOptions: { attempts: env.sms.maxAttempts, backoff, ...retention } }),
      maintenance: new Queue(NAMES.maintenance, { connection, defaultJobOptions: { removeOnComplete: 50, removeOnFail: 200 } }),
      dead: new Queue(NAMES.dead, { connection, defaultJobOptions: { removeOnComplete: false, removeOnFail: false } }), // dead-letter queue: kept for inspection
    };
  }
  return queues;
}

/** Hand a message to the background workers so recipients are built outside the HTTP request. */
function enqueuePrepare(schoolId, messageId) {
  return getQueues().prepare.add('prepare', { schoolId: String(schoolId), messageId: String(messageId) }, { jobId: `prepare_${messageId}` });
}

async function queueStats() {
  const q = getQueues();
  const out = {};
  for (const [k, queue] of Object.entries(q)) {
    out[k] = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed');
  }
  return out;
}

async function closeQueues() {
  if (!queues) return;
  await Promise.all(Object.values(queues).map((q) => q.close().catch(() => {})));
  queues = null;
}

module.exports = { NAMES, getQueues, enqueuePrepare, queueStats, closeQueues };
