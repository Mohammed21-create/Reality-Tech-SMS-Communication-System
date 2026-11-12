# Reality Tech School Communication System

Multi-tenant SMS SaaS: Reality Tech registers schools; each school gets a private dashboard to manage parent contacts and send, schedule and track SMS announcements through **its own SMS provider account** (the school pays its provider directly).

**Stack (strict):** HTML5 · CSS3 · vanilla JavaScript (ES modules) · Node.js · Express · MongoDB Atlas (Mongoose) · Redis + BullMQ workers · installable PWA · deployed on Render. No frontend frameworks, no TypeScript, no Tailwind.

## What is included

| Area | Implementation |
|---|---|
| Reality Tech portal (`/admin/`) | separate login; register / edit / activate / suspend / deactivate / reactivate schools; add school admins; secure password reset (one-time temporary password, forced change); platform and per-school SMS usage; system health (Mongo, Redis, queues, memory, storage); platform settings (maintenance mode, fairness cap); audit & security logs |
| School portal (`/school/`) | dashboard; parents CRUD, multiple numbers, Ghana + international validation, duplicate detection, CSV/Excel import, CSV/Excel export, search/filter/pagination; students (optional); compose with live segment/cost preview, confirmation step, scheduling, cancel, retry; message history with per-recipient status; reports with date filter and CSV/Excel export; school profile, logo, sender ID, signature; SMS provider setup, connection test, balance |
| SMS pipeline | web app only *enqueues*; separate worker processes build recipients, send in batches, retry with exponential backoff, dead-letter failed batches, claim recipients atomically (no duplicate sends), fair round-robin across schools, per-school provider rate limiting, delivery receipts by webhook and polling |
| Honesty about delivery | `accepted` (provider took it) and `delivered` (provider confirmed) are separate states everywhere. Nothing is ever shown as delivered without a provider receipt. Offline actions are blocked, not queued. |
| Security | bcrypt, server-side sessions in httpOnly SameSite=Strict cookies, CSRF tokens, Origin check, lockout + Redis rate limits, Helmet + strict CSP, NoSQL-operator stripping, tenant guard at DB layer, AES-256-GCM encrypted provider credentials (bound to school id), audit log, idle timeout (server + client), HTTPS redirect |
| PWA | manifest, icons (incl. maskable), service worker (static shell only, never `/api`), offline page, online/offline indicator, install button (+ iOS hint) |

## Quick start (local)

Requirements: Node 20+, MongoDB, Redis (or `docker compose up -d`).

```bash
npm install
cp .env.example .env
# generate the encryption key and paste into ENCRYPTION_KEY:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

docker compose up -d            # MongoDB + Redis for development
npm run db:indexes              # build indexes
npm run seed:superadmin         # prints a one-time password for admin@realitytech.com
npm run seed:demo               # optional: demo school using the MOCK provider

npm run dev                     # terminal 1: web  -> http://localhost:3000
npm run dev:worker              # terminal 2: SMS workers
```

* Reality Tech sign-in: `http://localhost:3000/admin/login.html`
* School sign-in: `http://localhost:3000/login.html`
* Every seeded/created account gets a temporary password and **must change it at first sign-in**.
* The **Mock provider** (Settings → SMS provider) lets you test everything without spending credits. It accepts messages, then reports delivery later via status polling, and can simulate failures (`temporary_failure`, `down`, `auth_error`; numbers ending `0000` are rejected). Set `ALLOW_MOCK_PROVIDER=false` in production.

## Project structure

```
frontend/                 static app served by Express (separate HTML / CSS / JS files)
  index.html login.html change-password.html offline.html manifest.json service-worker.js
  admin/  school/         page shells
  css/app.css             one design system for both portals
  js/core/                api, ui helpers, layout shell, charts (SVG, no library), pwa
  js/pages/               one module per page
backend/
  server.js               web process          workers/index.js   background worker process
  app.js                  express app factory  config/            env, db, redis
  routes/ controllers/    thin HTTP layer      middleware/        auth, csrf, rate limit, security, errors
  models/ plugins/        Mongoose models + tenantGuard
  services/               auth, messages, provider config, delivery, stats
  services/sms/           provider interface + arkesel + mock    (add providers here)
  queues/                 BullMQ queues + fair scheduler
  workers/                prepare, send, maintenance processors
  scripts/seed.js         super admin, demo data, index sync
tests/unit  tests/integration  tests/load
docs/                     ARCHITECTURE.md  DEPLOYMENT.md  TESTING.md
render.yaml  docker-compose.yml  .env.example
```

## Adding an SMS provider

1. Create `backend/services/sms/<name>.js` extending `SmsProvider` (`send`, optional `checkStatus`, `getBalance`, `testConnection`, `parseWebhook`, `limits`, `meta.fields`).
2. Register it in `backend/services/sms/index.js`.

The settings form, encryption, queues, retries, rate limiting and delivery tracking all work without further changes.

## Provider verification (read before going live)

The Arkesel adapter follows Arkesel's public v2 API documentation (`/sms/send`, `/clients/balance-details`). I could not call their API from the build environment, so **run a live test with a small balance before launch**: test connection, check balance, send to your own number, and confirm (a) the response parsing in `arkesel.js`, (b) how your account delivers delivery receipts. Arkesel delivery receipts are handled through the school's private webhook URL (Settings → SMS provider); the exact payload field names the adapter looks for (`id`/`message_id`/`sms_id`, `status`) should be confirmed against what Arkesel actually posts. Until receipts arrive, messages correctly stay at "accepted".

## Known limitations / design notes

* Webhook-only providers: if a receipt arrives in the instant before the worker saved the provider message id, that single receipt is ignored (providers normally take seconds). Providers that support status queries (`checkStatus`) are polled and self-heal.
* Recipients stuck in `sending` for 10 minutes after a worker crash become **unknown outcome** and are never auto-resent (could duplicate SMS); schools can opt in to retry them.
* Uploaded logos are stored in MongoDB (Render disks are ephemeral); import files are processed in memory (max 10 MB / 50,000 rows by default).
* Password reset is administrator-initiated (Reality Tech resets a school admin's password). There is no email/SMS self-service reset because the spec has no platform email provider.
* Costs shown are estimates from the per-segment rate each school enters.

See `docs/` for architecture, deployment/costs, and testing.
