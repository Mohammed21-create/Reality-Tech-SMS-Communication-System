# Architecture

```
Browser (PWA)  ──HTTPS──►  Render load balancer ──► Web service (N instances, stateless)
                                                       │  enqueue only
                                         ┌─────────────┴──────────────┐
                                         ▼                            ▼
                                  MongoDB Atlas                 Redis / Key Value
                                  (all state)            (BullMQ queues, fairness lists,
                                         ▲                rate-limit counters)
                                         │                            ▲
                                         └────── Worker service (M instances) ──┘
                                                  prepare · send · maintenance
                                                          │
                                                          ▼
                                       School's own SMS provider (Arkesel, …)
```

## Multi-tenancy

* One shared database. Every school-owned collection has `schoolId` (required, indexed, first field of compound indexes).
* **Tenant identity comes only from the server-side session**: `requireAuth('school')` loads session → user → school from MongoDB and sets `req.tenantId`. Request bodies/params/queries are never trusted for tenant selection (integration test posts a foreign `schoolId` and verifies it is ignored).
* **Database guard** (`plugins/tenantGuard.js`): every `find/update/delete/count/aggregate` on tenant models throws unless the filter contains a plain `schoolId` (operators such as `{ $ne: null }` are rejected). Platform jobs that must span tenants opt out explicitly with `skipTenantGuard`, which makes them easy to audit (`grep skipTenantGuard`).
* Sessions are per realm (`rt_admin_sid`, `rt_school_sid`); a super-admin session cannot call school APIs and vice versa. Suspending a school deletes its admins' sessions and blocks login/API immediately (checked on every request).
* Evolution path: all data access goes through Mongoose models with `schoolId`; a large school can later be moved to its own database by resolving the connection per tenant in the model layer, without changing controllers.

## SMS pipeline

1. **Web**: `POST /api/school/messages` validates (confirmation flag, idempotency key, expected recipient count, sender ID, provider ready, maintenance mode), stores the message (`preparing` or `scheduled`) and enqueues a `prepare` job. It returns immediately.
2. **Prepare worker**: streams active parents with a cursor, de-duplicates numbers, inserts `SmsRecipient` rows (unique `(messageId, phone)` ⇒ re-runs are safe) in batches of `SMS_BATCH_SIZE`, then pushes batch descriptors to the school's Redis list.
3. **Fair dispatcher** (runs in every worker): round-robins across schools with pending batches and moves **one batch per school per round** into the BullMQ `sms-send` queue. Redis Lua atomically enforces *max in-flight batches per school* (default 2) and the queue backlog cap, so a school with 100k recipients cannot starve a school with 50.
4. **Send worker**: atomically claims the batch's `queued` recipients (`queued → sending` with a claim token), applies the per-school provider rate limit, calls the provider, then writes per-recipient outcomes.
   * temporary failure (network, 429, 5xx) → claim released, job retried by BullMQ with exponential backoff (5s, 10s, 20s…, `SMS_MAX_ATTEMPTS`); after the last attempt recipients are marked `failed` (retryable) and the batch goes to the **dead-letter queue** (`sms-dead`).
   * permanent failure (bad credentials) → recipients `failed`, not retried automatically.
   * ambiguous result (provider did not mention a number) → `uncertain`, never auto-resent.
5. **Delivery reports**: provider webhook (`/api/webhooks/sms/:provider/:secret`) and a poller (providers that support status queries) move `accepted → delivered|failed`. Delivered recipients are never downgraded.
6. **Maintenance jobs** (BullMQ job schedulers, de-duplicated across instances): scheduled-message promotion (15s), delivery polling (30s), counter reconciliation (60s), stale-claim reaper (120s).

**Idempotency layers:** client idempotency key (unique index) · unique `(messageId, phone)` · atomic claim before sending · deterministic BullMQ job ids · retries only touch `failed`+retryable recipients through an atomic status flip.

**Counters** on `SmsMessage.counts` are updated incrementally (`$inc`) on the hot path and recomputed from recipients by the reconciler, so dashboards stay fast on 100k-recipient messages and self-correct.

## Scaling

| Need | How |
|---|---|
| More web capacity | raise web `numInstances`; stateless (sessions in Mongo, limits in Redis) |
| More SMS throughput | add worker instances or raise `SMS_SEND_CONCURRENCY`; fairness and rate limits are Redis-global so they hold across instances |
| Many schools | indexes lead with `schoolId`; paginated lists; aggregations start with `$match: { schoolId }` |
| Provider limits | `limits.maxPerSecond` per provider, enforced per school across all workers |

## Security summary

Passwords: bcrypt (cost 12). Sessions: random 256-bit id, only the SHA-256 stored; idle (30 min) + absolute (12 h) expiry; rotated on password change. CSRF: per-session token header on every state-changing call + SameSite=Strict + Origin check. Brute force: per-IP and per-account Redis limits plus account lockout (5 failures → 15 min). Provider credentials: AES-256-GCM, key from `ENCRYPTION_KEY` env var, AAD = school id, never returned or logged (logger redacts secret-like keys). Uploads: type detected from file bytes; formula injection neutralised in CSV/Excel exports. CSP: `script-src 'self'` (no inline scripts or styles anywhere in the frontend).
