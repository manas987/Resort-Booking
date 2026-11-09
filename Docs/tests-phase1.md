# Phase 1 test specification

Written **before** the code, from two seats: the one that asks "how does an attacker or a race
break this" and the one that asks "would a guest or the GM accept this behaviour".

Each case has an ID, a setup, an action and the **observable** assertion. A case that asserts
an internal call happened rather than an outcome is not a test. Implement as `bun test` files
against `TEST_DATABASE_URL` — never the working database.

Runner rules: isolated database, truncate between cases, no shared mutable fixture, real
concurrency via real parallel transactions. **Never mock inventory, pricing or the clock in a
way that removes the thing under test.**

**Read `09-test-harness.md` before writing the first file.** It has the helper signatures, the
barrier that makes a concurrency case genuinely concurrent, how to test expiry without a fake
clock, and how to force a mid-transaction failure without adding a production seam. Two
sequential `await`s are not a concurrency test and will pass against code that oversells.

---

## pricing.gst.test.ts — 1B

| ID | Setup | Action | Assert |
|---|---|---|---|
| GST-1 | Garden Suite at ₹7,200 | 1 room, 1 night | `tax_rate_bps = 500`, tax = ₹360, total = ₹7,560 |
| GST-2 | Room priced at exactly ₹7,500 | 1 night | `500` bps — the threshold is inclusive (INV-4) |
| GST-3 | Room priced at ₹7,500 + 1 paise | 1 night | `1800` bps |
| GST-4 | Plantation Cottage ₹9,500 | 1 night | `1800` bps, tax = ₹1,710 |
| GST-5 | Festival override lifts Estate Room from ₹5,800 to ₹8,900 for 25 Dec | Stay 24–26 Dec | Night of 24th = `500`, night of 25th = `1800`. **Per unit per day, not an average** |
| GST-6 | ₹9,500 room, fixed promo of ₹2,100 | 1 night | Post-discount value ₹7,400 → `500` bps. A promo can move a night across the bracket |
| GST-7 | Two rooms at different prices, 3 nights, percent promo of 1,000 bps | Quote | Sum of per-night `discount_paise` equals the total discount **exactly**; remainder landed on the highest-priced night (INV-5) |
| GST-8 | Discount that does not divide evenly (₹1,000 across 3 nights) | Quote | Parts sum to exactly 100000 paise; no paise created or lost |
| GST-9 | Fixed promo larger than the room total | Quote | Total floors at tax-on-zero, never negative (INV-32) |
| GST-10 | `tax_config` table emptied | Quote | Request **fails loudly**; no quote with zero tax is ever returned (INV-6) |
| GST-11 | `tax_config` with `low_rate_bps > high_rate_bps` | Startup / quote | Rejected by the CHECK constraint |
| GST-12 | Any quote | Inspect every amount | All integers; no value has a fractional part; `total = room − discount + tax` |

## inventory.oversell.test.ts — 1C · the headline test

| ID | Setup | Action | Assert |
|---|---|---|---|
| OS-1 | Coffee Villa, allotment 1, one night, zero commitments | **Two genuinely concurrent transactions** both hold for that night | Exactly one succeeds; the other gets `409 availability_conflict`. Final committed count = 1 (INV-1) |
| OS-2 | Allotment 3, one night | 10 concurrent single-room holds | Exactly 3 succeed. Never 4 |
| OS-3 | Allotment 2, one night | 2 concurrent requests, each for 2 rooms | Exactly one succeeds. No request is partially satisfied |
| OS-4 | Allotment 5 on Estate Room, 1 on Coffee Villa | Concurrent mixed-room requests that both need the villa | One succeeds; the loser reserved **no** Estate Room either (INV-1) |
| OS-5 | Two room types, two nights | Concurrent requests touching the same rows in opposite logical order | No deadlock. Fixed lock order holds (INV-3) |
| OS-6 | Blackout on the middle night of a 3-night stay | Hold attempt | Rejected, naming that night. Effective allotment is 0 under blackout |
| OS-7 | Allotment override of 0 for one night | Hold attempt | Rejected for that night only |
| OS-8 | Allotment 10, physical stock 5 | Read effective allotment | Capped at 5 — stock always wins |
| OS-9 | One live hold on the last room | `readAvailability` | Shows 0 remaining. Display agrees with what `assertAvailable` would do |
| OS-10 | Hold whose `hold_expires_at` is in the past, worker **not** run | New hold attempt for that room | **Succeeds.** Expired holds stop blocking the instant they lapse, with no worker in the path (INV-10) |

## booking.atomicity.test.ts — 1G

| ID | Setup | Action | Assert |
|---|---|---|---|
| AT-1 | 2 Estate Rooms + 1 Coffee Villa, 3 nights, all available | Create hold | One booking, one reference, 3 `booking_rooms`, 9 `booking_nights`. All share `check_in`, `check_out` and `hold_expires_at` |
| AT-2 | Stay 14→16 Nov | Create hold | Nights are 14 and 15 only. Checkout exclusive (INV-2) |
| AT-3 | Villa unavailable on night 2 of 3 | Create hold | `409` naming room type and date. **Zero** rows in `bookings`, `booking_rooms`, `booking_nights` (INV-1) |
| AT-4 | Promo at its last remaining use, villa unavailable | Create hold | Fails, and the promo redemption is **not** consumed |
| AT-5 | Room type max 2 adults | 3 adults in that room | `400`, per-room occupancy. Not satisfiable by another room's spare capacity |
| AT-6 | Two rooms, one with spare capacity | Overload the other | `400`. Capacity does not pool across rooms |
| AT-7 | Zero adults, 2 children in a room | Create hold | `400` — at least one adult per room |
| AT-8 | 5 rooms requested | Create hold | `400` — max 4 rooms per booking |
| AT-9 | 15-night stay | Create hold | `400` — max 14 nights |
| AT-10 | Check-in 400 days out | Create hold | `400` — 365-day horizon |
| AT-11 | Checkout before check-in | Create hold | `400`, and the DB CHECK would also refuse it |
| AT-12 | Successful hold | Inspect booking | `tax_config_version` and `terms_version` snapshotted; per-night prices stored |

## booking.rollback.test.ts — 1G

| ID | Setup | Action | Assert |
|---|---|---|---|
| RB-1 | Force a failure after `booking_rooms` insert, before `booking_nights` | Create hold | No booking, no rooms, no nights. Nothing orphaned |
| RB-2 | Force a failure after commit of the booking but during job enqueue | — | Not possible by construction: the job is enqueued **inside** the transaction (INV-23). Test asserts the job row and booking row are either both present or both absent |
| RB-3 | Quote expired by 1 second | Create hold | `410 quote_expired`. No booking |
| RB-4 | Quote belonging to another guest | Create hold | `403`/`404`. No booking (INV-34) |
| RB-5 | Base price changed between quote and hold | Create hold | `422 price_changed` carrying a fresh quote. No booking until acknowledged. **Strengthened by the pre-publish review**: the test now reads the fresh quote back over HTTP and matches its total. It previously only asserted the id was present and different, which passed while the quote itself was being rolled back with the failed hold |
| RB-6 | Rollback path taken | Inspect pool | No leaked connection; pool returns to idle (the `finally` release) |
| RB-7 | A caught unique violation inside the hold transaction | Continue using the transaction | Still usable — the insert is wrapped in `withSavepoint`, so the reference retry loop can actually succeed. Without it Postgres leaves the transaction aborted (`25P02`) and the retry is dead code. **Added by the end-of-backend review** |
| RB-8 | One quote, two sequential holds with **different** Idempotency-Keys | Create hold twice | First `201`, second `409 quote_already_booked` naming the existing reference. One booking. A new key makes it a different request to the idempotency middleware, so only the quote's own single-use check can catch it. **Added by the pre-publish review** |
| RB-9 | One quote, two **genuinely parallel** holds | Create hold ×2 | Exactly one `201`, one `409`. One booking. The `FOR UPDATE` on the quote row is what serialises them; a sequential test alone passes against a read-then-write check. **Added by the pre-publish review** |

## booking.expiry.test.ts — 1G, 1H

| ID | Setup | Action | Assert |
|---|---|---|---|
| EX-1 | Hold created | Inspect | `hold_expires_at` ≈ now + 10 min, server-stamped |
| EX-2 | Client re-reads the booking repeatedly | — | `hold_expires_at` never moves. A refresh does not restart the countdown |
| EX-3 | Hold lapsed, worker runs | — | Status `expired`, promo capacity released |
| EX-4 | Worker runs twice on the same lapsed hold | — | Idempotent. One transition, one release (INV-10) |
| EX-5 | **Race:** payment success event and expiry both fire | — | Exactly one outcome persists. Either confirmed with inventory held, or expired with a refund recorded — never both, never neither |
| EX-6 | Hold expired, then payment succeeds | — | Booking stays `expired`; refund recorded; no revive, no rebook (INV-12) |
| EX-7 | Booking confirmed | Inspect fields | Booking status and payment status are separate columns (INV-31) |

## payment.idempotency.test.ts — 1G, 1H

| ID | Setup | Action | Assert |
|---|---|---|---|
| ID-1 | Same `Idempotency-Key`, same body | POST `/bookings` twice | One booking. Second call replays the stored response and status (INV-30) |
| ID-2 | Same key, **different** body | POST twice | Second gets `409 idempotency_key_reused` |
| ID-3 | First call in flight | Concurrent duplicate | `409`; a later retry sees the replay |
| ID-4 | Response lost after a successful write | Client retries with the same key | One booking, not two |
| ID-5 | Client polls `/bookings/reference/:reference/status` after an uncertain write | — | Recovers the real state without creating anything |
| ID-6 | Same ledger `event_key` delivered twice | Process both | One confirmation. Second is a no-op (INV-11) |
| ID-7 | Two different events for one payment processed concurrently | — | No double confirmation; `processed_at` gates it |
| ID-8 | Two `processing` attempts attempted on one booking | — | Second refused by the partial unique index |
| ID-9 | A failure raised *after* commit | — | Error surfaces, but the booking is not reported as rolled back (INV-50) |
| ID-10 | Client posts a body containing `totalPaise: 1` | Create hold | Ignored entirely. Server amount used (INV-7) |
| ID-11 | Client posts `status: "confirmed"` | Create hold | Ignored. Only a server-processed ledger event confirms (INV-25) |

## payment.lateRefund.test.ts — 1H

| ID | Setup | Action | Assert |
|---|---|---|---|
| LR-1 | Expired booking, late success event | Process | Exactly one `refunds` row, one simulated apology message |
| LR-2 | Same late success event redelivered | Process again | Still one refund, one apology (INV-13) |
| LR-3 | Two late-success events concurrently | — | `UNIQUE (payment_id, reason)` makes the second impossible |
| LR-4 | Refund delivery simulated as failed | — | `refund_failed` recorded and visible; not silently swallowed |
| LR-5 | Apology delivery fails | — | Recorded as failed. It is **not** counted as a guest reply (INV-26) |

## promo.concurrency.test.ts — 1F, 1G

| ID | Setup | Action | Assert |
|---|---|---|---|
| PR-1 | Code with `max_uses = 1` | Two concurrent holds using it | Exactly one consumes it; the other gets `409 promo_exhausted` (INV-8) |
| PR-2 | `max_uses = 3` | 10 concurrent holds | Exactly 3 redemptions |
| PR-3 | Hold with a promo expires | — | Capacity released; the code is usable again |
| PR-4 | Two codes in one request | Quote | `400` — one code per booking, no stacking (INV-32) |
| PR-5 | Code expired yesterday, stay next month | Validate | Rejected. Validity is **booking time**, not stay dates |
| PR-6 | Code valid now, stay after its expiry | Validate | Accepted — booking-time rule, documented in `03-decisions.md` |
| PR-7 | Inactive code | Validate | Rejected |
| PR-8 | Same request replayed with one idempotency key | — | One redemption, not two |

## pricing.snapshot.test.ts — 1G

| ID | Setup | Action | Assert |
|---|---|---|---|
| SN-1 | Confirmed booking at ₹9,500/night | GM raises the base price | Booking totals, per-night prices and tax **unchanged** (INV-28) |
| SN-2 | Confirmed booking | Festival override added over its dates | Unchanged |
| SN-3 | Confirmed booking with a promo | Promo edited or deactivated | Snapshotted discount unchanged |
| SN-4 | Confirmed booking | New `tax_config` version added | Booking keeps its original version and amounts |
| SN-5 | **Live hold**, not yet paid | Base price changed mid-hold | The accepted quote stands until expiry |
| SN-6 | Room type renamed | Read the booking | `room_name_snapshot` still shows what was sold |
| SN-7 | Booking read | Compare against the rate table | Values come from the snapshot, not recomputed |

## access.guestIsolation.test.ts — 1D, 1G, 1I

| ID | Setup | Action | Assert |
|---|---|---|---|
| GI-1 | Guests A and B, each with a booking | A requests B's booking by id | `403`/`404`. No data leaked |
| GI-2 | A guesses a sequential-looking reference | Status poll | Denied |
| GI-3 | A and B **share a phone number** | A lists bookings | Only A's own. A verified phone is not ownership (INV-34) |
| GI-4 | B's enquiry thread | A requests it | Denied |
| GI-5 | A replies citing B's booking reference in the message body | — | No link created, no access granted (INV-22) |
| GI-6 | Guest changes their email to B's old address | — | No account merge, no booking ownership transfer |
| GI-7 | Guest thread detail | Inspect response | No internal notes, no `ai_runs`, no confidence, no assignee internals (INV-41) |
| GI-8 | Unverified guest (email only) | Create hold | `403` — `verifiedGuest` required |

## access.privilegeEscalation.test.ts — 1D

| ID | Setup | Action | Assert |
|---|---|---|---|
| PE-1 | Register with `role: "gm"` in the body | — | Created as a guest. Body role ignored (INV-35) |
| PE-2 | Register with `kind: "employee"` | — | Guest. The `users_guest_shape` CHECK also refuses it |
| PE-3 | Guest with a valid token | Call any `/api/admin/*` route | `403` |
| PE-4 | Google sign-in with an email matching a seeded employee | — | Signs in as a guest. Google verification grants nothing (INV-35) |
| PE-5 | OTP verified for a phone that an employee also uses | — | No employee privilege |
| PE-6 | OTP code reused after success | — | Rejected. Single use |
| PE-7 | 6 wrong codes on one challenge | — | Locked after 5 attempts |
| PE-8 | Resend requested twice within 60 s | — | Second refused by the cooldown |
| PE-9 | Expired OTP (>5 min) | Verify | Rejected |
| PE-10 | OTP for purpose `verify_phone` | Used for `guest_login` | Rejected. Purpose-bound |
| PE-11 | Any request | Inspect `otp_challenges` | Only a hash stored, never the code |
| PE-12 | `DEMO_MODE=false` | Request OTP | No code in the response (INV-52) |
| PE-13 | `DEMO_MODE=true`, non-seeded destination | Request OTP | No code returned. Demo exposure is scoped, and no general inbox exists |
| PE-14 | Refresh token used once | Reuse the old value | Rejected and the whole session chain revoked (INV-16) |
| PE-15 | Access token with `alg: none` or a swapped algorithm | — | Rejected. Fixed algorithm, issuer and audience checked |
| PE-16 | Access token past expiry | — | `401` |
| PE-17 | Sessions table | Inspect | Only hashes. No plaintext refresh value anywhere |
| PE-18 | One refresh token, two **parallel** rotations | Count live sessions | Exactly one rotation succeeds and the chain is revoked. A sequential version of this test passes against the broken code — the bug was a read-then-write race (INV-16). **Added by the security review** |
| PE-19 | Guest B presents guest A's `Idempotency-Key` with A's exact body, after A's booking succeeded | Replay | `409 idempotency_key_reused`, and A's booking reference appears nowhere in the response. Before the fix this returned `201` **with A's booking payload** (INV-30, INV-34). **Added by the security review** |
| PE-20 | 60 anonymous `POST /promos/validate`, 40 anonymous `POST /register` | Count 429s | Both metered. Unmetered, promo validation is an enumeration oracle over every active code and its value. **Added by the security review** |

## enquiry.lifecycle.test.ts — 1I

| ID | Setup | Action | Assert |
|---|---|---|---|
| EL-1 | New website enquiry | Create | Persisted **before** any AI work; `classify_enquiry` job enqueued (INV-40) |
| EL-2 | Provider unavailable | Create | Enquiry still exists; failure visible; nothing lost |
| EL-3 | Thread in `awaiting_guest` | Guest replies | → `in_progress`, assignee retained if active (INV-19) |
| EL-4 | Resolved thread | Guest replies | → `in_progress`, `reopened_count` incremented |
| EL-5 | Resolved thread whose assignee is disabled | Guest replies | → `in_progress` and **Unassigned** (INV-19) |
| EL-6 | Any enquiry | Inspect status column | Only the four conversation statuses exist. Unsorted/Unassigned are flags, not statuses (INV-43) |
| EL-7 | Complaint identified | — | GM notification created regardless of confidence (INV-18) |
| EL-8 | Event form submitted | — | An enquiry is created. No lawn reserved, no deposit, no package price, no event payment |
| EL-9 | Booking-linked enquiry via the route | — | `booking_id` set by the backend after verifying ownership |

## enquiry.channelIsolation.test.ts — 1I

| ID | Setup | Action | Assert |
|---|---|---|---|
| CI-1 | WhatsApp enquiry whose number matches a registered guest | Guest lists enquiries | Not present (INV-42) |
| CI-2 | Email enquiry whose address matches a registered guest | Guest lists enquiries | Not present |
| CI-3 | Attempt to set `guest_user_id` on a WhatsApp enquiry | Insert | Refused by the `enquiry_guest_only_website` CHECK |
| CI-4 | Staff replies on an email thread | — | Delivery recorded on the **email** channel, not the website |
| CI-5 | Internal note on a website thread | Guest reads thread | Note absent (INV-41) |

## jobs.recovery.test.ts — 1H

| ID | Setup | Action | Assert |
|---|---|---|---|
| JR-1 | Job claimed, worker killed mid-handler | Restart | `locked_at` is stale, job reclaimed and completed (INV-24) |
| JR-2 | Two workers running | Claim concurrently | No job runs twice. `FOR UPDATE SKIP LOCKED` holds |
| JR-3 | Handler throws repeatedly | — | Bounded retries with backoff, then `failed_at` set and surfaced — not retried forever |
| JR-4 | Job with a `dedupe_key` enqueued twice | — | One row. At-most-once |
| JR-5 | Business transaction rolled back after enqueueing a job | — | No job row. The enqueue was inside the transaction (INV-23) |
| JR-6 | Expiry relies only on the worker | Kill the worker, lapse a hold | Inventory is still free to book — correctness does not depend on the worker (INV-10) |

## catalogue.reads.test.ts — 1E

| ID | Setup | Action | Assert |
|---|---|---|---|
| CR-1 | Four seeded room types | `GET /rooms` | Cover photo, summary, amenities, **inclusions**, capacity, and a base price explicitly labelled as a "from" price — never presented as a stay quote |
| CR-2 | Room type with `inclusions` and `amenities` populated | `GET /rooms/:slug` | Both returned as separate arrays. Inclusions are not merged into amenities |
| CR-3 | Inactive room type | `GET /rooms` | Absent from the list |
| CR-4 | `GET /rooms/:slug` with an unknown slug | — | `404` with the standard envelope |
| CR-5 | `GET /availability` with no dates | — | `400`. Incomplete input is rejected, never guessed |
| CR-6 | `checkOut` before `checkIn` | — | `400` |
| CR-7 | `checkIn` 400 days out | — | `400`, 365-day horizon |
| CR-8 | Occupancy exceeding every room type | — | Returns room types marked unavailable with a reason — not an empty list with no explanation |
| CR-9 | Night fully committed | `GET /availability` | That room type shows 0 remaining and a clear sold-out state |
| CR-10 | Any availability response | Inspect headers | `Cache-Control: no-store`. Stale cached availability must never authorise a booking (INV-1) |
| CR-11 | GM publishes a new `resort_info` version | `GET /content` | The new version is served immediately — content is live, never baked into a build artifact |
| CR-12 | `GET /content` | Inspect | Includes the `booking_terms` key and its version, which the review step needs (§8D) |
| CR-13 | Any catalogue response | Inspect | No internal fields — no physical stock, no allotment, no audit data |
| CR-14 | Four-day window, a sold-out night and a blackout night inside it | `GET /availability/calendar?slug=&from=&to=` (3B) | One row per date; the sold-out night shows `remaining:0`, the blackout shows `isBlackout:true` and `remaining:0`, the other two show the real count |
| CR-15 | A `room_day` price override on one date in the window | `GET /availability/calendar` | That date's `pricePaise` is the override; every other date is `base_price_paise` |
| CR-16 | `from`/`to` span of 63 days | `GET /availability/calendar` | `400` — the window is capped at `POLICY.availability.calendarMaxDays` (62) |
| CR-17 | `to` before `from` | `GET /availability/calendar` | `400` |
| CR-18 | An unknown or inactive slug | `GET /availability/calendar` | `404 not_found` |
| CR-19 | Any calendar response | Inspect headers | `Cache-Control: no-store` (INV-1, same reasoning as CR-10) |

## analytics.seeds.test.ts — 1J

| ID | Setup | Action | Assert |
|---|---|---|---|
| AN-1 | Fresh session | Post a `visit` event | One row, `anon_id` a random first-party value. No fingerprinting signal collected |
| AN-2 | Same `dedupe_key` posted 5 times | — | One row. Funnel steps count once per session |
| AN-3 | Unknown event type | — | `400`. Types come from a fixed enum |
| AN-4 | Oversized payload | — | `413`, bounded like every other body |
| AN-5 | Seeded database | Inspect enquiries | `ENQ-4410`, `ENQ-4411`, `ENQ-4412` present with their **original message text byte-for-byte**, no rewording to ease classification |
| AN-6 | Seeded database | Inspect fixtures | Every §26 case present: unassigned, low-confidence, complaint, AI failure, reopened-resolved, disabled-employee reassignment, all four room types, festival pricing, a blackout, a sold-out night, multi-night price differences, a mixed-room booking, a confirmed booking, a failed payment, an expired hold, a late payment with refund, a promo application, a promo at its cap, an export date range, dashboard events |
| AN-7 | Non-empty database | `bun run seed` without a flag | Refuses. Never silently overwrites existing data |
| AN-8 | Seeded database | Grep the fixtures | No real personal data; every person fictional |
| AN-9 | Seeded database | Walk the reviewer flows | None of them depend on the database being empty |

## Cross-cutting checks — run at the end of phase 1

| ID | Assert |
|---|---|
| X-1 | `rg -n "process\.env" apps/Backend/src` returns only `env.ts` |
| X-2 | `rg -n "^import .*routes/admin" src/routes/user` and the reverse both empty |
| X-3 | `rg -n "^import .*express" src/core src/jobs` empty |
| X-4 | No password, OTP, token or connection string in any log output during the full suite (INV-53) |
| X-5 | No stack trace or SQL fragment in any 4xx/5xx response body |
| X-6 | Oversized body `413`, malformed JSON `400`, unknown route `404` — all with the standard envelope and a `requestId` |
| X-7 | `find apps/Backend/src -type d -empty` empty |
| X-8 | Seeded database: every §26 fixture present, the three supplied enquiries **verbatim** |
| X-9 | No business limit is duplicated: `rg -n "\b(4\|14\|365\|750000)\b" src/routes src/core --glob '!policy.ts'` shows no bound that `core/policy.ts` already holds (INV-59). Read the hits, don't just count them — an unrelated `4` is fine, a second copy of `maxRoomsPerBooking` is not |
| X-10 | `rg -n "request\.(user\|body)\.(role\|userId\|kind)" src` empty — identity comes from `response.locals.principal` only (INV-35) |
