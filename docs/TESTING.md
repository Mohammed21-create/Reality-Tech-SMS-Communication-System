# Testing

```bash
npm test                         # unit tests, no services needed
TEST_MONGODB_URI=mongodb://127.0.0.1:27017/rt_test \
TEST_REDIS_URL=redis://127.0.0.1:6379/1 \
npm run test:integration         # DROPS the test database and flushes the Redis DB - use throwaway instances!
npm run load:http                # HTTP load (needs the web app running)
npm run load:queue               # queue throughput + fairness (needs worker(s) running)
```

## Coverage map (your requirement list → tests)

| # | Requirement | Where |
|---|---|---|
| 1 | Reality Tech login | `integration/platform.test.js` (login, wrong password, realm separation) |
| 2-3 | School registration, activation/suspension | `platform.test.js` (register, duplicate name, suspend needs reason, sessions revoked, reactivate) |
| 4 | School admin login, forced password change | `platform.test.js` |
| 5 | Tenant isolation | `platform.test.js` (cross-school read/update/delete → 404, foreign `schoolId` ignored, DB tenant guard throws), `sms-flow.test.js` (messages/recipients/retry isolation) |
| 6-7 | Parent management, CSV import | `platform.test.js`; phone rules in `unit/phone.test.js` |
| 8-9 | Provider configuration + connection test | `sms-flow.test.js` (encrypted at rest, secrets never returned, test, balance) |
| 10-12 | Bulk send, queue processing, delivery reports | `sms-flow.test.js` (confirmation, idempotency, accepted vs delivered, DLR polling, no duplicate recipients, temporary-failure retry without fake success) |
| 13 | Scheduled messages | `sms-flow.test.js` (too-soon rejected, cancel, promotion when due) |
| 14 | PWA | manual checklist below |
| 15 | Security/authorization | `platform.test.js` (CSRF, unauthenticated, cross-realm, lockout, audit log), `unit/crypto`, `unit/sanitize-csv-pagination`, `unit/password` |
| 16 | Load/performance | `tests/load/*` |

## Manual PWA checklist
1. Open the site over HTTPS (or `localhost`) in Chrome → DevTools → Application → *Manifest*: no errors, icons present.
2. *Service Workers*: registered and running. Lighthouse → PWA/installable passes.
3. Install (address-bar icon or in-app **Install app** button). On iOS Safari: Share → Add to Home Screen.
4. Go offline (DevTools → Network → Offline): banner appears, pages fall back to the offline page, compose/send buttons are disabled and API calls fail with "You are offline… Nothing was sent."

## Status of this delivery
Unit tests for phone normalisation, SMS segment maths, encryption, password policy, input sanitising, CSV safety, pagination and the mock provider were executed and pass. All source files pass `node --check`. The integration and load suites need real MongoDB/Redis and `npm install`, which were not available in the build environment, so **they have been written but not yet run** - expect to fix small issues on first run and treat the first green run as part of acceptance.
