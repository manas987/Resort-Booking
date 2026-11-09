# Touch map

**Open this before editing anything shared.** It answers one question: *if I change this, what
else must change?* Written because a session implementing one sub-phase cannot see the rest of
the code and will otherwise leave a caller broken.

Keep it current. A new caller of a `core/` function adds a row here in the same commit.

## Core functions → callers

Change the function, check every caller listed.

| Function | Callers |
|---|---|
| `calculateQuote` | `user/quotes` (create) · `user/bookings` (revalidate before hold) · `admin/rates` (preview) · `core/enquiry/processing` (the AI quote block) |
| `taxRateForUnitDay` · `allocateDiscount` | `calculateQuote` only. Pure — test directly |
| `nightsForStay` | `readAvailability` · `createBookingHold` · `admin/inventory` · `admin/blackouts` |
| `readAvailability` | `user/availability` · `user/rooms` (sold-out badges) · `admin/rooms` · `admin/bookingCalendar` |
| `lockRoomDays` + `assertAvailable` | `createBookingHold` · `admin/inventory` (PUT, DELETE) · `admin/blackouts` (PUT) |
| `effectiveAllotment` · `findCommitmentConflicts` | `admin/inventory` · `admin/blackouts` · `admin/rates` (preview) |
| `createBookingHold` | `user/bookings` (POST) only. Reads the quote `FOR UPDATE` and refuses one that already has a live booking (INV-60) — **a new write path to `bookings` must keep `quote_id` set**, or that check stops seeing it |
| `expireBookingHold` | `jobs/handlers/expireHolds` · `confirmMockPayment` (expiry race) |
| `confirmMockPayment` | `jobs/handlers/processPaymentEvent` only |
| `refundLatePayment` | `jobs/handlers/refundLatePayment` only |
| `mintAccessToken` · `verifyAccessToken` | `user/auth` · `admin/auth` · `middleware/userAuth` · `middleware/adminAuth` |
| `loadPrincipal` (added 1D, not in the original contract) | `middleware/userAuth` · `middleware/adminAuth` (2A) · every controller that mints a fresh session · `tests/helpers/factories.ts`'s `createGuest`/`createEmployee` |
| `issueRefreshSession` · `rotateRefreshSession` | `user/auth` (register, otp verify, google callback, refresh) · `admin/auth` (login, google, refresh) |
| `revokeAllSessionsForUser` | `admin/staff` (disable) only |
| `routeEnquiry` | `user/enquiries` (create) · `user/eventEnquiries` · `jobs/handlers/classifyEnquiry` · `admin/enquiries` (category correction re-routes) |
| `assignEnquiry` | `routeEnquiry` callers · `admin/enquiryAssignment` (assign, claim) · `reassignOnEmployeeDisable` |
| `reassignOnEmployeeDisable` | `admin/staff` (disable) only |
| `notifyComplaintAlert` | `admin/enquiries` (category correction, 2C) · `jobs/handlers/classifyEnquiry` (2D) — whichever caller of `routeEnquiry` sees `notifyGm: true` |
| `applyGuestReply` | `user/enquiryMessages` only |
| `processEnquiry` | `jobs/handlers/classifyEnquiry` · `jobs/handlers/draftEnquiryReply` · `admin/enquiryDrafts` (retry) |
| `recordAuditEvent` | every `admin/*` mutation · `admin/exports` · `core/booking` (payment and refund transitions) |
| `enqueueJob` | `createBookingHold` · `user/payments` · `user/enquiries` · `user/eventEnquiries` · `admin/staff` (disable) · `admin/enquiryMessages` (send reply) · `admin/enquiryDrafts` · `core/booking` |
| `claimJobs` · `completeJob` · `failJob` | `jobs/worker` only |
| `beginPaymentAttempt` | `user/payments` only |
| `generateEnquiryRef` (added 1I, documented in the end-of-backend review) | `user/enquiries` · `user/eventEnquiries` · `system/mock` (both simulated channels) — all four enquiry-creating paths, each wrapping its insert in `withSavepoint` |
| `withSavepoint` (`src/db.ts`, added by the end-of-backend review) | `createBookingHold` · `user/enquiries` · `user/eventEnquiries` · `system/mock` — every retry-on-collision loop. **Any new `catch` around a statement inside a transaction needs it**, or the transaction is left aborted (RB-7) |
| `buildClassifyUserPrompt` · `buildDraftUserPrompt` | `core/enquiry/processing` only. Nothing else assembles model input — the data selection is the AI boundary (INV-21) |
| `deliverMessage` | `jobs/handlers/sendMessage` only |
| `generateStructured` | `core/enquiry/processing` only — **nothing else may call the provider** |
| `withTransaction` | every mutating controller and every core workflow that owns a transaction |
| `POLICY` (`core/policy.ts`) | every Zod schema with a bound · `calculateQuote` · `createBookingHold` · `nightsForStay` · `jobs/worker` · `user/auth/otp.ts` · every paginated list · the tests. **Change a number here and it changes everywhere — that is the point** (INV-59) |
| `nightKey` | `readAvailability` · `assertAvailable` · `createBookingHold` · `findCommitmentConflicts` · `admin/bookingCalendar` — never build the string inline |
| `generateReference` | `createBookingHold` only |
| `previewToken` | `admin/rates` · `admin/inventory` · `admin/blackouts` — preview and apply, both (INV-57) |
| `snapshotRoomDayState` (added 2F, not in the original sketch) | `admin/rates` · `admin/inventory` · `admin/blackouts` — the exact `previewToken` input, one raw `room_day` override row per touched night, a non-existent row materialised as "no override" |
| `badRequest` (`middleware/errors.ts`) | every controller's `safeParse` failure path, both trees |
| `ErrorCode` + `STATUS` (`middleware/errors.ts`) | a new code needs its row in `00-conventions.md`'s status table in the same change, or the frontend has nothing to branch on. Last added: `quote_already_booked` (409) |

## Tables → files that touch them

| Table | Written by | Read by |
|---|---|---|
| `users` | `user/auth` · `user/account` · `admin/staff` | both auth middlewares · `routeEnquiry` · `admin/enquiryAssignment` · `admin/reports` |
| `sessions` | `core/tokens` · `admin/staff` (disable) | both auth middlewares |
| `otp_challenges` | `user/auth/otp.ts` | `user/auth` |
| `tax_config` | migration + seeds only | `calculateQuote` |
| `room_types` | seeds · `admin/rates` (base price) · `admin/inventory` (base allotment) | `user/rooms` · `user/availability` · `calculateQuote` · `admin/rooms` · `processEnquiry` |
| `room_photos` | seeds only | `user/rooms` · `admin/rooms` |
| **`room_day`** | `admin/rates` · `admin/inventory` · `admin/blackouts` · `lockRoomDays` (materialise) | `calculateQuote` · `readAvailability` · `assertAvailable` · `admin/rooms` |
| `quotes` | `user/quotes` · `createBookingHold` (the `price_changed` re-quote, written on its own connection **after** the hold transaction rolls back) | `createBookingHold` (locked `FOR UPDATE`, single-use per INV-60) |
| `bookings` | `createBookingHold` · `confirmMockPayment` · `expireBookingHold` | `user/bookings` · `admin/bookings` · `admin/exports` · `admin/reports` · `processEnquiry` (linked booking only) |
| `booking_rooms` · `booking_nights` | `createBookingHold` only | `assertAvailable` · `user/bookings` · `admin/bookings` · `admin/bookingCalendar` · `admin/exports` · `admin/reports` · `findCommitmentConflicts` |
| `payments` · `payment_events` | `beginPaymentAttempt` · `confirmMockPayment` | `user/bookings` · `admin/bookings` |
| `refunds` | `refundLatePayment` only | `user/bookings` · `admin/bookings` |
| `idempotency_keys` | `middleware/idempotency` only | `middleware/idempotency` |
| `promo_codes` | `admin/promos` | `calculateQuote` · `user/promos` · `createBookingHold` |
| `promo_redemptions` | `createBookingHold` · `expireBookingHold` · `confirmMockPayment` | `admin/promos` (redemptions) |
| `enquiries` | `user/enquiries` · `user/eventEnquiries` · `admin/enquiries` · `assignEnquiry` · `applyGuestReply` · `processEnquiry` | `user/enquiries` · `admin/enquiries` · `admin/reports` |
| `enquiry_messages` | `user/enquiryMessages` · `admin/enquiryMessages` · `deliverMessage` | both enquiry detail routes · `processEnquiry` (guest-visible only) |
| `enquiry_events` | `assignEnquiry` · `admin/enquiries` · `admin/enquiryMessages` (reply_sent) · `applyGuestReply` · `processEnquiry` | `admin/enquiries` (detail) |
| `enquiry_reads` | `admin/enquiries` (read) | `admin/enquiries` (list, counts) |
| `ai_runs` · `ai_drafts` | `processEnquiry` · `admin/enquiryDrafts` · `admin/enquiryMessages` (send marks sent) | `admin/enquiries` (detail) · `admin/reports` |
| `resort_info` | `admin/resortInfo` | `user/content` · `processEnquiry` |
| `jobs` | `enqueueJob` · `jobs/worker` | `jobs/worker` · `admin/notifications` (failure surfacing) |
| `notifications` | `notifyComplaintAlert` (called by `routeEnquiry`'s callers, never `routeEnquiry` itself — it has no `enquiryId`) · `processEnquiry` · `refundLatePayment` | `admin/notifications` |
| `audit_events` | `recordAuditEvent` only — **append-only, INV-14** | `admin/audit` (owner) · `admin/rates/history` (scoped projection, INV-39) |
| `analytics_events` | `user/analytics` | `admin/reports` (funnel) |

## Change-together rules

Each of these has broken a project before. Treat as a checklist.

| If you change… | Also change… | Why |
|---|---|---|
| The availability expression (confirmed + live holds) | `assertAvailable`, `readAvailability`, `findCommitmentConflicts` | Three places read commitment counts. If the guest-facing read and the admin validation disagree, admin lets allotment drop below commitments — INV-9 |
| `calculateQuote`'s output shape | `user/quotes` response, `createBookingHold` revalidation, `admin/rates` preview, the AI quote block, `pricing.snapshot` test | Four callers. The AI one is the easiest to forget and the one that invents prices if it drifts — INV-45 |
| GST rates, threshold or bracketing | **Add a new `tax_config` row; never edit an existing one.** Then `pricing.gst` test | Sold bookings reference their version. Editing in place rewrites history — INV-28 |
| Booking status values or transitions | `bookings` CHECK constraint, `confirmMockPayment`, `expireBookingHold`, `user/bookings`, `admin/bookings`, `admin/reports` | The CHECK and the code must agree or inserts fail at runtime, not at typecheck |
| `room_day` columns | `lockRoomDays` materialisation, `calculateQuote`, `readAvailability`, `admin/rates`, `admin/inventory`, `admin/blackouts`, `01-data-model.md` | It is both the override row and the lock row; six things read it |
| Any `core/` signature | `04-contracts.md` **in the same commit**, plus every caller in the table above | A caller written against a stale signature is the main failure mode this doc exists to prevent |
| Adding a cursor to `admin/notifications` or `admin/rates/history` | A new `schema.ts` for notifications (it has none), `11-phase2-backend-staff.md` (2B, 2F), `04-contracts.md`, **the row in `08-known-issues.md` — deleted, not edited**, and any console code already reading the flat `items` array | These two are the registered pagination violations (KI-1, KI-2). Their response shape changes from `{items}` to `{items, nextCursor}`, so doing it before Phase 3 costs one change instead of two |
| A route path | `10-phase1-*.md` or `11-phase2-*.md`, the tree's `router.ts`, `apps/Backend/README.md` endpoint map | The docs are the only route inventory |
| A `users` role or team value | `users` CHECK constraints, `02-permissions.md`, both auth middlewares, `routeEnquiry`, `admin/staff` | Permission logic is spread across guards and routing |
| An error code | `00-conventions.md` table, `middleware/errors.ts` `STATUS` map | The map is exhaustive by type; a missing entry is a typecheck error, a wrong status is silent |
| A number in `core/policy.ts` | the `03-decisions.md` policy table, in the same edit | The doc is what a reviewer reads; the object is what runs. Drift between them is a lie in the TDD |
| `response.locals` | `src/types/express.d.ts`, the writing middleware, every reading controller | It is the only trusted request state. An untyped extra field is how a controller starts trusting the body |
| Enquiry status or category values | `enquiries` CHECKs, `routeEnquiry`, `applyGuestReply`, `admin/enquiries` filters, `admin/enquiries/counts` lanes, `responseSchemas.ts` | The AI schema and the database enum must match or every classification fails validation |
| Something a GM can edit that the AI quotes | `resort_info` version handling and `processEnquiry`'s knowledge version recording | A stale knowledge version makes an AI run untraceable — INV-49 |
| Adding a job type | `JobType` union, `jobs/handlers/`, the worker's handler map, `jobs.recovery` test | An enqueued type with no handler retries until it fails, silently |

## Things with exactly one writer — keep it that way

Concentrating writes is what makes the invariants checkable. These must not grow a second
writer without a deliberate decision:

`booking_rooms` and `booking_nights` ← only `createBookingHold` ·
`refunds` ← only `refundLatePayment` ·
`idempotency_keys` ← only `middleware/idempotency` ·
`audit_events` ← only `recordAuditEvent` ·
the provider call ← only `generateStructured`, called only by `processEnquiry`.
