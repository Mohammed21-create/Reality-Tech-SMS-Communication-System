'use strict';
// Web process (Render "Web Service"). Stateless: run as many instances as needed behind the load balancer.
const env = require('./config/env');
env.validateEnv();
const { connectDb, disconnectDb } = require('./config/db');
const { closeRedis } = require('./config/redis');
const { closeQueues } = require('./queues');
const { createApp } = require('./app');
const logger = require('./utils/logger');

async function main() {
  await connectDb();
  const app = createApp();
  const server = app.listen(env.port, () => logger.info('web_started', { port: env.port, env: env.nodeEnv }));
  server.keepAliveTimeout = 65000; // longer than the load balancer's idle timeout
  server.headersTimeout = 66000;

  let stopping = false;
  const shutdown = (signal) => {
    if (stopping) return; stopping = true;
    logger.info('web_shutdown', { signal });
    const force = setTimeout(() => process.exit(1), 15000); force.unref();
    server.close(async () => {
      try { await closeQueues(); await closeRedis(); await disconnectDb(); } finally { process.exit(0); }
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (e) => logger.error('unhandled_rejection', { message: e && e.message }));
}

main().catch((e) => { logger.error('web_fatal', { message: e.message }); process.exit(1); });
