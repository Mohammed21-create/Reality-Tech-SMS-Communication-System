'use strict';
require('dotenv').config();

const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const bool = (v, d) => (v === undefined || v === '' ? d : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase()));

const nodeEnv = process.env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';

const env = {
  nodeEnv,
  isProd,
  isTest: nodeEnv === 'test',
  port: int(process.env.PORT, 3000),
  baseUrl: (process.env.BASE_URL || `http://localhost:${int(process.env.PORT, 3000)}`).replace(/\/$/, ''),
  trustProxy: int(process.env.TRUST_PROXY, isProd ? 1 : 0),
  mongoUri: process.env.MONGODB_URI || '',
  mongoPoolSize: int(process.env.MONGO_MAX_POOL_SIZE, 20),
  redisUrl: process.env.REDIS_URL || '',
  encryptionKey: process.env.ENCRYPTION_KEY || '',
  defaultCountry: (process.env.DEFAULT_COUNTRY || 'GH').toUpperCase(),
  bcryptRounds: int(process.env.BCRYPT_ROUNDS, 12),
  session: {
    idleMinutes: int(process.env.SESSION_IDLE_MINUTES, 30),
    absoluteHours: int(process.env.SESSION_ABSOLUTE_HOURS, 12),
    cookieSecure: bool(process.env.COOKIE_SECURE, isProd),
  },
  login: {
    maxFailures: int(process.env.LOGIN_MAX_FAILURES, 5),
    lockMinutes: int(process.env.LOGIN_LOCK_MINUTES, 15),
  },
  sms: {
    batchSize: int(process.env.SMS_BATCH_SIZE, 100),
    sendConcurrency: int(process.env.SMS_SEND_CONCURRENCY, 5),
    perSchoolMaxInflight: int(process.env.SMS_PER_SCHOOL_MAX_INFLIGHT, 2),
    backlogLimit: int(process.env.SMS_QUEUE_BACKLOG_LIMIT, 200),
    maxAttempts: int(process.env.SMS_MAX_ATTEMPTS, 5),
    dlrMinAgeSeconds: int(process.env.DLR_MIN_AGE_SECONDS, 45),
    allowMock: bool(process.env.ALLOW_MOCK_PROVIDER, !isProd),
    arkeselMaxPerSecond: int(process.env.ARKESEL_MAX_PER_SECOND, 50),
    arkeselSendCallback: bool(process.env.ARKESEL_SEND_CALLBACK, false),
  },
  imports: {
    maxMb: int(process.env.MAX_IMPORT_MB, 10),
    maxRows: int(process.env.MAX_IMPORT_ROWS, 50000),
  },
  superAdmin: {
    email: (process.env.SUPER_ADMIN_EMAIL || 'admin@realitytech.com').toLowerCase(),
    name: process.env.SUPER_ADMIN_NAME || 'Reality Tech Admin',
    password: process.env.SUPER_ADMIN_PASSWORD || '',
  },
};

/** Fail fast on missing/invalid configuration. Called by server and worker entry points. */
function validateEnv({ needRedis = true } = {}) {
  const problems = [];
  if (!env.mongoUri) problems.push('MONGODB_URI is required');
  if (needRedis && !env.redisUrl) problems.push('REDIS_URL is required');
  if (!/^[0-9a-fA-F]{64}$/.test(env.encryptionKey)) {
    problems.push('ENCRYPTION_KEY must be 64 hex characters (32 bytes). Generate: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  }
  if (isProd && env.sms.allowMock) problems.push('ALLOW_MOCK_PROVIDER should be false in production');
  if (problems.length) {
    throw new Error('Invalid configuration:\n - ' + problems.join('\n - '));
  }
}

module.exports = env;
module.exports.validateEnv = validateEnv;
