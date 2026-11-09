# Backend

Express 5 + `pg` + Zod on Bun. Two route trees that share no HTTP code (`/api/user`,
`/api/admin`) over one shared `src/core/`. A separate job worker process.

Architecture and decisions: `../../Docs/`. Start at `Docs/Implimnetation.md`.

> **Current state:** Phase 0 and sub-phase 1A are built and verified — env, the 28-table
> schema, the migration runner, the error envelope, health endpoints, the two tree routers,
> CORS, rate limiting, `core/policy.ts` and the `response.locals` contract. Resource folders
> arrive with their sub-phase, so the endpoint map below is the plan, not what answers today.
> `bun run worker` and `bun run seed` have no files until 1H and 1J.

## Prerequisites

- Bun 1.3.9+
- PostgreSQL 13+ (verified on 18) — `gen_random_uuid()` must be available
- A second database for tests. The suite is destructive.

## Setup

```bash
bun install                 # from the repo root
cp apps/Backend/.env.example apps/Backend/.env
# fill in .env, then:
bun run migrate             # apply migrations
bun run seed                # synthetic demo data
```

## Environment

Names only — never commit values. Full list in `.env.example`. Validated by `src/env.ts` at
boot; a missing or malformed variable exits the process naming it.

| Name | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | |
| `TEST_DATABASE_URL` | for tests | Must differ from `DATABASE_URL` |
| `PORT` | no | Default 3001 |
| `APP_ORIGIN` | yes | Web app origin, no trailing slash. Drives the CORS allowlist |
| `API_PUBLIC_ORIGIN` | yes | This API's public origin, no trailing slash |
| `JWT_SECRET` | yes | ≥32 chars. Signs access tokens. Refresh credentials are opaque and hashed, so they need no secret |
| `GOOGLE_CLIENT_ID` / `_SECRET` | together or not at all | Absent ⇒ Google sign-in disabled and reported as such at boot. **There is no redirect-URI variable** — `env.ts` exports `googleRedirectUri`, derived as `<API_PUBLIC_ORIGIN>/api/user/auth/google/callback`. Register that exact URL in the Google Cloud console |
| `GEMINI_API_KEY` | for AI | Absent ⇒ the AI pipeline fails loudly rather than faking results. `bun run preflight` makes one real call to prove the key and model |
| `GEMINI_MODEL` | no | Default `gemini-3.5-flash-lite` |
| `DEMO_MODE` | no | Exposes scoped mock OTP codes and the payment `outcome` field. Never enable in a real deployment |

Database and AI credentials are server-side only. They must never appear in a Vite client
variable.

## Commands

```bash
bun run preflight     # prove env: both DBs migrated + distinct, one real Gemini call
bun run dev           # API, hot reload                 → src/index.ts
bun run worker        # job worker, separate process    → src/jobs/worker.ts
bun run migrate       # apply pending migrations
bun run migrate --status
bun run seed          # synthetic data (refuses a non-empty DB without a flag)
bun test              # requires TEST_DATABASE_URL
bun run check-types
```

Run the API and the worker as **two processes**. Hold expiry, payment events, simulated
delivery, refunds and AI processing all happen in the worker.

## Migrations

Numbered SQL in `migrations/`, applied in filename order, each in its own transaction, recorded
in `schema_migrations` with a checksum. A second run is a no-op. Editing an already-applied
migration is refused — add a new one.

Seeds are separate from migrations and never run as part of one.

## Layout

```
migrations/  seeds/
src/
  index.ts  app.ts  router.ts  env.ts  db.ts  core/policy.ts  types/express.d.ts
  middleware/   requestId errors cors rateLimit idempotency userAuth adminAuth demoOnly
  routes/user/    13 resource folders     routes/admin/   18 resource folders
  routes/system/  health mock
  core/         pricing inventory booking tokens audit jobs enquiry/
  adapters/     mockPayments messaging ai/
  jobs/         worker.ts handlers/
tests/
```

Each resource folder is `routes.ts` + `schema.ts` + `controllers.ts`. Trace an endpoint:
`router.ts → routes/<tree>/<feature>/routes.ts → controllers.ts`.

## Endpoint map

Full tables with request shapes in `Docs/10-phase1-backend-guest.md` and
`Docs/11-phase2-backend-staff.md`. Guards in `Docs/02-permissions.md`.

**`/api/user`** — `auth` · `account` · `content` · `rooms` · `availability` · `quotes` ·
`promos` · `bookings` · `payments` · `enquiries` · `enquiryMessages` · `eventEnquiries` ·
`analytics`

**`/api/admin`** — `auth` · `enquiries` · `enquiryMessages` · `enquiryDrafts` ·
`enquiryAssignment` · `notifications` · `rooms` · `bookings` · `bookingCalendar` · `exports` ·
`rates` · `inventory` · `blackouts` · `promos` · `staff` · `resortInfo` · `reports` · `audit`

**Root** — `GET /healthz` (liveness) · `GET /readyz` (readiness, database round trip) ·
`POST /api/mock/inbound/:channel` (demo-gated)

## Testing

`bun test` against `TEST_DATABASE_URL`. Cases are specified in `Docs/tests-phase1.md` and
`Docs/tests-phase2.md` and are written **before** the code they cover. Concurrency cases use
real parallel transactions, not sequential calls — mocking away inventory correctness defeats
the point.

## Mocks and what is real

Real: PostgreSQL, authentication, the booking and inventory logic, the job queue, the Gemini
call.

Simulated: payments (no provider; a server-side mock ledger drives genuine state transitions),
email and WhatsApp delivery (recorded, never sent), refunds, OTP delivery. The OTP
*challenge* logic — expiry, single use, purpose binding, attempt and resend limits — is real;
only delivery is mocked.

Reviewers exercise the simulated paths through: the demo-gated `outcome` field on a payment
attempt (`succeed` / `decline` / `succeed_late`), `POST /api/mock/inbound/:channel` for
simulated email and WhatsApp enquiries, and scoped OTP code exposure for seeded reviewer
identities under `DEMO_MODE`. There is no universal bypass code and no endpoint exposes other
users' codes.

## Known limitations

- No OTA or channel-manager synchronisation. Staff configure the website allotment to be
  consistent with outside allocations; the site only ever sells that allotment.
- No physical room-number assignment — guests buy a room type.
- No booking changes, extensions, cancellation or discretionary refunds. The automatic refund
  of a late payment is payment recovery, not a cancellation feature.
- Owner metrics describe website activity only. They are not complete resort financials and
  carry no profit or total-occupancy figure.
