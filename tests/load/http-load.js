'use strict';
// Dependency-free HTTP load test.
//   node tests/load/http-load.js                      # health endpoint
//   LOAD_EMAIL=.. LOAD_PASSWORD=.. node tests/load/http-load.js   # also exercises authenticated school endpoints
// Env: BASE_URL (default http://localhost:3000), CONCURRENCY (50), DURATION_S (20)
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const CONC = Number(process.env.CONCURRENCY || 50);
const DUR = Number(process.env.DURATION_S || 20) * 1000;

async function login() {
  if (!process.env.LOAD_EMAIL) return null;
  const r = await fetch(`${BASE}/api/school/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: process.env.LOAD_EMAIL, password: process.env.LOAD_PASSWORD }) });
  if (!r.ok) throw new Error('login failed: ' + r.status);
  return (r.headers.getSetCookie ? r.headers.getSetCookie() : []).map((c) => c.split(';')[0]).join('; ');
}

(async () => {
  const cookie = await login();
  const targets = [`${BASE}/healthz`];
  if (cookie) targets.push(`${BASE}/api/school/dashboard`, `${BASE}/api/school/parents?limit=25`, `${BASE}/api/school/messages`);
  const lat = []; let ok = 0; let errs = 0; const codes = {};
  const end = Date.now() + DUR;
  async function worker(i) {
    while (Date.now() < end) {
      const url = targets[(i++) % targets.length]; const t0 = performance.now();
      try {
        const r = await fetch(url, { headers: cookie ? { Cookie: cookie } : {} });
        await r.arrayBuffer(); lat.push(performance.now() - t0); codes[r.status] = (codes[r.status] || 0) + 1; if (r.ok) ok++; else errs++;
      } catch { errs++; }
    }
  }
  await Promise.all(Array.from({ length: CONC }, (_, i) => worker(i)));
  lat.sort((a, b) => a - b); const p = (q) => (lat[Math.floor(lat.length * q)] || 0).toFixed(1);
  console.log(JSON.stringify({ targets: targets.length, concurrency: CONC, seconds: DUR / 1000, requests: lat.length, rps: Math.round(lat.length / (DUR / 1000)), ok, errors: errs, statusCodes: codes, latencyMs: { p50: p(0.5), p95: p(0.95), p99: p(0.99), max: (lat[lat.length - 1] || 0).toFixed(1) } }, null, 2));
  if (codes[429]) console.log('Note: 429 responses are the rate limiter doing its job (API limit: 600 requests/minute per IP). Raise it temporarily to measure raw capacity.');
})();
