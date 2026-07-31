# Ciao (ciao.ly) — تشاو

Booking marketplace for Libya's beach resorts, chalets, and wedding halls.
Implementation of the design baseline **CIAO Design Document v1.6** (§20.4 Sprints 0–3+):
booking state machine, multi-rail payments with double-entry ledger, WhatsApp/SMS
channel ladder, field verification pipeline, RTL-first offline-tolerant PWA.

## Layout

```
apps/api        Fastify modular monolith (TypeScript, Drizzle ORM, PostgreSQL)
apps/web        Next.js 15 PWA — guest + host + agent + ops surfaces (Arabic RTL-first)
packages/shared Domain logic shared by both: state machine graph, pricing, fees, errors
scripts/        smoke.sh — HTTP end-to-end smoke test
```

## Local development

```bash
pnpm install
# Postgres 16 with user/db "ciao" (password "ciao"), then:
pnpm db:migrate
pnpm db:seed          # 3 Tripoli-strip coast venues + Al-Andalus wedding hall
pnpm dev              # api :4000 + web :3000
pnpm test             # 29 tests: unit (state graph, pricing, masking) + full integration
./scripts/smoke.sh    # HTTP happy-path smoke against the running stack
```

Dev conveniences: OTP codes echo in the API response (`OTP_DEV_ECHO`), the mock
payment provider serves an Arabic hosted-checkout page at
`/v1/payments/mock/checkout`, and all WhatsApp/SMS sends log to stdout.

## Deploying on Railway

Three services + two plugins in one project:

1. **Postgres** — add the Railway PostgreSQL plugin. Its `DATABASE_URL` goes to the API service.
2. **ciao-api** — deploy from repo root with `apps/api/Dockerfile`
   (the root `railway.json` points there). Migrations run automatically on boot.
   Set env vars from `.env.example`. Healthcheck: `/health`.
3. **ciao-web** — second service, same repo, `apps/web/Dockerfile`, with build arg
   `NEXT_PUBLIC_API_URL` set to the API service's public URL.
4. **ciao-worker** *(optional, recommended at scale)* — same image as ciao-api,
   start command `node dist/worker.js`, and set `WORKER_MODE=external` on ciao-api.
   Until then the API runs the durable-timer worker in-process.

Domains: attach `ciao.ly` to ciao-web and `api.ciao.ly` to ciao-api; update
`WEB_BASE_URL`, `API_BASE_URL`, `CORS_ORIGINS` accordingly.

### Design deviations worth knowing

- **Hosting**: design doc §13.6 suggested Hetzner/AWS Frankfurt; per founder decision
  this runs on **Railway** (EU region recommended when creating the project).
- **Timers**: countdowns/timeouts use a **DB-backed durable job table**
  (`scheduled_jobs`, SKIP LOCKED polling) instead of Redis/BullMQ — one less
  stateful dependency, and a queue outage can never wedge a booking (§12.5 spirit).
  Redis/BullMQ remains the upgrade path if job volume demands it.
- **Payments**: `PAYMENT_PROVIDER=mock` until the Plutu merchant account +
  sandbox credentials exist. The `PlutuProvider` implements the documented API
  shape (Sadad OTP verify/confirm, hosted-checkout rails, HMAC callbacks) but the
  **launch gates from §10.2 stand**: verify fees, settlement, refund mechanics,
  and exact callback canonicalization against the live sandbox before go-live.
- **Media**: listings carry media URL arrays; actual photo upload/CDN (Cloudflare
  Images or R2) is the next infrastructure step — field photography flows through
  ops in the meantime (matches Phase A §17.2 reality).

## What's implemented (mapped to the design doc)

| Area | Doc § | Status |
|---|---|---|
| Booking state machine, journaled + idempotent | 9.3 | ✅ + tests |
| Deposit-lock model, 20% coast / commission-in-deposit | 9.1–9.2 | ✅ + tests |
| Host confirmation windows (2h/15m/24h) + one-tap signed links | 9.4 | ✅ + tests |
| Calendar holds, blocks, attestation streaks | 9.5 | ✅ |
| Pricing engine (Fri–Sat weekend, Thursday band) | 9.6 | ✅ + tests |
| Cancellation tiers + credit-first refund ladder (+5% bonus) | 9.7, 10.6 | ✅ + tests |
| PaymentProvider abstraction, Plutu + mock, webhook HMAC + replay protection | 10.2, 13.4 | ✅ + tests |
| Double-entry ledger + reconciliation endpoint | 10.4 | ✅ + tests |
| Rail health / failover / pending-payment holds | 10.8 | ✅ |
| Messaging channel ladder + Arabic template registry + quiet hours | 12.4, 13.5 | ✅ |
| Phone-OTP auth, JWT rotation, RBAC, action tokens | 13.3, 13.8 | ✅ + tests |
| Contact masking pre-deposit (incl. Arabic-Indic digits) | 8.7 | ✅ + tests |
| Reviews: double-blind, verified-stay-only, loyalty credit | 8.8 | ✅ + tests |
| Verified badge pipeline: agent bundles → ops approval → badge | 8.10, 11.2 | ✅ |
| Reliability scores + strikes | 11.4 | ✅ |
| Guest PWA: search/filters (satar, generator, women's capacity), listing anatomy, booking widget, voucher w/ offline cache | 8.2–8.5, 12.2 | ✅ |
| Host PWA: confirm/decline, calendar blocks, payouts, coaching | 8.3 | ✅ |
| Agent PWA: offline checklist queue + sync | 8.10 | ✅ |
| Ops console: concierge intake + pay-by-link, rails, reconciliation, refunds | 8.1, 17.2 | ✅ |
| Wedding-hall schema: packages, sessions, visit bookings, Exchange tables | 8.6, 9.8 | schema + listing UI ✅; Phase C flows next |

## Next (per §20.4 / §17)

1. Plutu sandbox credentials → live provider verification (launch gate).
2. WhatsApp Business API (BSP) onboarding → swap `MESSAGING_PROVIDER`.
3. Media upload + CDN pipeline for agent photography.
4. Phase C: hall session calendars end-to-end, staged payments, contract PDFs, Exchange flows.
5. PostHog analytics, Sentry, status page (§13.6, §13.9).
