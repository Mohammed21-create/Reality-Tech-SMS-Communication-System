'use strict';
// Queue throughput + fairness test using the MOCK provider (no real SMS, no cost).
// 1. Start workers in another terminal:  npm run start:worker   (or several, to test horizontal scaling)
// 2. Run:  MONGODB_URI=... REDIS_URL=... ENCRYPTION_KEY=... node tests/load/queue-load.js
// Env: BIG_PARENTS (20000), SMALL_SCHOOLS (4), SMALL_PARENTS (200)
process.env.ALLOW_MOCK_PROVIDER = 'true';
const mongoose = require('mongoose');
const env = require('../../backend/config/env'); env.validateEnv();
const { connectDb, disconnectDb } = require('../../backend/config/db');
const { enqueuePrepare, closeQueues } = require('../../backend/queues');
const { closeRedis } = require('../../backend/config/redis');
const M = require('../../backend/models');
const { encryptJson } = require('../../backend/utils/crypto');

const BIG = Number(process.env.BIG_PARENTS || 20000); const SMALL_N = Number(process.env.SMALL_SCHOOLS || 4); const SMALL = Number(process.env.SMALL_PARENTS || 200);
const tag = Date.now().toString(36);

async function makeSchool(name, parents) {
  const school = await M.School.create({ name: `${name} ${tag}`, status: 'active' });
  const schoolId = school._id;
  await M.SchoolSettings.create({ schoolId, displayName: name, preferredSenderId: 'LOADTEST', signature: '' });
  await M.SmsProviderConfig.create({ schoolId, provider: 'mock', encryptedCredentials: encryptJson({ mode: 'ok' }, { aad: String(schoolId) }), costPerSegment: 0.05 });
  const base = Math.floor(Math.random() * 1e6);
  for (let i = 0; i < parents; i += 5000) {
    const rows = []; for (let j = i; j < Math.min(parents, i + 5000); j++) rows.push({ schoolId, fullName: `P${j}`, fullNameLower: `p${j}`, phones: [{ number: `+23324${String(1000000 + ((base + j) % 9000000)).slice(-7)}`, label: 'mobile' }] });
    await M.Parent.insertMany(rows, { ordered: false }).catch(() => {});
  }
  const count = await M.Parent.countDocuments({ schoolId });
  const msg = await M.SmsMessage.create({ schoolId, createdBy: new mongoose.Types.ObjectId(), body: `Load test ${name}`, finalText: `Load test ${name}`, encoding: 'GSM-7', segmentsPerMessage: 1, audience: { kind: 'all' }, senderId: 'LOADTEST', provider: 'mock', costPerSegment: 0.05, estimatedRecipients: count, status: 'preparing' });
  return { name, schoolId, msgId: msg._id, parents: count };
}

(async () => {
  await connectDb();
  console.log(`Seeding 1 big school (${BIG}) and ${SMALL_N} small schools (${SMALL} each)...`);
  const schools = [await makeSchool('Big', BIG)];
  for (let i = 0; i < SMALL_N; i++) schools.push(await makeSchool(`Small${i + 1}`, SMALL));
  const t0 = Date.now(); const finished = {};
  for (const s of schools) await enqueuePrepare(s.schoolId, s.msgId); // big school enqueued first on purpose
  console.log('Queued. Waiting for workers...');
  while (Object.keys(finished).length < schools.length) {
    for (const s of schools) {
      if (finished[s.name]) continue;
      const m = await M.SmsMessage.findOne({ _id: s.msgId, schoolId: s.schoolId }).lean();
      if (['completed', 'failed'].includes(m.status)) { finished[s.name] = { seconds: ((Date.now() - t0) / 1000).toFixed(1), status: m.status, accepted: m.counts.acceptedTotal, total: m.counts.total }; console.log(s.name, finished[s.name]); }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  const total = schools.reduce((a, s) => a + s.parents, 0); const secs = (Date.now() - t0) / 1000;
  console.log(JSON.stringify({ totalMessages: total, seconds: secs.toFixed(1), messagesPerSecond: Math.round(total / secs), fairness: 'Small schools should finish long before the big one', finished }, null, 2));
  await closeQueues(); await closeRedis(); await disconnectDb();
})().catch((e) => { console.error(e); process.exit(1); });
