# Deployment on Render

## Services

| Render service | Purpose | Start command |
|---|---|---|
| Web Service | Express app + static frontend | `node backend/server.js` (health check `/healthz`) |
| Background Worker | SMS processing (scale independently) | `node backend/workers/index.js` |
| Key Value (Redis-compatible) | BullMQ, fairness, rate limits | managed |
| MongoDB Atlas | database | external |

`render.yaml` in the repo is a Blueprint for the three Render services. Steps:

1. Create a MongoDB Atlas cluster (dedicated tier for production, region close to Render's), create a database user, and allow Render's outbound IPs (or use a private-networking option). Copy the connection string.
2. Push the repo to GitHub/GitLab. In Render: **New → Blueprint**, select the repo.
3. Set the secrets Render asks for: `MONGODB_URI`, `ENCRYPTION_KEY` (64 hex chars, **keep a copy in your password manager - losing it makes stored provider credentials unrecoverable**), `BASE_URL` (your public https URL). `REDIS_URL` is wired automatically from the Key Value instance. Use the same `ENCRYPTION_KEY`/`MONGODB_URI` on web and worker.
4. Deploy, then open a Render shell on the web service and run:
   ```
   npm run db:indexes
   npm run seed:superadmin     # prints a one-time password
   ```
5. Sign in at `/admin/login.html`, change the password, register your first school.
6. Add your custom domain (HTTPS is automatic; the app also redirects HTTP→HTTPS and sends HSTS).

Graceful shutdown (SIGTERM) is implemented in both processes: the web server stops accepting connections and drains; workers finish in-flight batches before exiting. Unfinished work is safe because batches are claimed atomically and retried.

## Sizing and cost guidance

Do **not** run production on free plans: free web services sleep when idle, free instances have no background-worker option, and free Key Value storage is not durable - queued SMS would be lost on restart.

Indicative Render prices (USD/month, **as published in mid-2026 third-party summaries - confirm on https://render.com/pricing before budgeting**):

| Item | Starter | Production suggestion |
|---|---|---|
| Web service | ~$7 (512 MB) | Standard ~$25 (2 GB), 2 instances for redundancy ≈ $50 |
| Background worker | ~$7 (512 MB) | Standard ~$25 × 2 instances ≈ $50 |
| Key Value (Redis) | ~$10 (256 MB) | Standard ~$32 (1 GB) |
| Render workspace | Hobby $0 | Professional ~$25/user/month (required for some team features) |
| MongoDB Atlas | M0 free (dev only) | M10 ≈ $57+ (dedicated, backups) |

Rough production floor ≈ **$150-250/month** for the platform. SMS charges are **not** included: each school pays its own provider.

Capacity rules of thumb: each worker instance runs 5 concurrent batches × 100 recipients; with a ~0.5 s provider call that is on the order of a few hundred to ~1,000 SMS/second per instance *before* provider limits (the Arkesel adapter caps each school at `ARKESEL_MAX_PER_SECOND`, default 50/s - set it from your provider's documented limit). Measure with `npm run load:queue`.

Redis memory: queue payloads are tiny (batch descriptors, not recipient lists) - 256 MB-1 GB is ample. Keep `maxmemory-policy noeviction`.

## Operations

* **Logging**: JSON lines on stdout/stderr (secrets redacted); Render's log streams can be forwarded to Datadog/Better Stack/Papertrail. Each request has an `X-Request-Id` also included in error responses.
* **Error monitoring**: add Sentry (or similar) in `middleware/errorHandler.js` and `workers/index.js` (`worker.on('failed')`); the hooks are the single place errors surface.
* **Health**: `/healthz` (liveness), `/readyz` (Mongo + Redis), and the Reality Tech dashboard → *System & settings* (queue depths, dead-letter count, memory, DB size).
* **Alerts to configure**: Render service-down, Atlas connection/replication alerts, `sms-send` waiting > 1,000 for 10 min, `sms-dead` growing, `/readyz` failing.
* **Backups**: enable Atlas continuous backup (M10+) with point-in-time restore; test a restore quarterly. Redis holds only transient queue state - after a Redis loss, run the reconciler: stuck `queued` recipients can be re-queued by the schools using *Retry*; nothing is auto-resent to avoid duplicates.
* **Disaster recovery plan (summary)**: (1) infrastructure is declared in `render.yaml` - recreate services in another region; (2) restore Atlas to a new cluster from the latest snapshot / PITR; (3) point `MONGODB_URI`, reuse the same `ENCRYPTION_KEY`; (4) provision Key Value; (5) run `npm run db:indexes`; (6) verify `/readyz`; (7) check schools' *accepted but not delivered* messages and offer retry. Target: RPO ≤ 1 hour with PITR, RTO ≤ 2 hours.
* **Key rotation**: rotating `ENCRYPTION_KEY` requires a re-encryption script (decrypt with old key, encrypt with new) - not included; plan for it before the first rotation.
* **Scaling workers**: Render dashboard → worker → instances. No code or config change.
