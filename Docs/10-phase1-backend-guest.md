# Phase 1 — Backend, guest surface

Ten sub-phases. **Do one at a time, in order.** Each has files, routes, exit criteria and
do-nots. Do not start a sub-phase before its tests in `tests-phase1.md` are written.

Read with: `04-contracts.md` (signatures), `05-invariants.md` (`INV-n`), `06-touch-map.md`
(callers), `00-conventions.md` (money, dates, errors), `02-permissions.md` (guards).

Mounted at `/api/user/*`. `A` = authenticated guest · `V` = verified guest (email **and**
phone) · `I` = requires `Idempotency-Key`.

## Goals

1. Browse rooms, rates and availability with no account.
2. Authenticate, verify email and phone, and keep those verifications.
3. Price a multi-room, mixed-type, multi-night stay correctly, with tax and promo.
4. Convert a quote into an **atomic** hold — all rooms and nights, or none.
5. Pay with the mock adapter and get a persistent confirmed booking.
6. Never oversell the allotment, under any concurrency.
7. Resolve every failure — expiry, decline, late success, dropped connection — to one honest
   recoverable state with no duplicate booking or refund.
8. Submit a website enquiry and hold a thread the guest owns.

---

## 1A — Restructure and skeleton · **DONE, verified**

Done in the pre-handoff review so the junior starts 1B against a real skeleton rather than
against docs that describe a layout the code does not have. **Do not redo it.** What is on disk:

- The eight moves. `src/db/`, `src/http/`, `src/modules/` and `db/` are gone.
- `src/router.ts` plus `routes/{user,admin,system}/router.ts`. The user and admin routers are
  empty by design — each carries the comment listing which sub-phase mounts what. **Mount your
  feature there; do not create a parallel router.**
- `middleware/cors.ts` (exact-origin allowlist) and `middleware/rateLimit.ts`
  (`rateLimit({ windowSeconds, max, name, key? })`, plus `resetRateLimits()` for tests).
- **`src/core/policy.ts`** — every business limit in one frozen object (INV-59). Import it;
  never retype one of its numbers.
- **`src/types/express.d.ts`** — the `response.locals` contract. See `04-contracts.md`.
- **`src/core/tokens.ts`** — the `Principal` type only. 1D adds the functions.
- `001_init.sql` gained `room_types.inclusions` and `quotes.terms_version` (INV-58).
- `package.json` repointed. `bun run worker` and `bun run seed` have no files until 1H and 1J —
  expected, not a bug.

**Verified, actually run:** `bun run check-types` clean — now with `noUnusedLocals` and
`noUnusedParameters` on, since this package has no eslint and `bun run lint` silently skips it
· migration applies to a throwaway PG 18 database,
second run is a no-op, a tampered file is refused on checksum · `/healthz` 200 · `/readyz` 200
with the database up and 503 with it down · unknown route 404, malformed JSON 400, oversized
body 413, all with a `requestId` · CORS preflight answered for `APP_ORIGIN` and unanswered for
anything else · `process.env` only in `env.ts` · no empty directories.

**One bug fixed while verifying:** `/readyz` was returning the raw driver message, which can
carry the host, port and database name. It now logs that and returns `{ status, checks }` only.

---

## 1B — Core pricing

**First, `bun run preflight`.** Both databases migrated and distinct, and one real Gemini call
answered. If it fails, stop and report its output — do not build on an unproven credential.

**Files.** `src/core/pricing.ts`, plus `tests/helpers/{db,factories,concurrency}.ts` —
built once here, for every later sub-phase. Signatures in `09-test-harness.md`.

**Builds.** `calculateQuote`, `taxRateForUnitDay`, `allocateDiscount` — signatures in
`04-contracts.md`.

Bracket per room-night on post-discount value (INV-4). Allocate the discount proportionally,
floored, remainder to the highest-priced night so parts sum exactly (INV-5). Integer paise,
half-up once (INV-29). Missing or insane tax config throws (INV-6).

**Exit.** `pricing.gst` tests pass, including a night at exactly ₹7,500 (5%) and ₹7,501 (18%),
a promo that moves a night across the boundary, and a discount whose proportional split does
not divide evenly.

Read `termsVersion` from `resort_info` where `key = 'booking_terms' AND is_current`, and
fail loudly when there is none — same rule as a missing tax config (INV-58).

**Do not.** Use floats anywhere. Round more than once. Read tax rates from a constant instead
of `tax_config`. Let a missing config default to zero tax. Hardcode a limit that
`core/policy.ts` already holds (INV-59).

---

## 1C — Core inventory

**Files.** `src/core/inventory.ts`.

**Builds.** `nightsForStay`, `readAvailability`, `lockRoomDays`, `assertAvailable`,
`effectiveAllotment`, `findCommitmentConflicts`.

Effective allotment: blackout → 0, else `least(override ?? base, physical_stock)`. Committed
usage is **computed** — `booking_nights` joined to bookings that are `confirmed` or
`pending_payment AND hold_expires_at > now()` — never a stored counter (INV-10). Lock
`FOR UPDATE ORDER BY (room_type_id, stay_date)` (INV-3), recheck after locking.

**Exit.** `inventory.oversell` passes with genuinely concurrent transactions competing for the
last room — not sequential calls. Blackout zeroes availability. An expired hold frees inventory
with no worker run.

**Do not.** Add a counter column "for performance". Recheck before taking locks. Vary the lock
order. Let `readAvailability` authorise anything — it is display only (INV-1).

---

## 1D — Guest identity

**Files.** `src/core/tokens.ts`, `routes/user/auth/{routes,schema,controllers}.ts`,
`routes/user/auth/otp.ts`, `routes/user/account/*`, `middleware/userAuth.ts`.

| Method | Path | Guard |
|---|---|---|
| POST | `/register` | public |
| POST | `/otp/request` | public, rate limited per destination + IP, 60 s cooldown |
| POST | `/otp/verify` | public |
| GET | `/google/start` · `/google/callback` | public — the callback path is fixed by `googleRedirectUri` in `env.ts`; it must be `/api/user/auth/google/callback` |
| POST | `/refresh` · `/logout` | public / A |
| GET | `/me` | A |
| PATCH | `/account/profile` | A |
| POST | `/account/contact/verify-start` | A |

OTP: 6 digits, 5-minute expiry, single use, purpose-bound, 5 attempts, hashed at rest. Google
ID tokens verified **server-side**; `google_sub` linked; no privilege granted (INV-35). Refresh
rotates, reuse revokes the chain (INV-16). Changing a contact requires fresh verification and
never merges accounts or moves booking ownership.

**Exit.** `access.privilegeEscalation` and the OTP-limit tests pass. A guest cannot reach any
`/api/admin/*` route. Demo OTP exposure is scoped to seeded reviewer identities, with no general
inbox and no universal bypass (INV-52).

**Do not.** Trust a role, email or user id from a request body. Store a refresh token in
plaintext. Return different errors for "no such user" and "wrong code". Put a long-lived secret
anywhere the browser can read.

---

## 1E — Catalogue reads

**Files.** `routes/user/rooms/*`, `routes/user/content/*` (no `schema.ts`),
`routes/user/availability/*`.

| Method | Path | Notes |
|---|---|---|
| GET | `/rooms` | Cover photo, summary, amenities, **inclusions**, capacity, base "from" price explicitly labelled as a base price |
| GET | `/rooms/:slug` | Gallery variants, description, amenities, inclusions, capacity |
| GET | `/availability` | `?checkIn&checkOut&adults&children&rooms`. Rejects incomplete or invalid input rather than guessing |
| GET | `/availability/calendar` | **Added in Phase 3 (3B).** `?slug&from&to`, one row per date: `{date, remaining, pricePaise, isBlackout}`. `GET /availability` above collapses every night into one number for the whole stay; this is the per-date read the frontend's availability-calendar panel needs. Window ≤62 days (`POLICY.availability.calendarMaxDays`), same 365-day horizon as `/availability`. `404 not_found` for an unknown/inactive slug |
| GET | `/content` | Current `resort_info` versions, including `booking_terms` |

**Exit.** `catalogue.reads` passes: a "from" price is never presented as a stay quote, invalid
or partial availability input returns `400` rather than a guess, availability is `no-store`, a
GM content edit is visible immediately, and `booking_terms` is served for the review step.
3B added `CR-14..CR-19` for the calendar endpoint — same file, same exit bar.

**Do not.** Serve availability from a cache. Bake GM-editable content into a build artifact.
Return every photo variant URL for a room the user has not opened.

---

## 1F — Quote and promo check

**Files.** `routes/user/quotes/*`, `routes/user/promos/*`.

| Method | Path | Guard | Notes |
|---|---|---|---|
| POST | `/quotes` | public (`optionalGuest`) | Validates occupancy **per room**, applies promo, brackets GST per night, 5-minute expiry |
| GET | `/quotes/:quoteId` | public (`optionalGuest`) | Reports expiry; a refresh never extends it |
| POST | `/promos/validate` | public | Checks against booking time; reserves nothing |

**Quotes are public, because §8 prices a stay before sign-in.** That creates one ownership
question, answered here so it is not invented twice:

- Signed out → `quotes.guest_user_id` is `NULL`.
- Signed in → stamp it with the principal.
- A quote is **single-use**: it is spent by the booking it produced. A second hold on a quote
  that already has a live booking (confirmed, or a hold that has not lapsed) is
  `409 quote_already_booked`, carrying the existing reference so the client can show the
  booking it already has. The quote row is taken `FOR UPDATE`, so two parallel presentations
  serialise rather than both reading "no booking yet". An `Idempotency-Key` cannot cover this:
  a double-click that regenerates its key is a different request by definition (Goal 7).
- At hold time, `createBookingHold` accepts a quote whose `guest_user_id` is **`NULL`** (the
  visitor has now signed in and is claiming their own quote) or **equal to the actor**. A quote
  belonging to a *different* user is `404`, never `403` — confirming it exists would leak that
  someone else is mid-booking (RB-4, INV-34).
- `GET /quotes/:quoteId` applies the same rule. A quote id is not a capability.

Occupancy per room: at least one adult, within that room type's max adults, children and total
(INV-7 territory). Spare capacity in one selected room never excuses another room's limit.

The stay window is the **same** one `GET /availability` enforces, both halves of it:
`checkOut > checkIn`, at most 14 nights, `checkIn` not in the past and not beyond the 365-day
horizon, all resort-local. The lower bound was missing here until the pre-publish review, so a
stay that had already happened could be priced and then sold.

**Exit.** Quote expiry is server-stamped and server-checked. Promo validity is booking-time
only. A total can never go negative.

**Do not.** Accept a client-sent total or price. Validate occupancy across the whole booking
instead of per room. Reserve promo capacity here — that happens with the hold.

---

## 1G — Booking hold · the graded hard part

**Files.** `src/core/booking.ts` (`createBookingHold`), `src/core/jobs.ts` (`enqueueJob`
only — `claimJobs`/`completeJob`/`failJob` arrive with the worker in 1H),
`routes/user/bookings/*`, `middleware/idempotency.ts`.

`core/jobs.ts` **must land in this sub-phase**, not 1I: step 6 below enqueues `expire_holds`
inside the transaction, and there is no hold without it.

Read `04-contracts.md` → "middleware/idempotency.ts — the decision table" before writing the
middleware. The four-state branch and the response-capture rule are specified there; do not
improvise them.

| Method | Path | Guard |
|---|---|---|
| POST | `/bookings` | V, I |
| GET | `/bookings` | A, own, paginated |
| GET | `/bookings/:bookingId` | A, own |
| GET | `/bookings/reference/:reference/status` | A, own — cheap poll for an uncertain write |

The transaction, in this order, nothing else between:

1. Validate the quote — exists, unexpired, same guest, amounts unchanged.
2. Materialise `room_day` rows, `ON CONFLICT DO NOTHING`.
3. `lockRoomDays` — fixed order.
4. `assertAvailable` — recheck every room-night; `409` names every conflicting night.
5. Lock the `promo_codes` row, count `held` + `consumed`, reserve or fail (INV-8).
6. Insert booking, `booking_rooms`, `booking_nights`, promo redemption; stamp the 10-minute
   hold; `enqueueJob('expire_holds')` **inside** the transaction (INV-23).
7. Commit.

`422 price_changed` returns a fresh quote for acknowledgement — one that **exists**. It is
written on its own connection after the hold transaction has rolled back; written inside that
transaction it is rolled back with it, and the 422 names a quote `GET /quotes/:id` answers 404
for, which dead-ends §8D's "confirm the new total" step. Snapshot prices, discount, tax,
`tax_config_version` and `terms_version` onto the booking and its nights (INV-28).

**Exit.** `booking.atomicity`, `booking.rollback`, `payment.idempotency` (double-click),
`inventory.oversell` end-to-end, `promo.concurrency`, `pricing.snapshot` all pass.

**Do not.** Leave a partial booking on failure. Hold the transaction open across the payment
wait. Skip the post-lock recheck. Trust the quote's stored amounts without revalidating against
current rates. Create the expiry job after commit.

---

## 1H — Payment lifecycle and worker

**Files.** `src/adapters/mockPayments.ts`, `src/core/booking.ts` (`confirmMockPayment`,
`expireBookingHold`, `refundLatePayment`), `src/jobs/worker.ts`,
`jobs/handlers/{expireHolds,processPaymentEvent,refundLatePayment,sendMessage}.ts`,
`routes/user/payments/*`, `routes/system/mock/*`, `middleware/demoOnly.ts`.

| Method | Path | Guard |
|---|---|---|
| POST | `/payments/:bookingId/attempts` | V, I, own. Accepts `outcome` (`succeed`/`decline`/`succeed_late`) honoured **only** under `DEMO_MODE` (INV-25) |
| POST | `/api/mock/inbound/:channel` | `demoOnly`. Injects a simulated email or WhatsApp enquiry |

```
pending_payment ──succeeded──▶ confirmed
                ──failed─────▶ payment_failed ──▶ retry needs a live hold
                ──lapsed─────▶ expired
expired + late success ──▶ stays expired + one refund + one apology
```

At most one `processing` attempt per booking. Booking status and payment status stay separate
fields (INV-31). A redelivered event is a no-op (INV-11). No revive, no rebook (INV-12).

Worker: `FOR UPDATE SKIP LOCKED`, bounded retries with backoff, reclaims work abandoned by a
crashed worker (INV-24). Separate process; never starts the HTTP server.

**Exit.** `booking.expiry` (success/expiry race), `payment.idempotency` (duplicate events,
lost-response retry), `payment.lateRefund` (exactly one refund and one apology),
`jobs.recovery` (restart mid-job) all pass.

**Do not.** Let the browser declare a booking paid. Keep hold state in an in-memory timer.
Produce two refunds. Count a failed delivery as a reply (INV-26). Restart the expiry countdown
on a page refresh.

---

## 1I — Guest enquiries

**Files.** `routes/user/enquiries/*`, `routes/user/enquiryMessages/*`,
`routes/user/eventEnquiries/*`, `src/core/enquiry/assignment.ts`. (`core/jobs.ts` already
exists — 1G built it.)

| Method | Path | Guard |
|---|---|---|
| POST | `/enquiries` | A — persisted **before** any AI work, then enqueues `classify_enquiry` (INV-40) |
| GET | `/enquiries` · `/enquiries/:enquiryId` | A, own, paginated, guest-visible messages only |
| POST | `/enquiries/:enquiryId/messages` | A, own — `applyGuestReply` (INV-19) |
| POST | `/enquiries/from-booking/:bookingId` | A, own — the backend establishes the link (INV-22) |
| POST | `/eventEnquiries` | A — event type, dates/month/flexibility, guests, rooms, nights, optional budget, requirements |

`routeEnquiry` is the backend's decision, not the model's. Complaint → GM alert always
(INV-18). No configured active assignee → Unassigned.

**Exit.** `access.guestIsolation` (no cross-guest thread or booking), `enquiry.lifecycle`
(reopen rules), `enquiry.channelIsolation` (email/WhatsApp never in a guest account, INV-42).

**Do not.** Serialise internal notes or AI internals to a guest (INV-41). Reserve a lawn, quote
a package or take a deposit from the event form. Let a typed booking reference grant access.
Treat Unsorted or Unassigned as a fifth status (INV-43).

---

## 1J — Analytics and seeds

**Files.** `routes/user/analytics/*`, `seeds/run.ts`, `seeds/data/`.

`POST /analytics/events` — deduplicated funnel events from a random first-party `anon_id`. No
fingerprinting.

Seeds must cover, per §26: all roles, sales and reservations staff, the three supplied enquiry
fixtures **verbatim** (`ENQ-4410`, `ENQ-4411`, `ENQ-4412` — original wording, ambiguous dates
preserved with any interpretation stored separately), an unassigned enquiry, a low-confidence
one, a complaint, an AI failure, a resolved thread that reopens, a disabled employee with
reassigned enquiries, all four room types, ordinary and festival pricing, a blackout, a
sold-out night, multi-night price differences, a mixed-room booking, a confirmed booking, a
failed payment, an expired hold, a late payment with its refund, a promo application and a
promo at its usage limit, a date range for export, and dashboard events.

`seeds/run.ts` refuses a non-empty database without an explicit flag.

**Exit.** `analytics.seeds` passes and the full phase-1 sweep is green against seeded data.
The three supplied enquiries are byte-for-byte original. Reviewer flows do not depend on an
empty database.

**Do not.** Reword the supplied enquiry fixtures to make classification easier. Commit real
personal data. Let seeds run inside a migration.

---

## Standing rules for every sub-phase

- The backend computes every amount; client-sent money and status are ignored (INV-7).
- No transaction open across a payment wait, an AI call or a sleep (INV-20).
- Occupancy validated per room; at least one adult; no extra beds, no per-person charges.
- Different stay dates mean separate bookings. All rooms in one booking share dates and hold
  expiry.
- Ownership checked on the row, never inferred from a matching phone or email (INV-34).
- Mock and demo controls stay gated and scoped; no universal bypass (INV-52).
- Every limit comes from `core/policy.ts`. Never retype one of its numbers (INV-59).
- Tests use `tests/helpers/` and **real** parallel transactions. See `09-test-harness.md`;
  two sequential `await`s are not a concurrency test and will pass against broken code.
- Update `04-contracts.md`, `06-touch-map.md` and this file in the same commit as the code.
