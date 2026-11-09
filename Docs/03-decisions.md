# Decisions, verified facts and assumptions

Feeds the TDD directly. Three kinds of entry, never mixed:

- **[VERIFIED]** — checked against an authoritative external source, cited.
- **[DEVIATION]** — departs from `Docs/Product.md`, with the reason.
- **[ASSUMPTION]** — our implementation default. Not a client-supplied fact. Never presented
  on a product screen as an assumption, never quoted back as resort truth.

---

## [VERIFIED] GST on accommodation

**≤ ₹7,500 per unit per day → 5%** (no ITC). **> ₹7,500 → 18%** (with ITC). The former 12%
slab is abolished.

Source: Notification No. 15/2025-Central Tax (Rate), CBIC, dated 17 Sep 2025, effective
**22 Sep 2025**, amending Notification 11/2017-CTR, following the 56th GST Council meeting.

Implementation:

- The bracket is chosen **per room, per night**, on that unit-day's **post-discount** taxable
  value — "per unit per day" is the statutory wording, so it is not the booking total and not
  the average nightly rate. A promo can therefore move one night of a stay from 18% to 5%,
  and the discount allocation rule in `00-conventions.md` exists to make that deterministic.
- Rates live in `tax_config` as basis points (`500`, `1800`) with the threshold in paise
  (`750000`), versioned. The version in force is snapshotted onto every booking, so a later
  rate change cannot alter a sold booking.
- If tax config is missing, ambiguous or fails its sanity check, the request **fails loudly**.
  It never falls through to zero tax.
- We charge the tariff rate on a room-only tariff. ITC is a resort accounting concern, not a
  booking-engine one, and is out of scope.

## [DEVIATION] AI provider is Google Gemini, not Anthropic Claude

`Docs/Product.md` §4 names Anthropic Claude and §17 says "Use real Claude inference". The
build uses the Gemini API instead, at the user's instruction, for free-tier cost reasons.

- All provider contact is confined to `src/adapters/ai/gemini.ts` — one function,
  `generateStructured`, called only by `core/enquiry/processing.ts`. Reverting to Claude is a
  one-file change; nothing else in the pipeline knows which vendor answered.
- Everything §17 actually requires is unchanged and vendor-independent: schema-validated
  structured output, semantic validation on top of shape validation, bounded context, bounded
  retries and timeouts, backend-owned prices, recorded model and prompt versions, no tool or
  write access, GM review for low confidence, never auto-send.

**[VERIFIED] Model.** `GEMINI_MODEL` defaults to `gemini-3.5-flash-lite` — current stable,
described by Google as its fastest and most cost-effective tier — overridable to
`gemini-3.8-flash` if draft quality needs it. Both are stable, not preview. Checked against
Google's AI Studio model docs (Nov 2026); note `gemini-2.5-flash` routes to
`gemini-3.5-flash-lite` after 1 Dec 2026, so the legacy IDs are not used.

One model, two prompts (classify+extract, then draft). Not two models: a second model doubles
the prompt and version records and the failure modes for no measured gain at this volume.

**Quota: not claimed.** Google no longer publishes per-model free-tier request counts — the
docs direct you to your own AI Studio dashboard. No RPD or RPM figure appears in our docs or
TDD. Structured output uses `responseMimeType: 'application/json'` with a response schema.

## [ASSUMPTION] Policy defaults

**These numbers exist twice: here, and in `apps/Backend/src/core/policy.ts`, which is the only
runtime copy. Change both in the same edit** — the doc is what a reviewer reads, the object is
what runs, and drift between them is a lie in the TDD (INV-59). Nothing else in the codebase
may hold one of these values as a literal.

| Item | Value |
|---|---|
| Resort timezone | `Asia/Kolkata` |
| Check-in / checkout time | 14:00 / 11:00 |
| Child | 2–11 years. Under 2 not counted against occupancy and not charged |
| Rooms per booking | max 4 |
| Nights per booking | max 14 |
| Booking horizon | 365 days ahead |
| Quote lifetime | 5 minutes |
| Payment hold | 10 minutes |
| Access JWT | 15 minutes |
| Refresh session | 7 days, rotating, revocable |
| OTP | 6 digits, 5-minute expiry, single use, 5 attempts, 60 s resend cooldown |
| Promo validity | Checked against **booking time only** (quote creation), not stay dates. The simplest explicit rule the spec permits |
| Extra beds / per-person charges | None. The room rate covers permitted occupancy |
| Working hours (for the 30-min reply metric) | 09:00–19:00 IST, all days. Clock pauses outside |
| Default alert channel | In-app notification. External delivery is simulated |
| Pagination | Default 25, max 100, no range wider than 366 days |
| Job queue | 5 attempts, 300 s stale-lock reclaim, 10 per claim, 2 s poll |
| AI call | 20 s timeout, 2 attempts, confidence below 0.60 goes to GM review |

## [ASSUMPTION] Synthetic room types and rates

Internally consistent and deliberately **not** derived from the client's ₹9,500 ADR figure,
which is a problem-estimation input, not our price list. Chosen to straddle the ₹7,500 GST
boundary so both brackets are demonstrable, and to total **29 website keys of 76 physical** —
the site sells an admin-set allotment, never the whole house.

| Room type | Base ₹/night | Max adults / children / total | Physical stock | Website allotment | GST bracket |
|---|---|---|---|---|---|
| Estate Room | 5,800 | 2 / 1 / 3 | 24 | 10 | 5% |
| Garden Suite | 7,200 | 2 / 2 / 4 | 16 | 8 | 5%, near the boundary |
| Plantation Cottage | 9,500 | 2 / 2 / 4 | 24 | 6 | 18% |
| Coffee Villa | 14,500 | 4 / 2 / 5 | 12 | 5 | 18% |

Festival override 20–31 Dec raises Estate Room and Garden Suite above ₹7,500, which flips
their bracket to 18% and exercises the per-unit-day rule on a real seeded stay.

## [ASSUMPTION] Decisions from the structure and UI review

| Decision | Choice and reason |
|---|---|
| Mock payment outcome | An `outcome` field (`succeed` / `decline` / `succeed_late`) on the payment attempt, honoured **only** when `DEMO_MODE` is on and ignored otherwise. The mock payment screen shows explicit test choices, so a reviewer following the guest journey alone can still observe the failure and expiry behaviour §32 asks for. This replaced a separate mock-payment route, which is now gone |
| Room inclusions | A dedicated `inclusions text[]` column on `room_types`, distinct from `amenities`. §8C lists "room-only inclusions" separately, and the two genuinely differ — what the rate includes versus what the room has. Structured rather than prose so the AI can state inclusions without inventing them |
| Rate change history | One combined feed at `GET /api/admin/rates/history`, covering price, allotment and blackout changes. It is a **scoped projection** of `audit_events` — only `rate.*`, `allotment.*`, `blackout.*` for the requested room type and window. GM-visible, while the full audit read stays owner-only. The two must never collapse into one query (INV-39) |
| Backend split | Two route trees, `/api/user/*` and `/api/admin/*`, sharing no HTTP code — separate routers, schemas, controllers and auth middleware. One shared non-HTTP layer, `src/core/`, holds pricing, inventory, booking, token and enquiry workflows. Without that single core the overbooking rule would live in two files that must stay in sync, and "zero website overbookings" is the graded requirement |

## [ASSUMPTION] Scope boundaries worth naming

- Lawns, conference halls and event capacities are **not** modelled. A guest asking about a
  250-person wedding or a conference hall does not prove the resort has either; the AI must
  ask or defer to staff rather than confirm a facility that is not in approved information.
- No physical room-number assignment. Guests buy a room type; the resort's own system assigns
  the key.
- Form C passport capture happens at check-in, not online.

## [ASSUMPTION] Guest identity design (1D)

Product.md §7 gives a "recommended technical default" rather than an exact protocol. These
fill the gaps it leaves open.

| Decision | Choice and reason |
|---|---|
| Token delivery | Access token (15 min) returned in the JSON body, held by the SPA in memory — never `localStorage`, per §7's explicit instruction. The refresh credential is set as an `httpOnly`, `sameSite=lax` cookie (`secure` in production), scoped to `/api/user/auth`, and is never readable by page JavaScript |
| CSRF | No separate CSRF token. The refresh cookie only reaches `/refresh` and `/logout` — not the booking/payment mutations, which require the Bearer access token — and `middleware/cors.ts` already restricts credentialed responses to the exact `APP_ORIGIN`. A third-party page can trigger the cookie-bearing request but cannot read its JSON response under that CORS policy, which is the actual protection §7 is asking for here. Revisit if a cookie ever authorises a mutation directly |
| JWT issuer/audience | Fixed literals `resort-api` / `resort-app`, checked on every verify. Not specified in `04-contracts.md` beyond "set and checked" — any fixed pair satisfies the contract; these are arbitrary but permanent once chosen |
| OTP vs signup/login split | `/otp/request` and `/otp/verify` only ever run purpose `guest_signup` (no existing row at that destination) or `guest_login` (an existing, already-verified row). `/account/contact/verify-start` is the only path that opens a `verify_email`/`verify_phone` challenge, always for the calling principal's own account — so `/otp/verify` for those two purposes requires the same bearer token that started the challenge (via `optionalGuest`), never an anonymous destination lookup |
| Register's role in the flow | `POST /register` creates the `users` row (unverified, no session). It does not itself log the guest in — the guest must immediately complete `guest_signup` OTP against the contact they just supplied to receive their first access/refresh pair. This keeps "has a session" and "has a verified contact" as two separately-testable states, matching `requireGuest` vs `requireVerifiedGuest` |
| Google sign-in, email already taken | `users.email` is globally unique across `kind`, so a Google account whose email belongs to an existing employee row cannot be written onto a new guest row. Rather than fail the sign-in (which would make an existing employee email block guest access entirely — not what §16/INV-35 wants) or leave `email` NULL (`users_guest_has_contact` requires a contact), the new guest row gets a synthetic, non-deliverable placeholder in the reserved `.invalid` TLD (RFC 2606) — `google-<sub>@accounts.invalid` — and is identified going forward only by `google_sub`. No employee row is read, touched, or upgraded (INV-35, PE-4) |
| Demo OTP exposure scope (INV-52) | Scoped to a **fixed allowlist of destinations**, not to seed data — seeded reviewer rows do not exist until 1J, and demo exposure must not depend on sub-phase order. `routes/user/auth/otp.ts` holds a short literal list of reserved demo contacts (`demo@resort.test`, `+910000000000`); the OTP code is only ever returned in a response when `DEMO_MODE=true` **and** the destination is on that list. `DEMO_MODE=true` alone never returns a code for a real destination |

## [ASSUMPTION] Payment lifecycle design (1H)

| Decision | Choice and reason |
|---|---|
| Payment apology delivery | §32/INV-12 require "one refund and one apology simulated" for a late-success payment, but `adapters/messaging.ts`/`deliverMessage` is reserved for real `enquiry_messages` rows (`06-touch-map.md`'s own caller list), and a payment notification has no enquiry thread to attach one to. The apology is instead an at-most-once `jobs` row — `type: 'send_message'`, `dedupe_key = 'apology:<paymentId>'` — enqueued by `refundLatePayment`. The existing `jobs_dedupe_uq` index is what makes it "one, ever," and `completed_at`/`failed_at` are what "recorded as failed, not swallowed" means here. No new table, no new column |
| Refund/apology delivery failure, no trigger | Neither `refundLatePayment(paymentId)` nor the apology job payload carries an `outcome`-style field — unlike `beginPaymentAttempt`, nothing documents how to force a failed delivery. The mock path is deterministic success; `LR-4`/`LR-5` arrange a `refund_failed` / `jobs.failed_at` state directly in the database to prove the schema can represent and surface it, the same arrangement style already used for `setRoomDay`, `tax_config` edits, and simulated admin rate changes |
| `routes/system/mock/*` and `middleware/demoOnly.ts` deferred to 1I | 1H's file list names both, but the one route they serve — `POST /api/mock/inbound/:channel`, "injects a simulated email or WhatsApp enquiry" — needs the `enquiries` table, which does not exist before 1I. Building `demoOnly.ts` now would be a guard with nothing to guard (dead code). Both land with 1I, when there is an enquiry to inject |

## [ASSUMPTION] Employee auth and accounts design (2A)

| Decision | Choice and reason |
|---|---|
| Employee Google sign-in shape | §6 says Google login must be "linked to their approved employee identity" but names no linking mechanism, and `admin/staff` creation never collects a `google_sub`. `POST /admin/auth/google` takes a Google Identity Services `idToken` directly (no redirect dance, unlike the guest tree's `/google/start`+`/google/callback`) and performs **first-use binding only**: it never creates a row. If `google_sub` is already linked, match on it; otherwise match an unlinked, active employee row by a Google-verified email and link `google_sub` to it on that first successful sign-in. No match, no email verification, or an inactive row — generic failure, same as a wrong password (INV-15, INV-35) |
| 401 vs 403 on the admin tree | `02-permissions.md`'s error table reserves 401 for "no identity to evaluate." DE-3 (a token valid at mint time, employee disabled since) and SP-25 (a syntactically valid guest token on an admin route) both need **403**, not 401 — the token itself was fine, the account just doesn't satisfy the guard. `middleware/adminAuth.ts` splits `resolveTokenSubject` (token validity → 401 on failure) from `loadEmployeePrincipal` (role/activity → 403 on failure) to make that distinction cleanly, rather than collapsing both into one null check the way the guest tree's `requireGuest` does. (The guest tree is already shipped and verified — this is a 2A-only refinement, not a retrofit) |
| New error code `last_owner` (409) | SP-19 ("disabling the last active owner") needed a 409 and no existing code fit — `stale_write` is about optimistic-lock conflicts on rate/inventory previews, a different thing. Added `last_owner` to `middleware/errors.ts` and `00-conventions.md`'s table in the same change |
| Employee login rate limit numbers | §7 asks for "rate limits, especially on staff login" but states no numbers. Added `POLICY.employeeLogin` (`windowSeconds: 300, maxPerAccount: 5, maxPerIp: 20`), mirroring the shape of 1D's OTP rate limiter (same 300s window) rather than inventing a different shape for no reason |
| `role: 'owner'` parses, then 403s | `createStaffSchema`/`updateStaffSchema` accept `'owner'` as a syntactically valid `role` value, deliberately not rejecting it at the Zod layer. SP-16/SP-17 expect a request naming `role: "owner"` to fail with 403 `forbidden` (a permission decision), not 400 `validation_failed` (a shape decision) — `assertCanManageRole` in `routes/admin/staff/controllers.ts` is what actually enforces INV-36 |
| `assertCanManageTarget` vs `assertCanManageRole` | Split into two functions because disable/enable never change `role` — applying the "no promotion" check (`desiredRole === 'owner' → forbidden`) to a same-role disable would wrongly block an owner disabling another owner (SP-20). `assertCanManageTarget` is the ownership-only half (can this actor touch this row at all), reused by both |
| `createEmployee`'s disabled-row token | `Docs/09-test-harness.md`'s `createEmployee({isActive: false})` must still return a usable `accessToken` even though `loadPrincipal` returns `null` for an inactive row by design (INV-15) — the factory falls back to minting directly from the known row shape rather than through `loadPrincipal`, so DE-1-style setup (a token that predates the disable) is still constructible without weakening `loadPrincipal` itself |

## [ASSUMPTION] Inbox reads design (2B)

| Decision | Choice and reason |
|---|---|
| `routeEnquiry` does not write `notifications` itself | `06-touch-map.md`'s table lists `notifications` as written by `routeEnquiry`, but `routeEnquiry`'s fixed signature (`04-contracts.md`) takes no `enquiryId` — it cannot address a row it has no id for. The actual writer is whichever caller holds the `enquiryId` right after calling it (matching every other `routeEnquiry` caller's existing responsibility for `assignEnquiry`). No caller can produce `category: 'complaint'` yet — that only starts with 2C's category correction and 2D's classification — so this is dormant, not broken, in 2B. It gets wired into those two call sites when they're built, not retrofitted here from a guess about message wording neither sub-phase has specified yet. |
| `Unassigned` excludes resolved threads | Neither `02-permissions.md` nor `11-phase2-backend-staff.md` defines "Unassigned" precisely enough to code against — only that it is a GM/owner review lane. A resolved thread with no assignee needs no action, so both the `?unassigned=true` filter and the `counts` facet exclude `status = 'resolved'`. The two must agree or IB-3 ("counts equal their filtered lists") fails by construction — found exactly that way, as a test failure, not reasoned out in advance. |
| Keyset cursors carry a `::text`-cast value, not the parsed `Date` | `src/db.ts` installs no custom type parser for `timestamptz` (OID 1184), so `pg` hands back a JS `Date`. `JSON.stringify`-ing a `Date` for a cursor calls `.toJSON()` → `.toISOString()`, which truncates to millisecond precision — Postgres timestamps carry microseconds. Round-tripping that truncated value back into a `($N::timestamptz, $M::uuid)` comparison does not exactly match the row it came from, silently dropping or duplicating rows at a page boundary whenever two rows tie within the same millisecond (common when a test seeds dozens of rows in a tight loop). Found by IB-1 actually returning fewer rows than inserted, not by inspection. Fixed locally in `routes/admin/enquiries/controllers.ts` by additionally selecting `${column}::text AS cursor_value` and encoding that instead — a lossless round trip. The guest tree's existing `user/bookings` and `user/enquiries` list cursors (1G, 1I) encode the parsed `Date` the same lossy way; they are already shipped and verified, and the dataset sizes their own tests use never happened to tie within a millisecond, so this is flagged here rather than touched — a drive-by fix to finished, verified Phase 1 code is a bigger change than this sub-phase asked for. |

## [ASSUMPTION] Inbox actions design (2C)

| Decision | Choice and reason |
|---|---|
| `notifyComplaintAlert` wired in here, as promised in 2B | 2B's decision log said the `notifications`-on-complaint gap would be filled "at 2C's category correction and 2D's classification." `routes/admin/enquiries/controllers.ts`'s `updateEnquiryCategoryController` is the first live call: when `routeEnquiry` returns `notifyGm: true`, it calls the new `core/enquiry/assignment.ts` export `notifyComplaintAlert(client, {enquiryId, publicRef})` inside the same transaction as the category update. |
| `adapters/messaging.ts`/`deliverMessage` built now, not in 1I | 1H's and 1I's progress logs both deferred it, correctly, because neither sub-phase had a real caller — `deliverMessage`'s only legitimate caller, per `06-touch-map.md`, is `jobs/handlers/sendMessage`, and nothing enqueued an `enquiry_reply`-kind job until this sub-phase's `POST /admin/enquiryMessages/:enquiryId` existed. Mock, deterministic success, same shape as the payment mock adapter. |
| `first_staff_reply_at` is stamped by the job handler, not the controller | INV-26/INV-54 define a reply as "human-sent, **successfully delivered**." Delivery is asynchronous (queued, not synchronous with the HTTP response), so the controller cannot know the outcome yet — only `jobs/handlers/sendMessage`'s `handle()` stamps it, and only on `status === 'sent'`. IB-10 needed an explicit `processBatch()` call between sending and asserting the stamp, the same testing convention 1H established for anything that completes via the worker. |
| No documented way to force a failed delivery | Same situation as 1H's refund/apology path — the mock adapter has no `outcome` knob like `beginPaymentAttempt` does, and nothing in `Docs/` asks for one on messaging. IB-14 arranges `delivery_status = 'failed'` directly in the database, the same precedent LR-4/LR-5 already set, rather than inventing an undocumented field to drive it through the real path. |
| `teamForCategory` duplicated, not exported from `core/enquiry/assignment.ts` | `routeEnquiry`'s private `teamFor` is not part of that file's `04-contracts.md` export list, and `enquiryAssignment`'s claim guard (IB-17/IB-18) is the only other place that needs the room→reservations / wedding,offsite→sales mapping. A five-line duplicate stays smaller than widening a core file's contract surface for one caller. |
| IB-12 (regenerate supersedes a draft) deferred to 2D | "Regenerate" is `admin/enquiryDrafts`'s own route (`POST /enquiryDrafts/:enquiryId`), which doesn't exist until 2D. Faking it with a raw SQL arrangement here would test the schema's partial-unique-index behaviour, not any code this sub-phase wrote — left for 2D, where the route that actually performs it will exist. |

## [ASSUMPTION] AI pipeline design (2D)

| Decision | Choice and reason |
|---|---|
| Classify/draft response shapes | Neither `Docs/04-contracts.md` nor `01-data-model.md` specifies the model's JSON field names — only that classify produces a category/confidence/extraction and draft produces a reply. `adapters/ai/responseSchemas.ts` defines both shapes (paired `*JsonSchema` for the provider, `*ResponseSchema` Zod for validation): `extracted` carries `checkIn`/`checkOut`/`adults`/`children`/`guestCount`/`budgetPaise`, plus `datesOriginalText`/`datesTentative` for INV-48's "preserve the original wording, store the interpretation as tentative." The draft response carries a `statesPrice` boolean the model sets itself, rather than the backend grepping free text for a currency-shaped substring to decide whether INV-45 applies. |
| The quote block is rendered only for a booking-linked enquiry | `calculateQuote` needs a `roomTypeId`, and nothing resolves a guest's free-text room name (e.g. "villa") to one — inventing that mapping risks quoting the *wrong* room, a worse failure than deferring. INV-21/22's "the one booking the backend verified is linked" is the only context where a room type is unambiguous, so that is the only case a quote block exists; otherwise it is `null` and the draft prompt instructs the model to defer to staff (INV-45's "missing event price requires human confirmation rather than an invented one"). Confirmed in the required live run: ENQ-4411 ("villa... 14-16 Nov"), with no linked booking, correctly drafted "A team member will follow up" rather than inventing a price. |
| That quote block recomputes fresh, never reuses the booking's locked total | AB-11 requires prices "rechecked for staleness before sending." A confirmed booking's `total_paise` is an intentionally immutable snapshot (INV-28), so re-deriving it via `calculateQuote` at today's rates — explicitly labelled "at today's rates" in the rendered text — is what actually tests staleness, rather than parroting back a number that by design never moves. |
| `ai_status = 'invalid'` vs `'failed'` | The `enquiries` CHECK constraint has both values, but neither `04-contracts.md` nor the phase doc says which failure mode gets which. Schema/semantically-invalid output (deterministic, not worth retrying) maps to `'invalid'` plus `needs_review = true` (the Unsorted lane). A timeout/provider error (transient, bounded-retried) maps to `'failed'`, leaves the enquiry otherwise intact per INV-47's own wording, and raises an `ai_failure` notification to every active GM/owner instead of forcing it into review. |
| Two job types, one implementation | `classify_enquiry` and `draft_enquiry_reply` both just call `processEnquiry(enquiryId)` — its fixed contract always runs the whole pipeline; there is no "draft only" entry point. The two job *types* exist to record why the pipeline ran (initial vs. an explicit regenerate), which `06-touch-map.md` already treats as two distinct callers even though the code is identical. |
| `POST /enquiryDrafts/:id` (generate/regenerate) enqueues; `POST /enquiryDrafts/:id/retry` runs synchronously | `06-touch-map.md` attributes `processEnquiry` to three callers: both job handlers *and* `admin/enquiryDrafts` (retry) directly. Read literally, "generate" follows the same async job-queue pattern as every other AI trigger, while "retry" — a human reacting to an already-visible failure, wanting an immediate answer — calls the bounded pipeline directly. `processEnquiry` already bounds its own provider retries (`POLICY.ai.maxAttempts`); the retry route is the human-initiated re-run after those were exhausted, not a second retry layer. |
| Stubbing `generateStructured` for `ai.validation`/`ai.boundary` | `bun:test`'s `mock.module` rewrites the module's export at the live-binding level, so `core/enquiry/processing.ts`'s existing `import { generateStructured }` picks up the stub regardless of import order — `tests/helpers/aiStub.ts` registers it once, and both AI test files share it. A FIFO queue models call order (classify, then draft); an unconsumed queue falls back to a safe default so an accidentally-under-queued test fails loudly on a wrong assertion rather than hitting the real network. |
| AV-12/13/14 (the three supplied enquiries) validated via the required live run, not a stub assertion | "Did the draft avoid inventing an unapproved fact" has no structural signature a deterministic test can grep for, unlike a price figure (which AB-7/AB-8 check mechanically by comparing against the rendered quote block). The phase doc's own exit criteria require "at least one end-to-end classify-and-draft must hit the live API" — this is that run, reported below, exercised against ENQ-4411 verbatim. |

## [ASSUMPTION] Staff reads and export design (2E)

| Decision | Choice and reason |
|---|---|
| `admin/rooms` shows `physical_stock`/`base_allotment`/`is_active` | The guest-facing `user/rooms` deliberately hides these (CR-13), but §5 grants staff "room information and capacity" for operational use, and nothing says to hide the operational figures from an employee the way they're hidden from a guest. Listed with a per-room `remainingInWindow`/`hasBlackoutInWindow` summary (min across a default 14-day window, or the requested `?from&to`); the full per-night breakdown is only in the detail route. |
| Admin bookings list has no ownership scope | Unlike `admin/enquiries` (INV-38, staff see only their own assigned threads), §5 grants reservations *and* sales visibility into every booking — there is no per-booking "assignee" concept for bookings at all. `requireEmployee` alone is the guard. |
| CSV columns and escaping order | No literal column list exists anywhere in `Docs/`. Picked the natural purchased-snapshot fields (`04-contracts.md`'s `bookings`/`booking_rooms` columns) with the header row itself serving as "the row format documented in the header" (11-phase2-backend-staff.md's own phrase). INV-51's leading-character prefix is applied before CSV quoting, so a value needing both (e.g. `=Doe, "Jane"`) gets the apostrophe first and the quote-wrap second — the two rules check different things and must not interfere with each other. |
| Export audit's `targetKind` | `recordAuditEvent`'s contract takes a `targetKind` string with no enum — used `'export'` (no `targetId`, since an export has no single row identity) with `after: {from, to, rows}`, the exact date range plus a row count, which is what EC-11 actually needs to verify. |

## [ASSUMPTION] Rates, inventory and blackouts design (2F)

| Decision | Choice and reason |
|---|---|
| `from`/`to` are inclusive in every 2F range body | A calendar range an admin picks ("20–31 Dec") is naturally inclusive at both ends, unlike a stay's exclusive checkout. Converted internally to `nightsForStay`'s exclusive-checkout shape via `addDays(to, 1)`. |
| `previewToken` hashes the raw `room_day` override row, not the *effective* merged-with-base value | `effectiveAllotment`/`readAvailability` compute a value that depends on `room_types.base_allotment` too, which this mechanism was never asked to detect changes to. Hashing the override row directly (`snapshotRoomDayState`, added 2F) means "staleness" means exactly "this row changed since preview" — simpler, and matches the literal shape `previewToken`'s contract signature already specifies. |
| Removing an override is checked against the **base**, not against "no limit" | `findCommitmentConflicts`'s `proposedAllotment: null` branch unconditionally returns no conflicts — a shortcut for some caller this sub-phase doesn't have, not a safety hole in my own code: the DELETE/remove routes never pass `null` as the proposed value. They fetch the room type's actual `base_allotment` and pass that as a concrete `proposedAllotment`, so AS-5 ("removal is not automatically safe") is genuinely checked against what removing the override would leave in effect. |
| Blackout's "conflicts" are informational, never blocking | AS-7/INV-27 require a blackout to succeed despite existing commitments — it stops *new* bookings, not existing ones. `findCommitmentConflicts({blackout: true})`'s result is surfaced in the preview response for GM awareness but never turned into a 409 at apply time, unlike inventory's. |
| `admin/rates`'s preview does not call `calculateQuote` | `06-touch-map.md` lists `admin/rates (preview)` as a `calculateQuote` caller, but no written test (`PV-*`, `AS-*`) exercises a sample-quote-impact preview, and there is no stay/occupancy context in a price-range-edit body to quote against — inventing one risks showing a number nobody asked for. Flagged here rather than guessed at; a price edit's preview instead shows the touched dates' current price/allotment/blackout state, the same shape the other two features' previews show. |
| `admin/inventory`/`admin/blackouts` read routes reuse `readAvailability` | Rather than a bespoke query, the per-night allotment/committed/remaining/isBlackout breakdown an admin needs is exactly what `readAvailability` already computes — reusing it keeps the admin and guest-facing reads from ever disagreeing about what "committed" means (06-touch-map.md's own stated risk for this expression). |
| `GET /rates/history`'s scoped projection | Filters `audit_events` by `target_id = roomTypeId` and `action IN ('rate.update','allotment.update','blackout.set')` (optionally narrowed by `kind`) within the requested window — never a general audit read. Every 2F write records its `target_id` as the room type's id specifically so this filter works. |

## [ASSUMPTION] Promos and resort information design (2G)

| Decision | Choice and reason |
|---|---|
| Promo edits never touch `bookings` | PA-1/PA-2 are true by construction, not by a guard this sub-phase had to add — `discount_paise`/`total_paise` are snapshotted onto the booking at hold time (INV-28) and nothing in `admin/promos` writes to `bookings` at all. |
| `updatePromoSchema`'s cross-field date check only applies when both dates are in the same request | A partial `PATCH` that only sends `endsAt` has no access to the row's existing `startsAt` without an extra read; checking the two together only when both are present in one request is a deliberate, smaller scope than re-validating the whole row's date window against every partial update. No written test (PA-1..8) exercises a partial date-only update, so this is a documented limitation, not a gap found by a failing test. |
| `resortInfo`'s publish reuses the exact versioning logic `tests/helpers/factories.ts`'s `publishResortInfo` already implements | Lock the current row, compute `nextVersion = current + 1`, flip `is_current`, insert — the same sequence, now for real, under `FOR UPDATE` to serialise two concurrent publishes of the same key safely. |

## [ASSUMPTION] Reports, audit and the final sweep (2H)

| Decision | Choice and reason |
|---|---|
| A real audit gap found and fixed, not a design choice | Writing AU-4 ("every mutation listed in `00-conventions.md` produces an audit row") surfaced that `core/booking.ts` (booking/payment/refund transitions), `core/enquiry/assignment.ts`'s `assignEnquiry` (manual/claim assignment), the category-correction controller, and the send-reply controller had **never** called `recordAuditEvent` — only `enquiry_events`/table updates. `00-conventions.md`'s audit list explicitly names all of these. Fixed by adding `recordAuditEvent` calls at each site, including inside `core/booking.ts` itself (previously untouched since 1G/1H) — because this is squarely what 2H's own exit criteria ask for, not a drive-by fix to an unrelated finished phase. |
| `assignEnquiry` audits only `reason: 'manual'`/`'claim'`, never `'auto'`/`'employee_disabled'` | The system-driven routing/reassignment paths are already fully traceable through `enquiry_events`; auditing every automatic routing decision would be noise, not oversight, and AU-4's phrase is "enquiry assignment" (a deliberate staff action), not every assignment-shaped write. |
| Working-hours-adjusted elapsed time (`workingMinutesElapsed`) exploits Asia/Kolkata's fixed +5:30 offset | India never observes DST, so shifting a UTC instant by a constant 5.5 hours and reading UTC fields back off the result gives correct IST wall-clock values with no `Intl.DateTimeFormat` overhead or ambiguity. Resolution time (the *other* 2H duration metric) is deliberately plain wall-clock, not working-hours-adjusted — the phase doc's working-hours clause appears only under the first-reply bullet. |
| Metrics' `from`/`to` window applies to each metric's own natural date field | Booking value is filtered by `confirmed_at` (RP-7's explicit requirement); room-nights-sold and allotment utilisation by `stay_date`; first-reply and resolution by the enquiry's own `created_at`/`resolved_at`. One shared window parameter, four different column filters — documented rather than forcing one field to serve double duty. |
| RP-12's "no profit/occupancy/share-target claim" is a structural check, not a word ban | The response's own caveat string explicitly *names* profit, total-resort-occupancy and direct-share as things it does **not** claim — that disclaimer is the correct, required behaviour, not a violation. The test asserts no response *field* carries such a figure, rather than banning the words outright (which would also forbid the disclaimer). |
| `GET /admin/audit`'s cursor id is a JS `number`, not a string | `audit_events.id` is `bigserial`; `src/db.ts`'s existing `BIGINT_OID` type parser already returns bigint columns as JS `number` (with a safe-integer guard) project-wide — the cursor follows that existing convention rather than inventing a string-id special case for this one table. |

## [ASSUMPTION] Phase 3 — frontend guest

| Decision | Choice and reason |
|---|---|
| `POLICY.availability.calendarMaxDays: 62` (3B) | Neither §18 nor `03-decisions.md`/`policy.ts` named a window for a per-date read before this. `POLICY.pagination.maxRangeDays` (366) is the admin list-range figure and would hand a display-only guest read 366 daily rows for one room; 62 is roughly two calendar months, matched to what the frontend's calendar panel actually renders |
| `DATABASE_URL` now answers | Previously unreachable from this machine on every session up to Phase 2 (hence every backend number coming from `TEST_DATABASE_URL`). Phase 3 connected directly (Neon, `ap-southeast-1`) and found it already migrated and seeded — reused as-is. See `08-known-issues.md`'s "Not issues" section for the full correction |
| Room content ported, slug/name/price/capacity kept (3C) | The frontend's original room copy and Unsplash photography (`src/data/rooms.ts`, now deleted) were genuinely better than the seeded filler (`"Garden Suite — a quiet stay among the coffee estate."`, one `picsum.photos` placeholder photo). Ported into `seeds/data/roomContent.ts`, tier-matched by price rank to the seeded slugs rather than by name (the frontend's four rooms and the seeded four don't share names) — `summary`/`description`/`amenities`/`inclusions`/photos only. Slug, `name`, price and capacity are the backend's own and are untouched, so a GM editing a room in the console later edits the same identity a reviewer sees today |
| A content-patch script alongside the full seed (3C) | `seeds/run.ts` refuses to run against a non-empty database — it seeds users/bookings/enquiries too, and a `--force` re-run on the hosted `DATABASE_URL` (already seeded with 13 users, 7 bookings) would have duplicated all of it. `seeds/update-room-content.ts` applies `ROOM_CONTENT` to the existing four room types in place (UPDATE + photo replace per slug, idempotent, verified by running it twice) without touching anything else |
| `wouter` real paths over hash routing | `apps/Frontend/CLAUDE.md` names `wouter` explicitly; real paths are also required for §19's build-time prerendering, which a hash fragment can never participate in (it never reaches the server) |
| Access token in a module-scope variable, refresh token left entirely to the httpOnly cookie | §7: "Do not store long-lived authentication secrets in localStorage." The access token is short-lived (15 min) and memory-only; the frontend never reads, writes or inspects the refresh cookie at all — the browser and the backend handle it exclusively |
| Availability-calendar UI is a native month grid, not an extension of `retro-pill`'s vendored `RangeCalendar` | Covered in full in the Phase 3 plan file (see `progress-log.md`'s 3A entry for the pointer): the vendored calendar hardcodes its own `disabled` predicate and its `components` prop silently clobbers on merge, so extending it costs a fork of verbatim-preserved vendor code; a ~120-line grid costs less and keeps full control of the required per-day text/`aria-label` (§28, nothing conveyed by colour alone) |
| Room-selection screens carry a quantity pill only, no inline adults/children editor | Reverted from an earlier 3D attempt (per-line adults/children steppers on `/book/select` and `/rooms/:slug`) at the user's explicit instruction — occupancy is still collected, just on `/checkout` at quote time, not on the browse screens. Every line still defaults to 1 adult/0 children at `addLine()` |
| `/booking/:bookingId`, not `/booking/:reference` | The confirmation page needs `GET /bookings/:bookingId` for the full §8E breakdown; the only reference-keyed read, `GET /bookings/reference/:reference/status`, returns just `{reference, status, holdExpiresAt}` — no `bookingId`, no amounts, no dates. Using the id in the URL and showing the human `reference` as page content (not as the URL) matches what the API actually supports without inventing a new backend lookup |
| Checkout's sign-in calls the real `/auth/*` endpoints; `/signin` (used elsewhere — the account button, the chat panel) still doesn't | `CheckoutSignIn.tsx` is a from-scratch real OTP flow (register → otp request/verify, email then phone) built because `/checkout`'s "Pay now" is gated by the backend's real `requireVerifiedGuest`, which the old demo-only `SignIn.tsx` can never satisfy. Rewiring `/signin` itself to real auth, and unifying it with `CheckoutSignIn`, is left for a later pass — flagged here so the two parallel "am I signed in" states (the real `session.ts` principal vs. the app's old local `guest` string) aren't mistaken for one system |
| "Why only 4 room types?" — checked, not guessed | The original brief (§1) states **64 rooms and 12 villas, 76 keys** — the only hard number given. The seeded four room types' `physical_stock` sum to exactly that split: `estate-room`(24) + `garden-suite`(16) + `plantation-cottage`(24) = 64 "rooms", `coffee-villa`(12) = the 12 villas. §26 explicitly leaves "room categories/sample rates" as a synthetic, internal decision — Product.md never specifies a count beyond the 64/12 split. Four is deliberate and spec-consistent, not a shortfall |

## Open

- Styling approach for phases 3–4: plain CSS with custom-property tokens (current intent, see
  `apps/Frontend/CLAUDE.md`), not yet exercised.
- Rate-limit buckets per route. `middleware/rateLimit.ts` takes them per call site; the
  per-route numbers are set as each route lands (1D sets the guest OTP/login pair, 2A sets
  employee login — the security-relevant ones). The limiter is in-process and
  single-instance — the ceiling is noted in the file.
- Measured performance numbers. The budgets in `apps/Frontend/CLAUDE.md` are targets; no
  figure gets written here until it has actually been measured on a throttled cold load.

## Hero image: measured, not estimated (2026-11-09)

The home hero shipped one 2000px-wide file to every device. Measured transfer, by requested
width, from `images.unsplash.com`:

| width | quality | transfer |
|---|---|---|
| 640 | 75 | **96 KB** |
| 960 | 75 | 214 KB |
| 1280 | 75 | 381 KB |
| 1920 | 75 | 833 KB |
| 2000 | 80 | **901 KB** — the single file every device used to receive |

With `srcset`/`sizes="100vw"` a phone now takes the 640w variant: **96 KB against 901 KB, 9.4×
less**, which brings the first mobile hero inside the ≈100 KB target in `apps/Frontend/CLAUDE.md`
rather than exceeding it ninefold. The same `photoSrcSet` helper (`src/lib/photoUrl.ts`) covers
`PropertyTour` and `ExploreEstate`, the other two components building Unsplash URLs by hand; the
room catalogue already had real API-supplied variants.

**Still not measured, so still not claimed:** the initial guest JS budget (≈120 KB), above-fold
transfer (≈350 KB) and the throttled cold-cache profile (~1 Mbps / 400 ms RTT with CPU
throttling) that 3G requires. The numbers above are raw asset transfers measured directly, not
a page-level profile. Guest entry JS is currently 469 KB raw / 147 KB gzipped from
`bun run build`, which is a build figure, not a cold-load measurement.
