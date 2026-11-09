# Invariants

Numbered rules that must hold no matter which sub-phase is being worked on. **Code comments
cite `INV-n` rather than re-explaining.** Each row names the sub-phase that enforces it and the
test that proves it — an invariant with no test is not enforced, it is hoped for.

If a change would break one of these, it is the wrong change. Raise it rather than working
around it.

## Inventory and booking

| # | Invariant | Enforced in | Proved by |
|---|---|---|---|
| INV-1 | Confirmed + live holds **never** exceed effective allotment for any room type and night. A booking reserves every requested room-night or none of them — no partial booking exists, hidden or otherwise | 1C, 1G · `core/inventory.assertAvailable`, `core/booking.createBookingHold` | `inventory.oversell`, `booking.atomicity`, `booking.rollback` |
| INV-2 | Check-in inclusive, checkout exclusive. A stay consumes one `booking_nights` row per room per night, `checkout − checkin` nights | 1C · `nightsForStay` | `booking.atomicity` |
| INV-3 | `room_day` rows are locked `FOR UPDATE ORDER BY (room_type_id, stay_date)` — the same order in reservations and in admin writes — and availability is rechecked **after** locks are held | 1C, 2F · `lockRoomDays` | `inventory.oversell` (concurrent, no deadlock) |
| INV-10 | An expired hold stops blocking inventory the instant it lapses. Committed usage is computed from `booking_nights` joined to live bookings, never from a stored counter, so no worker sits in the correctness path | 1C, 1H | `booking.expiry` |
| INV-9 | Allotment can never be set below existing confirmed bookings plus live holds, and the rejection names **every** conflicting date. Removing an override is re-validated against the resulting base value | 2F · `findCommitmentConflicts` | `admin.allotmentSafety` |
| INV-27 | A blackout stops new bookings but honours existing confirmed bookings and live holds | 2F | `admin.allotmentSafety` |

## Money

| # | Invariant | Enforced in | Proved by |
|---|---|---|---|
| INV-4 | The GST bracket is decided **per room, per night**, on that unit-day's post-discount value — not on the booking total, not on an average | 1B · `taxRateForUnitDay` | `pricing.gst` |
| INV-5 | A promo discount allocated across nights sums **exactly** to the discount. Proportional, floored, remainder to the highest-priced night | 1B · `allocateDiscount` | `pricing.gst` |
| INV-6 | Missing, ambiguous or insane tax configuration **fails the request loudly**. It never falls through to zero tax | 1B · `calculateQuote` | `pricing.gst` |
| INV-7 | The backend computes every amount. A total, price, discount or status sent by a client is ignored — not validated, ignored | 1F, 1G | `pricing.snapshot` |
| INV-28 | Purchased prices, discount, tax, tax config version and terms version are snapshotted onto the booking and its nights. A later base-price, festival-override, promo or tax change **never** moves a sold total, and a live hold keeps its agreed quote until expiry | 1G, 2F, 2G | `pricing.snapshot` |
| INV-29 | All money is integer paise. Rounding is half-up and happens once, at the per-room-night tax computation | 1B | `pricing.gst` |

## Payment

| # | Invariant | Enforced in | Proved by |
|---|---|---|---|
| INV-11 | A redelivered ledger event is a no-op. `payment_events.event_key` is unique and `processed_at` gates reprocessing — never a second confirmation | 1H · `confirmMockPayment` | `payment.idempotency` |
| INV-12 | A payment that succeeds after its hold was released does **not** revive or rebook. The booking stays expired, a refund is recorded and an apology is simulated | 1H | `payment.lateRefund` |
| INV-13 | At most one refund and one apology per payment, ever. `dedupe_key = paymentId` plus `UNIQUE (payment_id, reason)` | 1H · `refundLatePayment` | `payment.lateRefund` |
| INV-25 | The mock payment outcome field is honoured **only** when `DEMO_MODE` is on. The browser can never declare a booking paid; only the server processing its own ledger event confirms one | 1H · `beginPaymentAttempt` | `payment.idempotency` |
| INV-30 | A repeat request with the same `Idempotency-Key` and body replays the stored response without re-executing. Same key, different body is `409`. A dropped response never produces a second booking or payment. **The actor is part of the replay's identity** — a key belonging to a different principal is refused, never replayed | 1G · `middleware/idempotency` | `payment.idempotency`, **PE-19** |
| INV-31 | Booking status and payment status are separate fields. No payment condition is forced into the booking-status column | 1G, 1H | `booking.expiry` |

## Promo codes

| # | Invariant | Enforced in | Proved by |
|---|---|---|---|
| INV-8 | The usage cap holds under concurrency: capacity is counted from `held` + `consumed` rows while holding a `FOR UPDATE` lock on the `promo_codes` row — never from a cached counter. Redemption capacity is reserved with the hold and released with it | 1G, 2G | `promo.concurrency` |
| INV-32 | One code per booking, no stacking. Validity is checked against **booking time** only. A total can never go negative | 1F, 1G | `promo.concurrency` |

## Access control

| # | Invariant | Enforced in | Proved by |
|---|---|---|---|
| INV-33 | Every permission is enforced on the backend, per route. Hidden navigation and disabled buttons are presentation, never controls | 1D, 2A | `access.staffPermissions` |
| INV-34 | Ownership is checked on the row. A matching phone number or email address is **not** ownership — a verified phone does not unlock every booking that used it | 1D, 1G, 1I | `access.guestIsolation` |
| INV-15 | A disabled employee is blocked on every login path and their live sessions are rejected on the next request. `is_active` is re-read from the database every request, never trusted from the token | 2A · `middleware/adminAuth` | `access.disabledEmployee` |
| INV-16 | Refresh credentials rotate. Reuse of an already-rotated token revokes the entire chain. Only hashes are stored | 1D · `rotateRefreshSession` | `access.privilegeEscalation` (PE-14 sequential, **PE-18 concurrent** — the claim is only true if the rotation is claimed atomically) |
| INV-35 | Google sign-in and OTP verification establish identity and grant **no** privilege. A guest cannot become staff by any authentication path, and a role in a request body is never trusted | 1D, 2A | `access.privilegeEscalation` |
| INV-36 | Owners are seed-only — no API route creates or promotes one. A GM cannot create or promote a GM. The last active owner cannot be disabled | 2A | `access.staffPermissions` |
| INV-37 | Sales staff see all bookings but **cannot** export. Export is reservations, GM and owner only, and every export is audited with its date range and actor | 2E | `export.csv` |
| INV-38 | Staff rerouting their own assigned enquiry gains them no read access to anyone else's threads | 2C | `access.staffPermissions` |
| INV-14 | `audit_events` is append-only — a database trigger raises on UPDATE and DELETE. Owner actions are audited like everyone's. No route writes or edits audit records | 0, 2H | `jobs.recovery`, verified in `01-data-model.md` |
| INV-39 | `admin/rates/history` is a **scoped projection** of `audit_events` — only `rate.*`, `allotment.*` and `blackout.*` actions for the requested room type and window. It is GM-visible; the full audit read stays owner-only. These two must never collapse into one query | 2F, 2H | `access.staffPermissions` |

## Enquiries

| # | Invariant | Enforced in | Proved by |
|---|---|---|---|
| INV-40 | An enquiry is persisted **before** any AI work begins. A provider failure never loses an enquiry | 1I | `ai.validation` |
| INV-41 | Internal notes never reach a guest view, an outgoing reply, or an AI prompt. Enforced by `visibility` plus database CHECKs, not by remembering to filter | 1I, 2C, 2D | `enquiry.channelIsolation`, `ai.boundary` |
| INV-42 | Email and WhatsApp threads never appear in a guest's website account, even when the contact details match. Only a `website` enquiry may carry a `guest_user_id` — a database CHECK | 1I, 2B | `enquiry.channelIsolation` |
| INV-17 | Disabling an employee moves their **unresolved** enquiries to Unassigned while preserving category, status, messages and assignment history. Resolved threads keep their attribution | 2A · `reassignOnEmployeeDisable` | `access.disabledEmployee` |
| INV-19 | A guest reply to `awaiting_guest` or `resolved` moves the thread to `in_progress`, keeping the assignee if still active, otherwise Unassigned | 1I · `applyGuestReply` | `enquiry.lifecycle` |
| INV-43 | New, In progress and Resolved are the application statuses. Legacy awaiting_guest records read as In progress. Unsorted, Unassigned, complaint and unread are **flags and filters**, never statuses | 1I, 2B; user revision 9 Nov | `enquiry.lifecycle`, `enquiry.inbox` |
| INV-26 | A failed delivery is not a successful guest response and never counts as a reply | 1H, 2C | `enquiry.lifecycle` |

## AI

| # | Invariant | Enforced in | Proved by |
|---|---|---|---|
| INV-20 | No database transaction is ever open across a provider call | 2D · `processEnquiry` | `ai.validation` |
| INV-21 | Model context is **only**: the guest-visible thread, current approved `resort_info`, backend-computed prices and availability, and the one booking the backend verified is linked to that thread. Nothing else | 2D | `ai.boundary` |
| INV-22 | A booking reference typed into a message is a string, not authorisation. The backend validates the thread-to-booking link before loading anything | 2D | `ai.boundary` |
| INV-44 | The model has no tools, no SQL, no write, send or refund capability, and no access to other guests' data, staff credentials or owner reports. Prompt wording is not the boundary — data selection and permissions are | 2D | `ai.boundary` |
| INV-45 | Authoritative price text comes from the quote engine as a rendered block. Monetary claims in a draft that are not in that block are rejected or flagged. The guest's stated budget is kept separate from any resort offer, and a missing event price requires human confirmation rather than an invented one | 2D | `ai.boundary` |
| INV-46 | A draft is never sent automatically. It becomes a message only when a human explicitly sends it. An AI draft is not a reply for metric purposes | 2C, 2D | `enquiry.lifecycle` |
| INV-18 | A complaint always triggers the GM alert path once identified, **independent of model confidence**. Explicit complaint categorisation never depends on a confidence score | 2D · `routeEnquiry` | `ai.validation` |
| INV-47 | Malformed output is rejected; semantically invalid output is rejected; low confidence goes to GM review; a timeout or provider error leaves the enquiry intact, shows the failure and allows bounded retry. Every failure mode is **visible** so a potential complaint is never silently lost | 2D | `ai.validation` |
| INV-48 | Uncertain classification leaves `category` NULL. A confident-looking guess is never invented. Ambiguous dates preserve the original wording and store the interpretation separately as tentative | 2D | `ai.validation` |
| INV-49 | Every run records provider, model, prompt version, knowledge version, status, validation errors and latency. Validated output is stored; raw prompts are not kept in general logs | 2D | `ai.validation` |

## Jobs and operations

| # | Invariant | Enforced in | Proved by |
|---|---|---|---|
| INV-23 | A follow-up job is persisted **inside** the business transaction and becomes visible only after it commits. No job is lost because the write succeeded and the enqueue did not | 1G, 1H · `enqueueJob` | `jobs.recovery` |
| INV-24 | Jobs survive a restart. Claimed with `FOR UPDATE SKIP LOCKED`, bounded retries with backoff, and work abandoned by a crashed worker is reclaimed. In-memory timers never hold business state | 1H · `claimJobs` | `jobs.recovery` |
| INV-50 | A failure after a successful commit never reports a rollback that did not happen | 1G, 1H | `payment.idempotency` |
| INV-51 | Spreadsheet-bound guest text beginning `= + - @`, tab or CR is prefixed with `'` so a CSV consumer cannot execute it | 2E | `export.csv` |
| INV-52 | Mock controls and demo OTP exposure are gated and scoped. There is no universal bypass code, and no endpoint exposes a general OTP inbox containing other users' codes | 1D, 1H | `access.privilegeEscalation` |
| INV-53 | Never log a password, OTP value, token, credential, connection string or full private conversation. No SQL or stack trace reaches a client | all | reviewed in 1A, swept in 2H, **re-swept in the end-of-backend review — which found the request log was writing the Google OAuth `?code=` credential and fixed it to log `req.path` only** |

## Added in the pre-handoff review

| # | Invariant | Enforced in | Proved by |
|---|---|---|---|
| INV-57 | A date-range rate, allotment or blackout edit requires the `previewToken` returned by its `POST /preview`, recomputed **after** the locks are taken inside the transaction. A mismatch is `409 stale_write` — a concurrent admin edit is never silently overwritten | 2F · `previewToken` | `admin.allotmentSafety` |
| INV-58 | `terms_version` is snapshotted at **quote** time and copied onto the booking. `createBookingHold` never re-reads `resort_info`, so a guest is held to the terms they were shown. A missing current `booking_terms` row fails loudly, like a missing tax config | 1B, 1G | `pricing.snapshot`, `catalogue.reads` |
| INV-59 | Every business limit comes from `core/policy.ts`. A limit written as a literal in a Zod schema and again in a core function is a defect, even when the two numbers currently agree | all | `X-9` |
| INV-60 | A quote converts to **at most one live booking**. The quote row is locked `FOR UPDATE` and refused if it already has a confirmed booking or an unlapsed hold (`409 quote_already_booked`). An `Idempotency-Key` does not cover this — a retry that regenerates its key is a different request — and the `422 price_changed` re-quote is written outside the rolled-back hold transaction so the quote it names actually exists | 1F, 1G · `createBookingHold` | `booking.rollback` (RB-5, RB-8, RB-9) |

## Metrics honesty

| # | Invariant | Enforced in | Proved by |
|---|---|---|---|
| INV-54 | First reply means a human-sent, successfully delivered, guest-visible message. An AI draft is not a reply; a failed delivery is not a reply | 2H | `enquiry.lifecycle` |
| INV-55 | Live holds are never counted as sold nights. Booking value is by confirmation date, not stay date, and is labelled as to whether tax is included | 2H | — reviewed in 2H |
| INV-56 | No profit claim (no expense data), no total-resort-occupancy claim (no OTA data), and no claim that the client's direct-share target was met (synthetic data, labelled as such). Waiting work is shown, not excluded from averages | 2H | — reviewed in 2H |
