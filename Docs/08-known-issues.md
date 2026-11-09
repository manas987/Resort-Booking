# Known issues

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
