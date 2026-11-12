'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

test('Reality Tech platform flows', { skip: !H.enabled && H.skipReason }, async (t) => {
  const ctx = await H.setup();
  t.after(() => H.teardown(ctx));
  const { app, client } = ctx;
  const su = await H.seedSuperAdmin();
  const admin = client(app);

  await t.test('1. Reality Tech login (and wrong password / realm separation)', async () => {
    assert.equal((await admin.login('/api/admin', su.email, 'wrong-password-1')).status, 401);
    assert.equal((await admin.login('/api/admin', su.email, su.password)).status, 200);
    assert.equal((await admin.get('/api/admin/auth/me')).body.user.role, 'super_admin');
    const other = client(app);
    assert.equal((await other.login('/api/school', su.email, su.password)).status, 401, 'super admin cannot use the school login');
  });

  let A; let B; // two schools
  await t.test('2. School registration returns a one-time temporary password', async () => {
    for (const [name, email] of [['Alpha School', 'a@alpha.test'], ['Beta School', 'b@beta.test']]) {
      const r = await admin.post('/api/admin/schools', { name, adminName: 'Head Teacher', adminEmail: email, status: 'active' });
      assert.equal(r.status, 201); assert.ok(r.body.admin.temporaryPassword);
      const s = { id: r.body.school.id, email, temp: r.body.admin.temporaryPassword };
      if (name.startsWith('Alpha')) A = s; else B = s;
    }
    assert.equal((await admin.post('/api/admin/schools', { name: 'alpha  school', adminName: 'X Y', adminEmail: 'z@z.test' })).status, 409);
  });

  const a = client(app); const b = client(app);
  await t.test('4. School admin login forces a password change', async () => {
    const r = await a.login('/api/school', A.email, A.temp);
    assert.equal(r.status, 200); assert.equal(r.body.user.mustChangePassword, true);
    assert.equal((await a.get('/api/school/parents')).status, 403, 'blocked until password is changed');
    const c = await a.post('/api/school/auth/change-password', { currentPassword: A.temp, newPassword: 'Alpha-Strong-Pass1' });
    assert.equal(c.status, 200); a.setCsrf(c.body.csrfToken);
    assert.equal((await a.get('/api/school/parents')).status, 200);
    await b.login('/api/school', B.email, B.temp);
    const c2 = await b.post('/api/school/auth/change-password', { currentPassword: B.temp, newPassword: 'Beta-Strong-Pass1' }); b.setCsrf(c2.body.csrfToken);
  });

  let parentA;
  await t.test('6. Parent management, validation and duplicates', async () => {
    const r = await a.post('/api/school/parents', { fullName: 'Ama Mensah', phones: ['0241234567'] });
    assert.equal(r.status, 201); parentA = r.body.parent; assert.equal(parentA.phones[0].number, '+233241234567');
    assert.equal((await a.post('/api/school/parents', { fullName: 'Dup', phones: ['+233241234567'] })).status, 409);
    assert.equal((await a.post('/api/school/parents', { fullName: 'Bad', phones: ['12345'] })).status, 400);
    assert.equal((await a.put(`/api/school/parents/${parentA.id}`, { fullName: 'Ama M.', phones: ['0241234567', '+447700900123'] })).status, 200);
    const list = await a.get('/api/school/parents?q=0241234567'); assert.equal(list.body.items.length, 1);
  });

  await t.test('5. Tenant isolation: school B cannot see or touch school A data', async () => {
    assert.equal((await b.get(`/api/school/parents/${parentA.id}`)).status, 404);
    assert.equal((await b.put(`/api/school/parents/${parentA.id}`, { fullName: 'Hacked', phones: ['0241234567'] })).status, 404);
    assert.equal((await b.del(`/api/school/parents/${parentA.id}`)).status, 404);
    assert.equal((await b.get('/api/school/parents')).body.pagination.total, 0);
    // a school id in the body/query is ignored: tenant comes from the session
    const sneaky = await b.post('/api/school/parents', { fullName: 'Sneaky', phones: ['0201111111'], schoolId: A.id });
    assert.equal(sneaky.status, 201);
    assert.equal((await a.get('/api/school/parents?q=Sneaky')).body.items.length, 0);
    // NoSQL operator injection in filters is neutralised
    const inj = await a.raw.get('/api/school/parents?q[$ne]=x'); assert.ok([200, 400].includes(inj.status));
    // database-level guard: unscoped queries throw
    await assert.rejects(() => ctx.models.Parent.find({}), /Tenant guard/);
    await assert.rejects(() => ctx.models.Parent.find({ schoolId: { $ne: null } }), /Tenant guard/);
  });

  await t.test('Security: CSRF, unauthenticated access, secrets', async () => {
    assert.equal((await ctx.request(app).get('/api/school/parents')).status, 401);
    const noCsrf = await a.raw.post('/api/school/parents').send({ fullName: 'X Y', phones: ['0551111111'] });
    assert.equal(noCsrf.status, 403); assert.equal(noCsrf.body.error.code, 'CSRF_FAILED');
    assert.equal((await a.get('/api/admin/schools')).status, 401, 'school session cannot call platform API');
    const h = await ctx.request(app).get('/healthz'); assert.equal(h.headers['x-powered-by'], undefined); assert.ok(h.headers['content-security-policy']);
  });

  await t.test('7. CSV import: valid, invalid and duplicate rows', async () => {
    const csv = 'Name,Phone,Phone 2\nKofi Boateng,0551234567,\nBad Number,123,\nAma Again,0241234567,\nYaa Asantewaa,233261234567,+447700900124\nIn File Dup,0551234567,\n';
    const r = await a.upload('/api/school/parents/import', 'file', Buffer.from(csv), 'p.csv');
    assert.equal(r.status, 200);
    assert.equal(r.body.imported, 2);   // Kofi, Yaa
    assert.equal(r.body.invalid, 1);    // Bad Number
    assert.equal(r.body.duplicates, 2); // Ama Again (already in DB) + In File Dup
    assert.equal((await a.upload('/api/school/parents/import', 'file', Buffer.from('x'), 'evil.exe')).status, 400);
    const dups = await a.get('/api/school/parents/duplicates'); assert.equal(dups.status, 200);
  });

  await t.test('Suspension blocks access immediately and reactivation restores it', async () => {
    assert.equal((await admin.post(`/api/admin/schools/${B.id}/status`, { status: 'suspended' })).status, 400, 'reason required');
    assert.equal((await admin.post(`/api/admin/schools/${B.id}/status`, { status: 'suspended', reason: 'Unpaid invoice' })).status, 200);
    assert.equal((await b.get('/api/school/parents')).status, 401, 'sessions are revoked');
    assert.equal((await client(app).login('/api/school', B.email, 'Beta-Strong-Pass1')).status, 403);
    assert.equal((await admin.post(`/api/admin/schools/${B.id}/status`, { status: 'active' })).status, 200);
    assert.equal((await client(app).login('/api/school', B.email, 'Beta-Strong-Pass1')).status, 200);
  });

  await t.test('Admin password reset forces change and revokes sessions', async () => {
    const detail = await admin.get(`/api/admin/schools/${A.id}`);
    const r = await admin.post(`/api/admin/schools/${A.id}/reset-admin-password`, { userId: detail.body.admins[0].id });
    assert.equal(r.status, 200); assert.ok(r.body.temporaryPassword);
    assert.equal((await a.get('/api/school/parents')).status, 401);
    const fresh = client(app); const l = await fresh.login('/api/school', A.email, r.body.temporaryPassword); assert.equal(l.body.user.mustChangePassword, true);
  });

  await t.test('Audit log captures sign-ins and school changes', async () => {
    const logs = await admin.get('/api/admin/logs?action=auth.');
    assert.equal(logs.status, 200); assert.ok(logs.body.items.some((x) => x.action === 'auth.login_failed'));
    assert.ok((await admin.get('/api/admin/logs?action=school.')).body.items.length > 0);
  });

  await t.test('Login brute-force lockout', async () => {
    const c = client(app);
    for (let i = 0; i < 5; i++) await c.login('/api/school', B.email, 'nope-nope-nope1');
    assert.equal((await c.login('/api/school', B.email, 'Beta-Strong-Pass1')).status, 429, 'locked even with the right password');
  });
});
