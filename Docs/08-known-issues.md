# Known issues

## Submission verification limits — 9 Nov

There is still no app-wide render error boundary; a different uncaught render error can
blank the app. The nullable Activity target crash is fixed without adding fallback UI.
The payment card panel is decorative, uses read-only sample values and never sends card data.
It is a mock payment adapter, not a live payment integration. Browser checking became available
on 10 Nov: booking, decline/retry, guest/staff conversations and console screens were exercised
against localhost. See `../browser-qa.md`; hosted deployment and live Google remain unverified.
OTP delivery remains mocked; codes are exposed only for the configured reviewer allowlist.

## Console presentation update — 9 Nov 2026

Production-style copy no longer displays demo/synthetic/local captions. This does not change
the partly wired console described below: fixture-backed screens still reset on refresh.
Messages remain recorded by mock delivery adapters; checkout explicitly states no charge
will be made. Reviewer controls remain available in development or builds with
`VITE_DEMO_MODE` enabled; backend `DEMO_MODE` independently gates mock endpoints.
The UI flag is not access control. See `src/console/README.md` for the integration split.

Enquiries now use native drag/drop plus focused-card Left/Right movement and live
announcements, replacing the visible move select. Rates use inline defaults with a secondary
History drawer. The detail callback cycle has been removed and guarded in source checks.
Browser control timed out, so live request counts and visual/mobile interaction remain
unverified. Automatic approval review blocked live rate mutation checks because those
writes persist data/audit entries. See `Docs/console-ui-fixes.md` for verification limits.

Things that are wrong, or deliberately simplified, **and shipped that way on purpose**. Each
one was found by a review, reproduced, and left alone with a reason. Nothing here is a
suspicion or a guess — if it is listed, it was checked.

This file exists so a reviewer does not have to find these by reading the code, and so a future
session does not rediscover them as if they were new. **A session that fixes one deletes its
row here in the same change**, exactly like any other doc.

Severity means what it costs if left: `tradeoff` is correct for this deployment, `gap` means
the code contradicts a written rule in `Docs/`, `defect` means it produces a wrong answer.
There are no open `defect`s.

| id | What | Severity | Blocks |
|---|---|---|---|
| KI-1 | `GET /admin/notifications` returns every row, no cursor | gap | Phase 3/4 — fix before the console reads it |
| KI-2 | `GET /admin/rates/history` returns every row, and its date span is uncapped | gap | Phase 3/4 — same |
| KI-3 | Rate-limit counters live in process memory | tradeoff | Multi-instance deployment only |

---

## KI-1 — `GET /admin/notifications` is unbounded

`src/routes/admin/notifications/controllers.ts:19` — `ORDER BY created_at DESC` with no `LIMIT`,
no `cursor` parameter, and no `nextCursor` in the response.

`00-conventions.md` ("Pagination") says in as many words: *"Unbounded list endpoints do not
exist."* This one does. That is the whole issue — it is a **rule the code breaks**, not a
performance theory.

**Correctly scoped, checked.** The query is `WHERE user_id = $1` against the authenticated
principal, so no employee can read another's notifications. That was probed, not assumed. There
is no data exposure here.

**Access is wider than the security review recorded.** The route is `requireEmployee`
(`routes/admin/notifications/routes.ts:7`), not GM/owner — every staff account can call it. The
earlier log entry said "GM/owner-only reads" for both this and KI-2; that was wrong about this
one, and the mistake made the issue look smaller than it is.

**What it costs.** One agent's alert history grows for as long as their account is active, and
the endpoint hands back all of it every poll. §18/§25 want a cheap visibility-aware refresh, so
this is on a path designed to be called repeatedly. Harmless on seeded data; it degrades with
age, not with load.

**The fix** is the keyset pattern this codebase already uses in five controllers —
`admin/bookings`, `admin/audit`, `admin/enquiries`, `user/bookings`, `user/enquiries`. Copy the
`encodeCursor` / `nextCursor` shape from `routes/admin/audit/controllers.ts:85`, add
`?limit=&cursor=` to a new `schema.ts` (the folder has none today), and update the route's row
in `11-phase2-backend-staff.md` (2B) and `04-contracts.md`.

**Why it is still here.** It is a response-shape change, and the only consumer is the staff
console that does not exist yet. Fixing it after the console is written means changing both.

## KI-2 — `GET /admin/rates/history` is unbounded and its window is uncapped

`src/routes/admin/rates/controllers.ts:192` — same missing `LIMIT`/cursor as KI-1. Separately,
`rateHistoryQuerySchema` (`src/routes/admin/rates/schema.ts:27`) requires `from`/`to` and
enforces `to >= from`, but **caps nothing**: `from=1900-01-01&to=2100-01-01` is accepted.

`00-conventions.md` bounds both halves — no unbounded lists, and *"neither do date ranges wider
than 366 days."* Neither bound is enforced here. The security-review entry in `progress-log.md`
described this endpoint as "bounded only by the 366-day window"; **there is no 366-day window on
it.** That was an assumption about a shared helper that this schema does not use.

**Correctly scoped, checked.** `requireGm`, filtered to one `roomTypeId` and to the three
override action kinds, so it remains the scoped projection of `audit_events` that INV-39
requires — it never becomes a general audit read, and `admin/audit/` stays `requireOwner`. The
projection boundary holds; only the size of the result does not.

**The span half is a one-word fix.** `withRangeBounds()` is defined at the top of that same
schema file (`schema.ts:7`) and already wraps `readRatesQuerySchema`, `previewRateSchema`,
`applyRateSchema` and `removeRateSchema`. It reads `POLICY.pagination.maxRangeDays` (366), so it
satisfies INV-59 for free. `rateHistoryQuerySchema` is the one schema in the file that was
hand-rolled with a bare `to >= from` refine instead of being wrapped — almost certainly an
oversight, not a decision. Wrapping it is the fix:

```ts
export const rateHistoryQuerySchema = withRangeBounds({
  ...rangeFields,
  kind: z.enum(['rate', 'allotment', 'blackout']).optional(),
});
```

Note `rangeFields` already carries exactly the `roomTypeId`/`from`/`to` trio this schema
declares by hand. The cursor half is KI-1's, unchanged.

## KI-3 — rate-limit counters are per process

`src/middleware/rateLimit.ts:16` — fixed-window counters in a module-level `Map`. Already
labelled in place with its ceiling and upgrade path; this row exists so the constraint is
visible from `Docs/` rather than only from the file.

Two API containers each keep their own buckets, so the effective limit doubles. **This is a
deployment constraint, not a bug** — it is correct for one instance, and one instance is the
deployment.

The limits that actually protect correctness do **not** live in that map. OTP single-use, the
five-attempt lock, idempotency keys and the `FOR UPDATE` inventory recheck are all enforced in
Postgres, so the thing the brief grades — never overselling — does not depend on this at all.
What the map protects is cost and nuisance: brute-force pacing on staff login, OTP spam, promo
enumeration.

**If this ever runs multi-instance**, move the counter to a `rate_limits` table keyed
identically. The call sites do not change, and `resetRateLimits()` stays the test seam.

---

## Not issues, recorded because they get mistaken for issues

- **`DATABASE_URL` points at local `resort_dev` again**, not the hosted Neon instance. It did
  not answer on earlier machines/sessions (why every number in `progress-log.md` up to Phase 2
  comes from `TEST_DATABASE_URL`); Phase 3 (frontend) connected to the hosted one directly and
  found it already migrated and seeded, then switched back to local at the user's request once
  the dev loop needed a job worker running against the same database the API serves from (the
  worker and API both read `DATABASE_URL` independently at startup — pointing one at Neon and
  the other at local, even briefly during the switch, is how a booking can sit at
  `pending_payment` forever with no error). `resort_dev` is migrated and seeded the same way;
  the hosted URL is commented in `.env` to swap back in. Still no claim here about a production
  deployment.
- **No live Google OAuth call has ever been made** (`progress-log.md:205`). 1D's Google path is
  verified against its own contract, not against Google. The Gemini credential *has* been
  exercised for real — see 2D in `progress-log.md`.
- **`bun run lint` does not exist in `apps/Backend`, on purpose.** See
  `apps/Backend/CLAUDE.md`. `bun run check-types` is the only gate; a doc or plan telling you to
  run lint there is stale.
- **The employee console is partly wired. Know which half you are looking at.**
  Two screens talk to the real staff API through `src/console/api.ts`:
  **Rates & allotment** (`RatesLive.tsx` — rates, inventory, blackouts, history, with the
  preview-then-apply token handshake) and **Enquiries** (`EnquiriesLive.tsx` — the real inbox,
  real assignment, and real Gemini drafts). Staff sign-in is real
  (`POST /api/admin/auth/login`, argon2id, rate-limited), and the session restores from the
  refresh cookie on reload. The rate/allotment/blackout rules were **deleted** from
  `model.ts` in the same change, so there is one implementation, not two.

  Still on local fixtures in `src/console/model.ts`: **Overview, Bookings, Rooms, Management
  (promos, information, team), Reports and Activity.** They read `state.threads`,
  `state.bookings`, `state.overrides` and friends, which is why those fixtures and the
  `thread`/`reply`/`ai`/`incoming` commands still exist — Overview's alerts, Bookings' related
  enquiry and Management's disable-and-reassign all depend on them. `model.ts`'s header lists
  every limit in the remaining copy that disagrees with `core/policy.ts` (INV-59). Do not "fix"
  one of those numbers in isolation: the file shrinks as each screen is wired, and the
  divergence table is what makes that safe.
- **No rendered-UI verification has ever been done in this environment.** There is no headless
  browser here, so every visual claim about the guest site or the console rests on reading code,
  type-checking, lint, the `checks/` scripts and static `renderToStaticMarkup` output. That is
  why several purely visual defects reached the user rather than being caught first: an
  invisible white-on-white stepper, dark-on-dark availability text, a 2-column grid that pushed
  copy off-screen, and portrait-cropped room photos. Each had a real root cause found afterwards
  (CSS inheritance through `.acc-caption`, a missing `&h=` on the Unsplash URLs), none of which
  any gate here would have failed on. Treat "the layout is correct" as unverified unless a human
  has looked at it; `bun run build` passing says nothing about it.
- **A sent-but-edited AI draft stays `pending`.** `POST /enquiryMessages/:id` retires a draft
  only when `draftId` is supplied, and the console supplies it only when the body is the draft
  verbatim — an edited reply is the staff member's, not the model's, and claiming otherwise
  would corrupt the attribution `ai_runs` exists to provide. The consequence is cosmetic: after
  sending an edited reply, the draft box is still shown because the draft is still pending.
  There is no discard endpoint; adding one is the fix if this ever matters.
- **The Enquiries Kanban board was lost once, and nothing caught it.** The fixture-backed screen
  had List and Board views; the rewrite against the staff API carried over only the list, and
  `check-types`, `lint` and every test stayed green while a `Product.md` §9A requirement
  disappeared. It is back, and `checks/console.test.ts` now asserts the board exists, that its
  columns come from the four conversation statuses rather than from the lane filters, that both
  views render the same filtered records, and that cards move via a keyboard-operable control.
  The general lesson: replacing a screen is not a refactor the type system can check. Diff the
  old screen's features against the new one deliberately, and do not delete the old file until
  that diff is empty — especially here, where `src/console/` is untracked, so a deleted file is
  not recoverable from `git`.

## The console is wired; `model.ts` and `reporting.ts` are dead code

All eight console screens now read the staff API — `adminFetch` counts are non-zero on every one
and no screen renders a fixture. What is left behind is the fixture module itself: `model.ts`
still holds `seedState`, `transition` and the synthetic domain, and `reporting.ts` is imported by
nothing but `checks/console.test.ts`. They are unreachable from the UI, so nothing fake renders,
but they are ~900 lines that should be deleted. `model.ts` must keep its formatters
(`money`, `dateText`, `timeText`, `datesBetween`) and its permission predicates
(`pageAllowedFor`, `canExportRole`), which the screens do still import.

## Backend fields added for the console, and why

Wiring the screens exposed six places where the existing markup had no honest source. Each was
added to the API rather than faked or dropped:

- `GET /bookings` — `confirmedAt`, `confirmedFrom`/`confirmedTo`, `holdExpiresAt`, `guestPhone`,
  `paymentStatus`, `refundStatus`, grouped `rooms[]`.
- `GET /bookingCalendar` — `pricePaise`, `hasOverride`, and a `confirmed`/`held` split of
  `committed`. `remaining` still comes only from `core/inventory.ts` (INV-1, INV-10).
- `GET /promos` — `usedCount`, counted on the same `state <> 'released'` basis the cap enforces.
- `GET /staff` — `lastSignInAt`, from the newest `sessions` row; there is no
  `users.last_login_at` and adding one would need a migration.
- `GET /resortInfo?history=true` — superseded versions with their editor.
- `GET /enquiries?bookingId=` — so a booking's related enquiry link resolves.
- Admin auth responses carry `name`/`username` alongside the principal (never in the JWT).

## The console used to name the wrong person

Until the screens were wired, `Console.tsx` kept two identities: the real `StaffPrincipal` from
the server, and a LOCAL fixture employee matched by role. The sidebar, the profile drawer and the
Overview greeting all read the fixture one — so a signed-in GM saw a fixture GM's name and email.
Both are now the server principal, which is why the admin auth response had to start returning a
display name.

## A long-lived dev database drifts from the seed, silently

`bun run seed` refuses a non-empty database, which is the right default — it is also why this
database ran for weeks with two of the AI corpus's seven sections. The five others were added to
`seeds/run.ts` later and nothing applied them, so the drafter was grounded in a third of its facts
and nobody noticed: the behaviour it produced ("our team will confirm") is a perfectly legitimate
output for a question the corpus does not cover. The same drift gave seven enquiries no messages
at all.

Both were repaired with targeted inserts against the existing rows rather than a reseed, which
would have destroyed the bookings, payments and refunds the demo depends on.

There is no detector for this. The only reliable check is to reseed a scratch database and diff
the two — worth doing before a demo, and the reason `seed` keeps its `--force` escape hatch
rather than being made idempotent (an idempotent seed would be a migration, and migrations are
where schema belongs, not fixtures).

## The guest app had no session restore, and the doc said it did

`Docs/14-frontend-api-map.md` has listed `POST /auth/refresh` as used by "`api.ts`'s silent 401
retry, **and once on app boot**" since phase 3 was written. The boot call was never implemented.

Nothing caught it, for a specific reason: the silent retry covers every screen that reads
something private, so `/account/*` and the booking pages restored a session as a side effect of
their first 401. `/checkout` reads nothing private — `GET /rooms` is public, `POST /quotes` runs
under `optionalGuest` and answers 200 for an anonymous caller, and `GET /quotes/:id` answers 404
rather than 401 for a quote it does not own (INV-34). So checkout was the one screen that never
provoked a 401, and it is also the one screen whose entire right-hand column branches on being
signed in. A signed-in guest who reloaded saw "Sign in to book" with no way past it.

The employee console had the same architecture and did not have the bug, because
`restoreStaffSession()` was written when the console was wired. The guest side predates it.

The lesson worth keeping: "the token is restored lazily on 401" is only true for screens that
make an authenticated request. A screen can be entirely public and still need to know who is
signed in.

## Google sign-in cannot complete a booking on its own

Google verifies an email. It supplies no phone number, and `requireVerifiedGuest` requires both
contacts before a booking — correctly, since the reservations team calls the guest. So a guest
who signs in with Google is genuinely signed in and genuinely cannot book yet.

The sign-in form now collects only the missing contact, so the path out is one code rather than
two. What is NOT fixed is the wording: checkout still says "Sign in to book" to someone who is
already signed in and only needs to verify a phone. The copy is wrong, the button goes to the
right place, and the user's standing instruction is that the UI does not change before
submission.
