# Implementation index

Start here. **Open only the file you need** — none of these repeat another.

## Reference

| File | Open it when |
|---|---|
| `Product.md` | You need the authoritative spec. 1700 lines — search it, don't read it whole |
| `00-conventions.md` | Touching money, dates, errors, pagination, idempotency, SQL, audit |
| `01-data-model.md` | Writing SQL or a migration. Explains the inventory and locking design |
| `02-permissions.md` | Adding a route or a guard |
| `03-decisions.md` | You need a verified fact, a labelled assumption, or a policy default |
| `04-contracts.md` | **Calling anything in `core/` or `adapters/`.** Exact signatures — call from these, not from memory |
| `05-invariants.md` | `INV-1 … INV-60`. Code comments cite these instead of re-explaining |
| `06-touch-map.md` | **Before editing anything shared.** Answers "if I change this, what else must change?" |
| `07-backend-structure.md` | Folder layout, controller reading order, naming, SQL and transaction conventions |
| `08-known-issues.md` | **Before reporting a bug.** What is knowingly wrong or deliberately simplified, and why. Fixing one deletes its row |
| `09-test-harness.md` | **Before writing any test.** Helper signatures, the real-concurrency barrier, testing expiry without a fake clock |
| `10-phase1-backend-guest.md` | Guest API — sub-phases 1A–1J with files, routes, exit criteria, do-nots |
| `11-phase2-backend-staff.md` | Staff API — sub-phases 2A–2H |
| `12-phase3-frontend-guest.md` | Guest frontend — sub-phases 3A–3H with files, routes, exit criteria, do-nots |
| `13-frontend-structure.md` | Frontend folder layout, route table, `src/lib/` module ownership, state rules |
| `14-frontend-api-map.md` | Every guest endpoint's exact request/response shape and error branches, and which screen calls it |
| `tests-phase1.md` · `tests-phase2.md` | The named test cases. **Written before the code they cover** |
| `progress-log.md` | **What has actually been finished and verified.** Append an entry per sub-phase |
| `TDD.md` · `../deployment.md` | **The two submission deliverables.** Written from shipped behaviour; update them with the behaviour, not at the end |

## Build order and status

| # | Sub-phase | Builds | State |
|---|---|---|---|
| 0 | Foundation | env, 28-table schema, migration runner, error envelope, health | **done, verified** |
| 1A | Restructure + skeleton | 8 moves, routers, cors, rateLimit, `policy.ts`, locals typing, 2 columns | **done, verified** |
| 1B | Core pricing | test helpers, `calculateQuote`, GST per unit-day, discount allocation | **done, verified** |
| 1C | Core inventory | `lockRoomDays`, `assertAvailable`, availability | **done, verified** |
| 1D | Guest identity | tokens, auth, OTP, Google, account | **done, verified** |
| 1E | Catalogue reads | rooms, content, availability | **done, verified** |
| 1F | Quote + promo check | quotes, promo validate | **done, verified** |
| 1G | **Booking hold** | `createBookingHold`, bookings, idempotency | **done, verified** |
| 1H | Payment + worker | mock payments, lifecycle, worker, 4 handlers | **done, verified** |
| 1I | Guest enquiries | enquiries, messages, event form, routing | **done, verified** |
| 1J | Analytics + seeds | analytics, synthetic fixtures | **done, verified** |
| 2A | Employee auth + accounts | admin auth, adminAuth guard, staff | **done, verified** |
| 2B | Inbox reads | enquiries list/counts/detail, notifications | **done, verified** |
| 2C | Inbox actions | messages, notes, assignment, category, status | **done, verified** |
| 2D | AI pipeline | gemini adapter, `processEnquiry`, drafts | **done, verified** |
| 2E | Staff reads + export | admin rooms, bookings, calendar, CSV | **done, verified** |
| 2F | Rates / inventory / blackouts | overrides, preview, history | **done, verified** |
| 2G | Promos + resort info | promo admin, approved facts | **done, verified** |
| 2H | Reports + audit | metrics, funnel, audit, final sweep | **done, verified** |
| — | **Backend review** | Phase 1 + 2 read back against `Product.md`; 4 defects fixed | **done — backend complete** |
| — | **Security review** | access control, rate limits, data leakage; 3 defects fixed | **done** |
| — | **Pre-publish booking review** | double booking, quote conversion, date window; 3 defects fixed | **done** |
| — | **Docs pass + known-issues register** | `08-known-issues.md`; 2 stale claims corrected | **done** |
| 3 | Frontend — guest | — | **in progress** — 3A–3F done, 3G next (prerender, measured budgets) |
| 3A | Foundation: routing, API client, session, docs | `wouter`, `src/lib/{api,types,money,session,useResource,analytics}.ts`, SSR smoke check | **done, verified** |
| 3B | Backend: per-date availability endpoint | `GET /availability/calendar` | **done, verified** |
| 3C | Seeds: curated room content | `seeds/run.ts`, `seeds/update-room-content.ts` | **done, verified** |
| 3D | Rooms, availability, calendar UI | `/rooms`, `/rooms/:slug`, `/book/select` | **done, verified** |
| 3E | Quote → booking → payment → confirmation | `/checkout`, `/booking/:bookingId` | **done, verified** |
| 3F | Account, enquiries, event form | `/account/*` (`Account.tsx`), `/events` (`Events.tsx`), §8E support action | **done, verified** — enquiry submitted, triaged, answered from the database, read back in the thread |
| 3G | Prerender, images, measured budgets | `scripts/prerender.mjs` | spec written |
| 3H | States, accessibility, checks, close-out | — | spec written |
| 4 | Frontend — staff console | `src/console/` — all screens built; **Rates and Enquiries wired**, rest on fixtures | **in progress** — real staff auth, `src/console/api.ts`, `RatesLive.tsx`, `EnquiriesLive.tsx`. Overview/Bookings/Rooms/Management/Reports/Activity still local. See `08-known-issues.md` |
| 5 | TDD + deployment.md | `Docs/TDD.md`, `deployment.md` | **drafted** — both written from the shipped behaviour; budgets still partly unmeasured (see each file's limitations section) |

**One sub-phase at a time, in order.** Its tests are written before its code. 1G is the graded
hard part and must not be rushed or cut.

**The backend (Phase 1 + Phase 2) is complete and reviewed.** Three review entries at the end
of `progress-log.md` cover it; read them before starting Phase 3 rather than re-deriving them.
The first is the backend review — what was re-run independently and the four real defects it
found and fixed.

The **security review** is next: no privilege-escalation path exists, but it found and fixed a
cross-guest idempotency-key replay that served one guest another's booking, a refresh rotation
that was not single-use under concurrency, and an entirely unmetered public write surface
(promo-code validation was a free enumeration oracle).

The **pre-publish booking review** is the last, and it is the one Phase 3 depends on most,
because all three defects were in the quote-to-booking conversion the guest flow drives:

- **One quote converted into unlimited bookings** — two `POST /bookings` with the same
  `quoteId` and different `Idempotency-Key`s both returned `201`. A quote is now single-use
  (`FOR UPDATE` + live-booking check → `409 quote_already_booked`), INV-60. **The frontend must
  branch on that code** and show the existing booking rather than retrying.
- **A stay 30 days in the past could be priced and sold** — `GET /availability` refused the
  window, `POST /quotes` did not. Both halves of the horizon now live on both endpoints.
- **The `422 price_changed` re-quote did not exist** — it was written inside the hold
  transaction that then threw, so the rollback took it with it and the id in the 422 answered
  `404`. §8D's "confirm the new total" step could never complete. The fresh quote is now
  written after the rollback, on its own connection.

Two corrections to the earlier entries are recorded there: the "unidentified ~4% intermittent
failure" was my own second test runner sharing `TEST_DATABASE_URL` (twelve clean sequential
runs since), and the claim that the oversell test proves nothing about the shipped code is
withdrawn — `booking.atomicity.test.ts:239` already drove the real route concurrently. (The
hosted `DATABASE_URL` had not answered as of this entry; Phase 3's frontend work connected to
it successfully — see `08-known-issues.md`'s "Not issues" section. Backend test numbers above
still all come from `TEST_DATABASE_URL`, unaffected by that.)

Current suite: **302 pass, 0 fail, 29 files** (296 through Phase 2; 3B added 6 more in
`availability.calendar.test.ts` — see `progress-log.md`'s Phase 3 entries).

## How to pick up work after a context reset

0. Read `progress-log.md` — what is genuinely done, with the output that proved it.
1. Read this file's status table — find the first sub-phase marked **next**. Do that one only.
2. Read that sub-phase's section in `10-` or `11-`: files, routes, exit criteria, do-nots.
3. Read its cases in `tests-phase1.md` / `tests-phase2.md`, and `09-test-harness.md` for how.
4. Read `04-contracts.md` for every signature you will call. **Call from the written
   signature, never from memory** — a caller written against a remembered shape is the main
   way this project breaks.
5. Check `06-touch-map.md` for what else your change touches.
6. Write the tests. Then build. Cite `INV-n` in comments rather than re-explaining a rule.
7. Run the exit criteria. Update the status table, `progress-log.md`, `04-contracts.md` and
   `06-touch-map.md` in the same change — **before** starting the next sub-phase. Your context
   may be compacted at any moment; anything not written down is lost.

Do not read the whole `Docs/` folder. Do not re-derive a decision already in `03-decisions.md`.

### Five rules that matter more than the rest

Written out because a session that can only see its own sub-phase will otherwise rediscover
them the expensive way.

1. **Do not redesign anything.** If a signature, a route path, a limit or a column already
   exists in `04-contracts.md`, `10-`, `11-`, `core/policy.ts` or `001_init.sql`, implement it
   as written. A better idea is a question for the user, not a change.
2. **One sub-phase per commit.** Do not start the next one because the current one looks
   finished. Run its exit criteria first.
3. **Nothing is "passing" unless you ran it.** Paste what you ran. "Should pass" is a failure.
4. **Never hardcode a business limit.** `core/policy.ts` holds all of them (INV-59).
5. **Never widen `core/`.** No Express type, `Request`, `Response` or `res.locals` enters
   `src/core/`. Controllers adapt HTTP to core functions; core never learns about HTTP.

### First run on a new machine: `bun run preflight`

Credentials are supplied in `apps/Backend/.env`. Prove them before building on them — a dead
key found in 2D is fifteen sub-phases built on an assumption. The backend is built, so this is
now the setup gate for a fresh checkout rather than a pre-1B step.

```bash
cd apps/Backend && cp .env.example .env     # fill in, then:
createdb resort_test                        # the test database stays LOCAL — see below
bun run migrate                             # DATABASE_URL
NODE_ENV=test bun run migrate               # TEST_DATABASE_URL
bun run preflight
```

**Why a second database at all, and why local.** The suite truncates every table between each
of ~300 cases — pointed at the working database it would destroy the seeded reviewer data,
which is itself a graded deliverable (§26), and `Product.md` requires an isolated test database
in as many words. `src/db.ts` throws at import if `NODE_ENV=test` without `TEST_DATABASE_URL`,
and `preflight` fails if the two URLs are identical, so this is not optional. Keep it local
even when `DATABASE_URL` is hosted: 300 truncations over a network on a free tier that
auto-suspends is slow and pointless.

It checks both databases are reachable, migrated and **distinct**, reports whether the Google
trio is complete, and makes **one real Gemini call**. It exits non-zero on anything fatal and
never prints a secret. Run it after filling `.env` on a new machine, and again before any
phase that touches a credential.

If `preflight` fails: **stop and report the exact output.** Do not work around a missing
credential, do not stub a provider response, do not mark a test as skipped to get green. A
suite that passes because the thing under test was removed is worse than a red one.

## Phase 0 — what landed

**Repo.** Removed unused `packages/eslint-config` and `packages/typescript-config` (unreferenced,
both carrying dead Next.js configs). `turbo.json` outputs corrected `.next/**` → `dist/**`, plus
`test`/`migrate`/`seed`/`worker` tasks. Packages renamed. Root, backend and frontend `CLAUDE.md`
rewritten — the backend's was the stock Bun template instructing agents *not* to use Express,
`pg` or Vite, the opposite of the agreed stack.

**Backend.** `env.ts` is the only reader of `process.env`, Zod-validated, exits naming the fault.
Pool parses BIGINT to a number with a safe-integer guard and keeps `DATE` as a string.
`withTransaction` on a single checked-out client. Migration runner applies numbered files
transactionally, is idempotent, and refuses a migration whose checksum drifted. Single error
envelope; request IDs on every request. `/healthz` and `/readyz` live.

**Schema.** `001_init.sql`, 28 tables, applied and verified on PostgreSQL 18. `room_day` is both
the override row and the lock target; committed inventory is computed, never stored — see
`01-data-model.md`.

**Bug found and fixed.** An oversized or malformed body returned `500 internal_error` — Express's
body-parser throws before any route runs, so it fell past the handler. Now mapped once in
`errorHandler` to `413 payload_too_large` / `400 malformed_json`, verified.

**Verified, not assumed.** GST brackets against CBIC Notification 15/2025-CTR. Gemini model IDs
against Google's current docs; free-tier quotas deliberately **not** quoted because Google no
longer publishes them. 20 schema negative cases confirmed rejected; `audit_events` confirmed
immune to UPDATE and DELETE.

## Standing rules

- `Product.md` wins. Our decisions refine it. A real contradiction gets raised, not resolved
  silently.
- Update the doc in the same change as the behaviour. A route without its row, or a column
  without its entry, is incomplete work.
- Nothing is reported as working, passing or deployed unless it was actually run.
- Env names only in docs; no secrets in the repo, the client bundle, or logs.
- The user owns all `git` and all deployment.

## What the pre-handoff review changed

Eleven places in the original plan forced an invention. All eleven were answered before
Phase 1 started and all eleven are now implemented — `core/policy.ts` (INV-59),
`nightKey()`, `quotes.terms_version` (INV-58), `src/types/express.d.ts`, the guard export
table in `04-contracts.md`, the reference formats in `01-data-model.md`, the idempotency
decision table, and the shared `previewToken` (INV-57). The gap-by-gap table was deleted once
every row shipped; the answers live in the docs named here, which are authoritative.

## Credentials

`DATABASE_URL`, `TEST_DATABASE_URL`, `GEMINI_API_KEY` and the Google OAuth trio are supplied in
`apps/Backend/.env`, which is gitignored and must stay that way. Nothing in phase 1 or 2 is
blocked.

`bun run preflight` is the gate — see above.

**Gemini has been exercised for real.** 2D ran the pipeline end-to-end against a seeded
enquiry: `gemini-3.5-flash-lite`, classify `classify-v1` 1757ms, draft `draft-v1` 1283ms, both
`status ok` on attempt 1 — full output in `progress-log.md`. The credential works.

**One thing has still never been exercised**, and no claim in this repo depends on it: **no
live Google OAuth call has been made** — 1D's Google path is verified against its own contract
only. (`DATABASE_URL` was unreachable as of Phase 2's writing; Phase 3 connected to it
successfully — see `08-known-issues.md`.) This is registered there so it is
not mistaken for defects.
