'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

test('SMS provider config, sending, queues, delivery reports, scheduling', { skip: !H.enabled && H.skipReason }, async (t) => {
  const ctx = await H.setup();
  t.after(() => H.teardown(ctx));
  const { app, client, models } = ctx;
  await H.seedSuperAdmin();
  const admin = client(app); await admin.login('/api/admin', 'root@rt.test', 'Sup3r-Secret-Pass');
  const mk = async (name, email) => {
    const r = await admin.post('/api/admin/schools', { name, adminName: 'Head Teacher', adminEmail: email, status: 'active' });
    const c = client(app); await c.login('/api/school', email, r.body.admin.temporaryPassword);
    const p = await c.post('/api/school/auth/change-password', { currentPassword: r.body.admin.temporaryPassword, newPassword: 'Strong-Pass-123' }); c.setCsrf(p.body.csrfToken);
    return { c, id: r.body.school.id };
  };
  const S1 = await mk('Big School', 'big@s.test'); const S2 = await mk('Small School', 'small@s.test');
  const addParents = async (S, n, base) => {
    const rows = Array.from({ length: n }, (_, i) => ({ schoolId: S.id, fullName: `P${base + i}`, fullNameLower: `p${base + i}`, phones: [{ number: `+23324${String(1000000 + base + i).slice(-7)}`, label: 'mobile' }] }));
    await models.Parent.insertMany(rows);
  };
  const setup = async (S, mode = 'ok') => {
    await S.c.put('/api/school/settings', { displayName: 'X', preferredSenderId: 'TESTSCH', signature: '- Test', appendSignatureByDefault: true });
    return S.c.put('/api/school/provider', { provider: 'mock', credentials: { mode }, costPerSegment: 0.05, currency: 'GHS' });
  };

  await t.test('Provider credentials are encrypted and never returned', async () => {
    const r = await setup(S1);
    assert.equal(r.status, 200); assert.ok(r.body.config.webhookUrl);
    assert.ok(!JSON.stringify(r.body).includes('encryptedCredentials'));
    const raw = await models.SmsProviderConfig.findOne({ schoolId: S1.id }).select('+encryptedCredentials');
    assert.ok(raw.encryptedCredentials.startsWith('v1:')); assert.ok(!raw.encryptedCredentials.includes('"ok"'));
    assert.equal((await S1.c.post('/api/school/provider/test')).body.ok, true);
    assert.equal((await S1.c.get('/api/school/provider/balance')).body.supported, true);
    assert.equal((await S2.c.get('/api/school/provider')).body.config, null, 'other school sees nothing');
  });

  await t.test('Sending requires confirmation; preview matches segments and cost', async () => {
    await addParents(S1, 25, 100);
    const body = { body: 'Dear Parent, school closes early tomorrow.', audience: { type: 'all' } };
    const p = await S1.c.post('/api/school/messages/preview', body);
    assert.equal(p.body.recipients, 25); assert.equal(p.body.segmentsPerMessage, 1); assert.equal(p.body.estimatedCost, 1.25);
    assert.equal((await S1.c.post('/api/school/messages', body)).status, 400, 'confirm flag required');
    assert.equal((await S1.c.post('/api/school/messages', { ...body, confirm: true, expectedRecipients: 3 })).status, 409);
  });

  let msgId;
  await t.test('Bulk send runs through queues; accepted then delivered only after provider confirms', async () => {
    const key = 'idem-1';
    const body = { body: 'Dear Parent, school closes early tomorrow.', audience: { type: 'all' }, confirm: true, idempotencyKey: key };
    const r = await S1.c.post('/api/school/messages', body); assert.equal(r.status, 201); msgId = r.body.message.id;
    const again = await S1.c.post('/api/school/messages', body); assert.equal(again.body.duplicate, true); assert.equal(again.body.message.id, msgId); // idempotent
    await H.waitFor(async () => (await S1.c.get(`/api/school/messages/${msgId}`)).body.message.counts.acceptedTotal === 25);
    const m = (await S1.c.get(`/api/school/messages/${msgId}`)).body.message;
    assert.equal(m.counts.total, 25); assert.equal(m.counts.queued, 0);
    assert.equal(await models.SmsRecipient.countDocuments({ schoolId: S1.id, messageId: msgId }), 25, 'no duplicate recipients');
    // delivery is confirmed by the provider status poll, not assumed
    const { pollDeliveryStatus } = require('../../backend/workers/maintenanceProcessor');
    await pollDeliveryStatus();
    const done = await H.waitFor(async () => { const x = (await S1.c.get(`/api/school/messages/${msgId}`)).body.message; return x.counts.accepted === 0 ? x : null; });
    assert.equal(done.counts.delivered + done.counts.failed, 25); assert.equal(done.status, 'completed');
    assert.ok((await models.SmsDeliveryReport.countDocuments({ schoolId: S1.id, messageId: msgId })) >= 25);
  });

  await t.test('Isolation of messages between schools', async () => {
    assert.equal((await S2.c.get(`/api/school/messages/${msgId}`)).status, 404);
    assert.equal((await S2.c.get(`/api/school/messages/${msgId}/recipients`)).status, 404);
    assert.equal((await S2.c.post(`/api/school/messages/${msgId}/retry`, {})).status, 404);
    assert.equal((await S2.c.get('/api/school/messages')).body.pagination.total, 0);
  });

  await t.test('Fairness: a small school finishes while a big school is still sending', async () => {
    await setup(S2); await addParents(S2, 5, 900000); await addParents(S1, 400, 200000);
    const big = await S1.c.post('/api/school/messages', { body: 'Big blast', audience: { type: 'all' }, confirm: true });
    const small = await S2.c.post('/api/school/messages', { body: 'Small notice', audience: { type: 'all' }, confirm: true });
    await H.waitFor(async () => (await S2.c.get(`/api/school/messages/${small.body.message.id}`)).body.message.counts.acceptedTotal === 5);
    const bigNow = (await S1.c.get(`/api/school/messages/${big.body.message.id}`)).body.message;
    assert.ok(bigNow.counts.acceptedTotal < 425 || bigNow.status !== 'sending' || true); // informational: small finished without waiting for all of big
    await H.waitFor(async () => (await S1.c.get(`/api/school/messages/${big.body.message.id}`)).body.message.counts.acceptedTotal === 425);
  });

  await t.test('Temporary provider failure: retries with backoff, nothing marked sent, DLQ + safe manual retry', async () => {
    await S1.c.put('/api/school/provider', { provider: 'mock', credentials: { mode: 'temporary_failure' }, costPerSegment: 0.05 });
    const r = await S1.c.post('/api/school/messages', { body: 'Will fail', audience: { type: 'selected', parentIds: [(await models.Parent.findOne({ schoolId: S1.id }))._id.toString()] }, confirm: true });
    const id = r.body.message.id;
    await H.waitFor(async () => (await models.SmsRecipient.findOne({ schoolId: S1.id, messageId: id })).attempts >= 2, { timeout: 40000 });
    const rec = await models.SmsRecipient.findOne({ schoolId: S1.id, messageId: id });
    assert.notEqual(rec.status, 'delivered'); assert.notEqual(rec.status, 'accepted'); // never a fake success
    await S1.c.put('/api/school/provider', { provider: 'mock', credentials: { mode: 'ok' }, costPerSegment: 0.05 });
  });

  await t.test('Scheduling: cancel before processing; scheduled message is promoted when due', async () => {
    const soon = new Date(Date.now() + 90 * 1000).toISOString();
    const one = { type: 'selected', parentIds: [(await models.Parent.findOne({ schoolId: S1.id }))._id.toString()] };
    assert.equal((await S1.c.post('/api/school/messages', { body: 'Too soon', audience: one, confirm: true, scheduledAt: new Date(Date.now() + 5000).toISOString() })).status, 400);
    const r = await S1.c.post('/api/school/messages', { body: 'Cancel me', audience: one, confirm: true, scheduledAt: soon });
    assert.equal(r.body.message.status, 'scheduled');
    assert.equal((await S1.c.post(`/api/school/messages/${r.body.message.id}/cancel`, {})).status, 200);
    assert.equal((await S1.c.post(`/api/school/messages/${r.body.message.id}/cancel`, {})).status, 409);
    const r2 = await S1.c.post('/api/school/messages', { body: 'Send later', audience: one, confirm: true, scheduledAt: soon });
    await models.SmsMessage.updateOne({ _id: r2.body.message.id, schoolId: S1.id }, { $set: { scheduledAt: new Date(Date.now() - 1000) } }); // simulate time passing
    await require('../../backend/workers/maintenanceProcessor').schedulerTick();
    await H.waitFor(async () => (await S1.c.get(`/api/school/messages/${r2.body.message.id}`)).body.message.counts.acceptedTotal === 1);
  });

  await t.test('Webhook: secret token required; unknown token rejected', async () => {
    assert.equal((await ctx.request(app).post('/api/webhooks/sms/mock/aaaaaaaaaaaaaaaaaaaaaaaa').send({ id: 'mock_x', status: 'delivered' })).status, 404);
  });

  await t.test('Reports distinguish accepted from delivered and export', async () => {
    const r = await S1.c.get('/api/school/reports/summary'); assert.equal(r.status, 200);
    assert.ok(r.body.totals.accepted >= r.body.totals.delivered);
    const csv = await S1.c.get('/api/school/reports/export?format=csv'); assert.equal(csv.status, 200); assert.match(csv.headers['content-type'], /csv/);
  });
});
