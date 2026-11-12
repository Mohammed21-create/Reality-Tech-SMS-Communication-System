'use strict';
// Usage:
//   node backend/scripts/seed.js superadmin   -> create the Reality Tech super admin (idempotent)
//   node backend/scripts/seed.js demo         -> demo school + admin using the MOCK provider (development only)
//   node backend/scripts/seed.js indexes      -> build/sync all MongoDB indexes
const env = require('../config/env');
env.validateEnv({ needRedis: false });
const { connectDb, disconnectDb } = require('../config/db');
const models = require('../models');
const { hashPassword, generateTempPassword, passwordProblem } = require('../utils/password');
const { encryptJson, randomToken, sha256, encrypt } = require('../utils/crypto');

async function superadmin() {
  const { email, name } = env.superAdmin;
  if (await models.User.exists({ email })) { console.log(`Super admin ${email} already exists. Nothing to do.`); return; }
  let password = env.superAdmin.password;
  const generated = !password;
  if (generated) password = generateTempPassword(16);
  else { const p = passwordProblem(password, { email, name }); if (p) throw new Error('SUPER_ADMIN_PASSWORD rejected: ' + p); }
  await models.User.create({ email, name, role: 'super_admin', passwordHash: await hashPassword(password), mustChangePassword: true });
  console.log('Super admin created.');
  console.log('  Email:   ' + email);
  console.log('  Password: ' + (generated ? password + '   (shown once - you must change it at first login)' : '(from SUPER_ADMIN_PASSWORD - you must change it at first login)'));
}

async function demo() {
  if (env.isProd) throw new Error('Refusing to seed demo data in production');
  const name = 'Demo International School';
  let school = await models.School.findOne({ nameLower: name.toLowerCase() }).select('+nameLower');
  if (school) { console.log('Demo school already exists.'); return; }
  school = await models.School.create({ name, status: 'active', statusChangedAt: new Date(), subscription: { plan: 'trial', status: 'trial', expiresAt: new Date(Date.now() + 30 * 86400000) } });
  const password = generateTempPassword();
  await models.User.create({ email: 'schooladmin@school.com', name: 'Demo Admin', role: 'school_admin', schoolId: school._id, passwordHash: await hashPassword(password), mustChangePassword: true });
  await models.SchoolSettings.create({ schoolId: school._id, displayName: name, signature: '- Demo International School', preferredSenderId: 'DEMOSCH' });
  const token = randomToken(24);
  await models.SmsProviderConfig.create({
    schoolId: school._id, provider: 'mock', encryptedCredentials: encryptJson({ mode: 'ok' }, { aad: String(school._id) }),
    costPerSegment: 0.05, currency: 'GHS', webhookTokenHash: sha256(token), webhookTokenEnc: encrypt(token, { aad: String(school._id) }),
  });
  const sample = ['0241234567', '0201234567', '0551234567', '0261234567', '0271234567', '0501234567'];
  await models.Parent.insertMany(sample.map((p, i) => ({ schoolId: school._id, fullName: `Demo Parent ${i + 1}`, fullNameLower: `demo parent ${i + 1}`, phones: [{ number: '+233' + p.slice(1), label: 'mobile' }] })));
  console.log('Demo school created. Sign in at /login.html');
  console.log('  Email:   schooladmin@school.com');
  console.log('  Password: ' + password + '   (shown once - change it at first login)');
}

async function indexes() {
  for (const m of Object.values(models)) { await m.syncIndexes(); console.log('indexes synced:', m.modelName); }
}

(async () => {
  await connectDb();
  const cmd = process.argv[2];
  try {
    if (cmd === 'superadmin') await superadmin();
    else if (cmd === 'demo') await demo();
    else if (cmd === 'indexes') await indexes();
    else console.log('Usage: node backend/scripts/seed.js <superadmin|demo|indexes>');
  } finally { await disconnectDb(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
