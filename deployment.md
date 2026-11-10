**GitHub:** https://github.com/manas987/Resort-Booking

# Deployment and reviewer guide


Project: **The Quiet Estate — direct booking and AI enquiry routing.**

How to run this project, and what it needs. Environment variables appear here **by name only** —
no values, ever.

No hosted application URL has been verified. The deployment sections describe the required
Vercel and Railway setup; local API, database and mock-payment flows have been checked.

---

## 1. Requirements

| | Version used |
|---|---|
| [Bun](https://bun.sh) | 1.3.9 |
| PostgreSQL | 14 or later (needs `gen_random_uuid()`, partial unique indexes, `FOR UPDATE OF`) |
| A Google Gemini API key | For the AI step. Without one the app runs; enquiry classification does not |

No Node, no Docker, no Redis, no other service.

## 2. Install

```bash
git clone https://github.com/manas987/Resort-Booking.git
cd Resort-Booking
bun install
```

One lockfile at the repository root covers both apps (Turborepo + Bun workspaces).

## 3. Databases

Two, and they must be different — **the test suite truncates every table between cases.**

```bash
createdb resort_dev
createdb resort_test
```

Keep the test database local even if the dev one is hosted. The suite resets every table
between each of ~300 cases; over a network on a free tier that is slow and pointless.

## 4. Configure

```bash
cp apps/Backend/.env.example apps/Backend/.env
```

Then fill it in. `apps/Backend/.env.example` is the authoritative list and explains each entry;
the names are:

| Name | Notes |
|---|---|
| `NODE_ENV` | `development` or `production` |
| `PORT` | The API port. `3001` in development, because the Vite dev server proxies `/api` there |
| `DATABASE_URL` | The application database. On a hosted provider, set an explicit `sslmode` rather than relying on a default |
| `TEST_DATABASE_URL` | **A different database.** Destructive |
| `APP_ORIGIN` | Where the browser loads the site from. Drives the CORS allowlist and the refresh-cookie scope. No trailing slash |
| `API_PUBLIC_ORIGIN` | Where the API is publicly reachable. No trailing slash |
| `JWT_SECRET` | Signs short-lived access tokens. At least 32 characters. Refresh credentials are opaque random values stored as hashes and need no secret |
| `GOOGLE_CLIENT_ID` | Google sign-in. Both Google values together, or neither |
| `GOOGLE_CLIENT_SECRET` | As above |
| `GEMINI_API_KEY` | Enables the AI step |
| `GEMINI_MODEL` | The model id, e.g. a Gemini Flash variant |
| `DEMO_MODE` | See section 12. **Must be off in production** |

The frontend reads two of its own, at **build** time (Vite inlines them, so a change needs a
rebuild). Both are optional and the app renders without either:

| Name | Notes |
|---|---|
| `VITE_DEMO_MODE` | Turns on the reviewer affordances in the browser. Must match the API's `DEMO_MODE`, and must be off in production |
| `VITE_MAPBOX_PUBLIC_TOKEN` | A Mapbox **public** token for the location map. Absent, the map is simply not rendered. Never put a secret token here — anything `VITE_`-prefixed is in the bundle |

There is deliberately no `GOOGLE_REDIRECT_URI`: it is derived as
`<API_PUBLIC_ORIGIN>/api/user/auth/google/callback`, because that route belongs to this codebase
and a hand-maintained copy could only drift away from it. Register exactly that URI with Google.

Secrets are read from the environment only. They are never committed, never reach the client
bundle, and never appear in a log line.

## 5. Migrate and seed

```bash
bun run migrate     # applies apps/Backend/migrations/*.sql, checksummed and idempotent
bun run seed        # synthetic fixtures; refuses a non-empty database unless --force
```

Existing installations must also apply `002_guest_onboarding.sql` before restarting services.
It adds the registration-completion flag without resetting existing accounts.

Re-running `migrate` is a no-op; a modified migration file is refused on checksum rather than
silently reapplied.

The seed creates four room types totalling 76 keys, rate and blackout overrides, bookings in
every lifecycle state (confirmed, pending payment, payment failed, expired, late refund),
promo codes, all seven sections of the versioned approved content, staff accounts in each role,
guest accounts, and the three enquiry fixtures from the brief — verbatim, with their original IDs
and message text, each with a real `classify_enquiry` job queued so the worker classifies them
for real. Alongside those sit enquiries in every other state worth seeing — unassigned,
low-confidence, a complaint, a failed AI run, a reopened thread, and two reassigned after their
owner was disabled — each with a guest message, because an enquiry with an empty thread is a
state the running system cannot produce.

## 6. Preflight

```bash
bun run --cwd apps/Backend preflight
```

Checks the environment, the database connection, applied migrations and — with a real call —
whether the Gemini key and model actually answer, distinguishing "key rejected" from "live but
out of quota". Run this before concluding something is misconfigured.

## 7. Run

Three processes. **All three, or the app will appear to hang at payment.**

```bash
bun run api        # the HTTP API          (apps/Backend, :3001 by default)
bun run worker     # the job worker        (separate process, no HTTP port)
bun run web        # the Vite dev server   (apps/Frontend, :5173)
```

**The worker is not optional.** Payment confirmation and AI classification are done by it, not
by the request that triggers them. Without it a booking sits at `pending_payment` for ever and
enquiries stay unclassified, with no error anywhere — the request succeeded, the follow-up work
simply never ran.

**The API and the worker read `DATABASE_URL` independently at startup.** Pointing them at
different databases — including briefly, while changing the value — produces exactly that
symptom. If a booking will not confirm, check this first.

In development the browser talks only to the Vite dev server, which proxies `/api` to
`http://localhost:3001` (`apps/Frontend/vite.config.ts`). That keeps every request relative,
keeps the refresh cookie first-party, and removes CORS from the development loop.

For production, `bun run build` emits static assets to `apps/Frontend/dist`; serve them from any
static host and run the API and worker as long-lived processes. `GET /healthz` is liveness (it
touches nothing else, so a database blip does not get the container restarted into the same
blip). `GET /readyz` is readiness and requires a working database round trip; its `configured`
block reports which optional integrations this instance is set up for, which is not a claim that
they are reachable.

## 8. Reviewer accounts

The seed creates these. Every one is synthetic, and so is every booking, enquiry and price they
can see.

**Staff console** — password `ReviewerDemo!2026` for active accounts below. It is a seed constant, not an
environment secret; change it before any deployment that is not a review.

| Username | Who | Sees |
|---|---|---|
| `owner` | Asha Rao | Everything, including reports and the activity log |
| `gm` | Vikram Shetty | Rates, allotment, promos, team, resort information. No reports, no audit |
| `priya` | Priya Nair, reservations | Deliberately disabled fixture; sign-in must be rejected |
| `arjun` | Arjun Menon, reservations | As above — a second account, for testing assignment between two people |
| `divya` | Divya Kumar, sales | Wedding and offsite enquiries. **No CSV export** (INV-37) |
| `rahul` | Rahul Varma, sales | As above |

Signing in as more than one of these is the quickest way to see that the permission matrix is
enforced server-side: a GM gets `403` on `/api/admin/reports`, not a hidden menu item (INV-33).

**Guest site** — `demo@resort.test`, phone `+910000000000`. Both contacts are
pre-verified. Under `DEMO_MODE` its OTP response carries the code, so there is no mail server in
the loop; that applies to these two reserved destinations only (section 12).

### Reviewer walkthrough

1. Start all three processes above. Open `http://localhost:5173` for guests or
   `http://localhost:5173/console` for staff. Set both demo flags for a review environment only.
2. For staff, use `owner` and the password above to explore rates, bookings, enquiries and logs.
3. For guests, select dates, add rooms and open checkout. Sign in with `demo@resort.test`.
   Use the fresh OTP displayed by the demo UI; there is no fixed OTP. If phone verification is
   requested, use the reserved demo phone above.
4. Continue to the test payment step, pay and wait for confirmation. No real card or money is used.
5. In the employee inbox, inspect the brief's three sample enquiries and AI drafts. Replies require
   staff approval; outbound email and WhatsApp are simulated.

Existing guests return after email OTP or Google verification. New guests also verify their
phone and confirm an editable name (prefilled from Google when available). Real email/SMS delivery
is not connected: arbitrary new contacts cannot receive OTP messages. Use the seeded contacts
for the reviewer demonstration.

## 9. Deploying the frontend (Vercel)

The frontend is a static Vite bundle and talks to the API on **relative** `/api` paths
throughout — there is no configurable API origin, by design: it keeps the refresh cookie
first-party and keeps CORS out of the browser's path. So Vercel must proxy `/api` rather than
the browser calling the API directly.

1. Import the repository. Set **Root Directory** to `apps/Frontend`.
2. Build command `bun run build`, output directory `dist`, install command `bun install`.
3. Environment variables: `VITE_MAPBOX_PUBLIC_TOKEN` if you want the map. Leave `VITE_DEMO_MODE`
   unset for a production-shaped deployment, or set it to `true` for a review deployment — it
   must agree with the API's `DEMO_MODE` either way.
4. Add `apps/Frontend/vercel.json` with the API proxy and the SPA fallback, in that order — the
   catch-all must come last or it will swallow `/api`:

   ```json
   {
     "rewrites": [
       { "source": "/api/:path*", "destination": "https://<your-api-host>/api/:path*" },
       { "source": "/(.*)", "destination": "/index.html" }
     ]
   }
   ```

5. On the API side, set `APP_ORIGIN` to the Vercel origin exactly, with no trailing slash. It
   drives both the CORS allowlist and the refresh cookie's scope; a mismatch shows up as a
   sign-in that appears to succeed and then forgets you on the next request.

The SPA fallback is what makes a deep link like `/rooms/coffee-villa` work on a cold load.
Without it the host returns 404 for every route but `/`.

## 10. Deploying the API and worker (Railway)

**Two services from the same repository.** The worker is not a background thread of the API; it
is a second process, and section 7 explains what breaks without it.

Install dependencies with `bun install` at the repository root in both services, using Bun.

| | Service 1 — API | Service 2 — worker |
|---|---|---|
| Start command (repository root) | `bun run --cwd apps/Backend start` | `bun run worker` |
| Public domain | Yes | **No.** It serves no HTTP |
| Needs | Backend variables in section 4 | Same backend environment as API; shared configuration validates required variables at startup |
| Health check | `GET /readyz` | None available |

1. Add the PostgreSQL plugin and reference its connection string as `DATABASE_URL` in **both**
   services. The same database, or bookings never confirm.
2. Do **not** set `TEST_DATABASE_URL` in either. The suite truncates every table; it has no
   business pointing anywhere near a deployed database.
3. Run the migrations once, as a release/deploy command on the API service only:
   `bun run migrate`. It is checksummed and idempotent, so a repeat is a no-op — but running it
   from two services at once is a race with no upside. The seed is a separate, manual decision:
   run `bun run seed` by hand against a review database, never automatically.
4. `APP_ORIGIN` is the Vercel origin; `API_PUBLIC_ORIGIN` is this service's own public domain.
   Neither takes a trailing slash.
5. Point the API service's health check at `/readyz`, not `/healthz`. `/healthz` deliberately
   touches nothing, so it stays green through a database outage — which is what you want for
   liveness and not what you want for readiness.

## 11. Google sign-in setup

Optional. Without `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` the button is not rendered and
OTP remains the only guest sign-in; the staff console's Google path is likewise skipped.

1. In the Google Cloud console, create an OAuth 2.0 **Web application** client.
2. Authorised redirect URI — exactly this, derived from `API_PUBLIC_ORIGIN` and nothing else:

   ```
   <API_PUBLIC_ORIGIN>/api/user/auth/google/callback
   ```

   Add one entry per environment, e.g. `http://localhost:3001/...` for development and the
   Railway domain for the deployment. Google matches it character for character, trailing slash
   included.
3. Authorised JavaScript origins: the `APP_ORIGIN` values, not the API ones.
4. Put the client id and secret in the API service's environment. Both or neither — a half-set
   pair is treated as unconfigured.

**This has never been exercised against Google.** See section 14.

## 12. `DEMO_MODE`

With `DEMO_MODE=true`:

- `POST /api/mock/inbound/:channel` accepts injected email and WhatsApp enquiries, so the
  multi-channel inbox can be exercised without a mail server. The console's scenario panel
  exposes this.
- The OTP endpoints return a `demoCode` in the response — **only** for the two reserved demo
  destinations (`demo@resort.test` and its matching number), never for any other identity. The
  seed creates that reviewer account with both contacts pre-verified.
- The payment endpoint honours an `outcome` of `succeed`, `decline` or `succeed_late`, so
  failure and late-payment paths are reachable on demand. Otherwise every attempt succeeds.

**Turn it off in production.** It is a reviewer convenience, and it reveals one-time codes.

## 13. Verifying the install

```bash
bun run check-types                       # both apps
bun run --cwd apps/Backend test           # needs a separate TEST_DATABASE_URL
bun run --cwd apps/Frontend lint
bun run --cwd apps/Frontend check         # check scripts + frontend test files
bun run --cwd apps/Frontend build
```

Optional, costs real tokens and needs a network:

```bash
bun run --cwd apps/Backend test:ai-live   # exercises the real Gemini model
```

Then, by hand: pick dates on the home page, open a room, check the availability calendar, add
two different room types, go to checkout, sign in as the demo reviewer with the code the OTP
response returns, pay with the test selector, and watch the booking poll through to confirmed.
The reference appears on the confirmation page and in `psql`.

## 14. Known deployment limitations

Latest local checks: 44 frontend tests passed; backend: 332 passed, 10 skipped, no failures.
A local HTTP walkthrough completed a confirmed booking and succeeded mock payment. Browser
visual checks and live Google OAuth were not verified during the final fixes.

Stated here rather than discovered later.

- **Hosted deployment has not been verified.** Check API proxying, refresh cookies, Google
  redirects and worker processing on the actual domains before a hosted demonstration.
- **India hosting is required by the brief.** Application/database region selection and data
  residency have not been verified; confirm both with the hosting providers.
- **No live Google OAuth call has ever been made.** The redirect flow is implemented and tested
  against its own contract. Section 11 is untested against Google itself.
- **Rate-limit counters live in the API process.** Two API instances each keep their own, so
  every limit doubles. Run one instance. The limits that actually protect something — OTP
  single-use, the 5-attempt lock, idempotency keys, the `FOR UPDATE` inventory recheck — are all
  in PostgreSQL and are unaffected.
- **The worker has no health endpoint.** It serves no HTTP. A platform can tell you the process
  is alive and cannot tell you it is processing; `jobs` rows piling up in `pending` is the real
  signal.
- **Public pages need JavaScript.** They are not pre-rendered, so a crawler or a JS-off browser
  gets an empty document.
- **Free-tier PostgreSQL sleeps.** The first request after an idle period can exceed the pool's
  connect timeout and surface as a 503 from `/readyz`. It recovers on retry; it is not a
  misconfiguration.
- **Payments, email and WhatsApp delivery are mocked by design**, per the brief. There is no
  payment provider to configure and no outbound mail to set up.

## 15. Troubleshooting

| Symptom | Cause |
|---|---|
| Booking stuck at `pending_payment` | The worker is not running, or it and the API are pointed at different `DATABASE_URL`s |
| Enquiries stuck at `ai_status = 'pending'` | Same — the worker runs classification |
| `readyz` returns 503 | The database is unreachable. The real driver message is in the API log, with the request id |
| Employee login returns 401 after a few tries | Working as intended: per-account brute-force limiting. Wait for the window to pass |
| `seed` refuses to run | The database is not empty. Use a fresh one, or pass `--force` if you mean it |
| Gemini calls fail | Run the preflight; it distinguishes a rejected key from an exhausted quota |
| No `demoCode` in an OTP response | That identity is not one of the two reserved demo destinations, by design |
