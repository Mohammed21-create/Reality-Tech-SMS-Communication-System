'use strict';
// Background worker entry point (Render "Background Worker"). Run several instances to scale SMS throughput.
const { Worker } = require('bullmq');
const env = require('../config/env');
env.validateEnv();
const { connectDb, disconnectDb } = require('../config/db');
const { createWorkerConnection, closeRedis } = require('../config/redis');
const { NAMES, getQueues, closeQueues } = require('../queues');
const { startDispatcher } = require('../queues/fairScheduler');
const { processPrepare } = require('./prepareProcessor');
const { processSend } = require('./sendProcessor');
const { processMaintenance } = require('./maintenanceProcessor');
const logger = require('../utils/logger');

async function main() {
  await connectDb();
  const workers = [
    new Worker(NAMES.prepare, processPrepare, { connection: createWorkerConnection(), concurrency: 2 }),
    new Worker(NAMES.send, processSend, { connection: createWorkerConnection(), concurrency: env.sms.sendConcurrency }),
    new Worker(NAMES.maintenance, processMaintenance, { connection: createWorkerConnection(), concurrency: 1 }),
  ];
  workers.forEach((w) => {
    w.on('failed', (job, err) => logger.warn('job_failed', { queue: w.name, job: job && job.id, attempt: job && job.attemptsMade, message: err.message }));
    w.on('error', (err) => logger.error('worker_error', { queue: w.name, message: err.message }));
  });

  // Repeatable maintenance jobs (de-duplicated across instances by scheduler id).
  const { maintenance } = getQueues();
  await maintenance.upsertJobScheduler('scheduler-tick', { every: 15000 }, { name: 'scheduler-tick' });
  await maintenance.upsertJobScheduler('dlr-poll', { every: 30000 }, { name: 'dlr-poll' });
  await maintenance.upsertJobScheduler('reap-stale', { every: 120000 }, { name: 'reap-stale' });
  await maintenance.upsertJobScheduler('reconcile', { every: 60000 }, { name: 'reconcile' });

  const stopDispatcher = startDispatcher();
  logger.info('worker_started', { sendConcurrency: env.sms.sendConcurrency });

  let stopping = false;
  const shutdown = async (signal) => {
    if (stopping) return; stopping = true;
    logger.info('worker_shutdown', { signal });
    try {
      await stopDispatcher();
      await Promise.all(workers.map((w) => w.close())); // waits for in-flight jobs to finish
      await closeQueues(); await closeRedis(); await disconnectDb();
    } finally { process.exit(0); }
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((e) => { logger.error('worker_fatal', { message: e.message }); process.exit(1); });
