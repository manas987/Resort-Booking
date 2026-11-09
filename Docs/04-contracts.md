# Contracts

9 Nov auth revision: Principal includes optional onboardingComplete, reloaded from the
database by middleware. New guests cannot book until this is true as well as both contact
verification flags. /auth/me additionally returns needsOnboarding and the caller's own
profile (name/email/phone). Email guest_login OTP verification may create a provisional
guest after valid proof; no account-existence result is returned before verification.

**Call these from the signatures written here, not from memory.** If a signature changes, this
file changes in the same commit. A caller written against a stale signature is the most likely
way this project breaks.

Conventions: money is integer paise, stay dates are `YYYY-MM-DD` strings, timestamps are ISO
strings. See `00-conventions.md`. Invariants referenced as `INV-n` are in `05-invariants.md`.

## Shared types

```ts
// src/db.ts
export type Tx = Pick<PoolClient, 'query'>;

// A night of one room, the unit everything inventory-related is counted in.
export type NightRef = { roomTypeId: string; stayDate: string };

// One room being sold, with its own occupancy.
export type RoomSelection = { roomTypeId: string; adults: number; children: number };

export type StayRange = { checkIn: string; checkOut: string };   // checkout exclusive
```

## src/db.ts

```ts
export const pool: Pool;

/** BEGIN → body → COMMIT. ROLLBACK and rethrow on error, preserving the original.
 *  Releases the client on every path. The caller owns the transaction. */
export function withTransaction<T>(body: (client: Tx) => Promise<T>): Promise<T>;

/** SAVEPOINT → body → RELEASE, or ROLLBACK TO SAVEPOINT and rethrow. Needed wherever a
 *  caller means to CATCH a statement error inside a transaction: in Postgres any failed
 *  statement aborts the whole transaction, so a retry-on-collision loop (see "reference
 *  generation" below) cannot recover without this — the retry would fail `25P02`. Proved by
 *  RB-7. The savepoint name is generated internally from hex and never from a request. */
export function withSavepoint<T>(client: Tx, body: () => Promise<T>): Promise<T>;

export const PG: {
  UNIQUE_VIOLATION: '23505'; FOREIGN_KEY_VIOLATION: '23503'; CHECK_VIOLATION: '23514';
  SERIALIZATION_FAILURE: '40001'; DEADLOCK_DETECTED: '40P01'; LOCK_NOT_AVAILABLE: '55P03';
};
export function isPgError(err: unknown, code: string): boolean;
export function closePool(): Promise<void>;
```

## src/env.ts

```ts
export const env: {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  DATABASE_URL: string; TEST_DATABASE_URL?: string;
  APP_ORIGIN: string; API_PUBLIC_ORIGIN: string;      // no trailing slash
  JWT_SECRET: string;
  GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string;
  GEMINI_API_KEY?: string; GEMINI_MODEL: string;
  DEMO_MODE: boolean;
};
export const features: { googleSignIn: boolean; ai: boolean };
export const isProduction: boolean;

/** Derived, never configured: `${API_PUBLIC_ORIGIN}/api/user/auth/google/callback`.
 *  1D's callback route MUST live at exactly that path, or Google's exact-match check fails.
 *  Do not reintroduce a GOOGLE_REDIRECT_URI variable — two copies can only disagree. */
export const googleRedirectUri: string;
```

## core/pricing.ts

```ts
export type QuoteLineNight = {
  roomTypeId: string; stayDate: string;
  pricePaise: number;        // effective rate for that room type on that date
  discountPaise: number;     // this night's share of the promo discount
  taxablePaise: number;      // pricePaise - discountPaise
  taxRateBps: number;        // 500 or 1800, decided per unit-day on taxablePaise
  taxPaise: number;
};

export type QuoteResult = {
  nights: QuoteLineNight[];
  roomPaise: number; discountPaise: number; taxPaise: number; totalPaise: number;
  taxConfigVersion: number;
  termsVersion: number;
};

/** The current `tax_config` row, read inside `calculateQuote`. Filled in at 1B — referenced
 *  but not shaped until now. */
export type TaxConfig = { version: number; thresholdPaise: number; lowRateBps: number; highRateBps: number };

/** The ONLY place a stay amount is computed. Reads effective rates and tax config, applies the
 *  promo, allocates the discount (INV-5), brackets GST per room-night (INV-4).
 *  Throws AppError('validation_failed') on occupancy breach, AppError('internal_error') if tax
 *  config is missing or fails its sanity check — never silently zero tax (INV-6). */
export function calculateQuote(client: Tx, input: {
  stay: StayRange;
  rooms: RoomSelection[];
  promoCode?: string;
}): Promise<QuoteResult>;

/** Per-unit-day bracket. Pure. taxablePaise <= threshold → low bps, else high bps. */
export function taxRateForUnitDay(taxablePaise: number, config: TaxConfig): number;

/** Spreads `discountPaise` across nights in proportion to price, floored, remainder to the
 *  highest-priced night so the parts sum EXACTLY to the input. Pure. */
export function allocateDiscount(
  nightPrices: number[], discountPaise: number,
): number[];
```

`calculateQuote` is called by: `user/quotes`, `user/bookings` (revalidation),
`admin/rates` preview, `core/enquiry/processing` (the AI quote block). Change it and check all
four — see `06-touch-map.md`.

## core/inventory.ts

```ts
export type Availability = {
  roomTypeId: string; stayDate: string;
  allotment: number;      // effective, after override / stock cap / blackout
  committed: number;      // confirmed + live holds
  remaining: number;      // allotment - committed, floored at 0
  isBlackout: boolean;
};

/** Expands a stay into its nights. Check-in inclusive, checkout exclusive (INV-2). */
export function nightsForStay(stay: StayRange, roomTypeIds: string[]): NightRef[];

/** Read-only availability. No locks. For display only — never authorises a booking (INV-1). */
export function readAvailability(client: Tx, input: {
  stay: StayRange; roomTypeIds?: string[];
}): Promise<Availability[]>;

/** Materialises room_day rows, then SELECT ... FOR UPDATE ordered by
 *  (room_type_id, stay_date). Fixed order prevents deadlock (INV-3).
 *  MUST be called inside withTransaction, before assertAvailable. */
export function lockRoomDays(client: Tx, nights: NightRef[]): Promise<void>;

/** Rechecks AFTER locks are held. Counts confirmed + live holds from booking_nights.
 *  Throws AppError('availability_conflict', ..., { conflicts: NightRef[] }) naming every
 *  night that failed. Never partially succeeds (INV-1). */
export function assertAvailable(client: Tx, input: {
  nights: NightRef[]; requestedPerNight: Map<string, number>;
}): Promise<void>;

/** Effective allotment for admin validation: blackout → 0, else
 *  least(override ?? base, physical_stock). */
export function effectiveAllotment(client: Tx, night: NightRef): Promise<number>;

/** Used by admin writes: would this allotment leave existing commitments unhonoured?
 *  Returns the offending nights so the error can name every conflicting date (INV-9). */
export function findCommitmentConflicts(client: Tx, input: {
  roomTypeId: string; from: string; to: string; proposedAllotment: number | null;
  blackout?: boolean;
}): Promise<NightRef[]>;

/** Added 2F, not in the original sketch above: the raw `room_day` override state for a set
 *  of nights — a non-existent row materialised as "no override". This, not the *effective*
 *  merged-with-base value, is what `previewToken` hashes (06-touch-map.md). */
export function snapshotRoomDayState(client: Tx, nights: NightRef[]): Promise<Array<{
  roomTypeId: string; stayDate: string; pricePaise: number | null; allotment: number | null; isBlackout: boolean;
}>>;
```

## core/booking.ts

```ts
export type HoldResult = { bookingId: string; reference: string; holdExpiresAt: string };

/** quote → atomic hold. Owns its transaction. Sequence (INV-1, INV-7):
 *  validate quote (exists, unexpired, same guest, amounts unchanged)
 *  → lockRoomDays → assertAvailable → lock promo row + reserve capacity (INV-8)
 *  → insert bookings + booking_rooms + booking_nights + promo_redemption
 *  → enqueue expire_holds job → COMMIT.
 *  Throws availability_conflict / quote_expired / quote_already_booked / promo_exhausted /
 *  price_changed.
 *  A quote is single-use: the row is taken `FOR UPDATE` and refused if it already has a live
 *  booking (confirmed, or a hold that has not lapsed), so one quote can never become two.
 *  `price_changed` writes its fresh quote on its OWN connection, after the hold transaction
 *  has rolled back — the deliberate exception to "no pool.query mid-transaction", because a
 *  quote written inside that transaction is rolled back with it and the 422 would name a
 *  quote that does not exist. */
export function createBookingHold(input: {
  quoteId: string; actorUserId: string; idempotencyKey: string;
  guestName: string; guestEmail: string; guestPhone: string;
}): Promise<HoldResult>;

/** pending_payment + lapsed hold → expired. Releases promo capacity. Idempotent: safe to run
 *  twice, and inventory was already free the moment the hold lapsed (INV-10). */
export function expireBookingHold(bookingId: string): Promise<void>;

/** Processes one ledger event. Keyed on payment_events.event_key — a redelivered event is a
 *  no-op, never a second confirmation (INV-11).
 *  Live hold + success → confirmed. Released booking + success → stays expired and enqueues
 *  refundLatePayment. Never revives or rebooks (INV-12). */
export function confirmMockPayment(input: {
  paymentId: string; eventKey: string; eventType: 'succeeded' | 'failed' | 'late_success';
}): Promise<void>;

/** One refund and one apology per payment, ever. dedupe_key = paymentId, backed by
 *  UNIQUE (payment_id, reason) (INV-13). */
export function refundLatePayment(paymentId: string): Promise<void>;
```

## core/tokens.ts

```ts
export type Principal = {
  userId: string;
  kind: 'guest' | 'employee';
  role: 'guest' | 'staff' | 'gm' | 'owner';
  team: 'reservations' | 'sales' | null;
  emailVerified: boolean; phoneVerified: boolean;
};

/** HS256, fixed algorithm, issuer and audience set and checked. ~15 min. */
export function mintAccessToken(principal: Principal): Promise<string>;

/** Verifies algorithm, issuer, audience and expiry. Returns null on any failure — callers
 *  must not distinguish reasons to the client. Does NOT check is_active; middleware does
 *  that against the database on every request (INV-15). */
export function verifyAccessToken(token: string): Promise<Principal | null>;

/** Added 1D, not in the original sketch above: the fresh database read `verifyAccessToken`
 *  deliberately does not do. Returns null if the user is missing or `is_active = false`
 *  (INV-15). Every auth middleware calls this on every request — never just `verifyAccessToken`
 *  alone. */
export function loadPrincipal(userId: string): Promise<Principal | null>;

/** Opaque random value returned once to the caller; only its hash is stored. */
export function issueRefreshSession(input: {
  userId: string; userAgent?: string; ipHash?: string;
}): Promise<{ token: string; expiresAt: string }>;

/** Rotates. Reuse of an already-rotated token revokes the whole chain and returns null
 *  (INV-16). */
export function rotateRefreshSession(token: string): Promise<{ token: string; expiresAt: string; principal: Principal } | null>;

export function revokeSession(token: string, reason: 'logout'): Promise<void>;
/** Called when an employee is disabled — kills every live session (INV-15). */
export function revokeAllSessionsForUser(
  client: Tx, userId: string, reason: 'employee_disabled',
): Promise<void>;
```

## core/enquiry/assignment.ts

```ts
export type Category = 'room' | 'wedding' | 'offsite' | 'complaint';

/** Backend routing rule. NOT the model's decision — the model only suggests a category.
 *  room → reservations · wedding/offsite → sales · complaint → GM alert ALWAYS, regardless
 *  of confidence (INV-18) · no configured active assignee → null, i.e. Unassigned. */
export function routeEnquiry(client: Tx, input: {
  category: Category | null; needsReview: boolean;
}): Promise<{ assigneeId: string | null; notifyGm: boolean }>;

/** `ENQ-` + 8 upper-case chars from a UUID. Non-sequential, so one guest cannot guess
 *  another's (the same rule as `generateReference`). Lives here rather than in a route folder
 *  because all four enquiry-creating routes need it — website, event form, and both simulated
 *  inbound channels. Retried against the UNIQUE index inside a `withSavepoint`. */
export function generateEnquiryRef(): string;

export function assignEnquiry(client: Tx, input: {
  enquiryId: string; assigneeId: string | null; actorUserId: string;
  reason: 'auto' | 'manual' | 'claim' | 'employee_disabled';
}): Promise<void>;

/** Moves a disabled employee's UNRESOLVED enquiries to Unassigned, preserving category,
 *  status, messages and history. Resolved threads keep their attribution (INV-17). */
export function reassignOnEmployeeDisable(client: Tx, input: {
  targetUserId: string; actorUserId: string;
}): Promise<{ movedEnquiryIds: string[] }>;

/** Guest reply transitions. awaiting_guest|resolved → in_progress. Keeps the assignee if
 *  still active, else Unassigned (INV-19). */
export function applyGuestReply(client: Tx, enquiryId: string): Promise<void>;

/** Added 2C, not in the original sketch above: `routeEnquiry`'s `notifyGm` flag has no
 *  `enquiryId` to act on, so the caller that just routed the enquiry calls this with the id
 *  it already holds. One `complaint_alert` notification row per active GM/owner (INV-18). */
export function notifyComplaintAlert(client: Tx, input: { enquiryId: string; publicRef: string }): Promise<void>;
```

## core/enquiry/processing.ts

```ts
export type ProcessOutcome =
  | { status: 'ok'; category: Category; confidence: number; draftId: string }
  | { status: 'needs_review'; reason: 'low_confidence' | 'semantic_invalid' | 'schema_invalid' }
  | { status: 'failed'; reason: 'timeout' | 'provider_error' };

/** The bounded pipeline. NEVER inside a transaction (INV-20).
 *  1 classify+extract  2 Zod parse  3 semantic validation  4 routeEnquiry
 *  5 assemble approved facts + backend quote block  6 draft  7 reject invented prices.
 *  Writes ai_runs for every attempt and at most one pending ai_draft.
 *  Context is ONLY: guest-visible messages, current resort_info, backend-computed prices,
 *  and the booking the backend verified is linked to this thread (INV-21, INV-22). */
export function processEnquiry(enquiryId: string): Promise<ProcessOutcome>;
```

## core/audit.ts

```ts
/** Append-only. Takes the transaction's client so the audit row commits with the change it
 *  records (INV-14). Never receives a password, OTP or token. */
export function recordAuditEvent(client: Tx, input: {
  actorUserId: string | null; actorRole: string | null;
  action: string;                  // 'rate.update' | 'allotment.update' | 'blackout.set'
                                   // | 'promo.create' | 'employee.disable' | 'export.bookings' …
  targetKind: string; targetId?: string;
  before?: unknown; after?: unknown; requestId?: string;
}): Promise<void>;
```

## core/jobs.ts

```ts
export type JobType =
  | 'expire_holds' | 'process_payment_event' | 'refund_late_payment'
  | 'send_message' | 'classify_enquiry' | 'draft_enquiry_reply';

/** Takes the client so the job is persisted in the business transaction and only becomes
 *  visible after it commits (INV-23). dedupeKey makes a job at-most-once. */
export function enqueueJob(client: Tx, input: {
  type: JobType; payload: Record<string, unknown>;
  runAfter?: string; dedupeKey?: string; maxAttempts?: number;
}): Promise<void>;

/** FOR UPDATE SKIP LOCKED. Also reclaims work whose locked_at is older than the stale
 *  threshold, so a crashed worker's jobs are picked up (INV-24). */
export function claimJobs(input: { workerId: string; limit: number }): Promise<Job[]>;

export function completeJob(jobId: string): Promise<void>;
/** Bounded retries with backoff; past maxAttempts sets failed_at so it surfaces to staff. */
export function failJob(jobId: string, error: string): Promise<void>;
```

## adapters/mockPayments.ts

```ts
export type MockOutcome = 'succeed' | 'decline' | 'succeed_late';

/** Creates the payment attempt row and the ledger events the server will process.
 *  `outcome` is honoured ONLY when env.DEMO_MODE is true; otherwise it is ignored and
 *  'succeed' is used (INV-25). The browser never decides a booking is paid. */
export function beginPaymentAttempt(client: Tx, input: {
  bookingId: string; amountPaise: number; outcome?: MockOutcome;
}): Promise<{ paymentId: string; providerRef: string }>;
```

## adapters/messaging.ts

```ts
/** Simulated delivery. Records sent/failed on the message row. A failed delivery is NOT a
 *  reply and must never count as one in metrics (INV-26). */
export function deliverMessage(input: {
  messageId: string; channel: 'website' | 'email' | 'whatsapp';
}): Promise<{ status: 'sent' | 'failed'; error?: string }>;
```

## adapters/ai/gemini.ts

```ts
/** The ONLY file that talks to the provider. Swapping vendors is a change here and nowhere
 *  else — see Docs/03-decisions.md for why this is Gemini and not Claude.
 *  Bounded timeout and retries. Returns raw text for the caller to parse and validate;
 *  it does not interpret, and it has no tools, no write access and no SQL. */
export function generateStructured(input: {
  promptVersion: string; system: string; user: string;
  responseSchema: Record<string, unknown>;   // JSON Schema for responseJsonSchema
  timeoutMs?: number;
}): Promise<{ text: string; model: string; latencyMs: number;
              inputTokens?: number; outputTokens?: number }>;
```

## adapters/ai/prompts.ts

```ts
/** Versioned prompt text, kept out of `gemini.ts` so the provider adapter stays mechanical
 *  and a prompt change is reviewable on its own. The version is recorded on every `ai_runs`
 *  row (INV-49). Only `processEnquiry` calls these — nothing else assembles
 *  model input, because the data selection IS the AI boundary (INV-21, INV-44). */
export const CLASSIFY_PROMPT_VERSION: string;   // 'classify-v1'
export const DRAFT_PROMPT_VERSION: string;      // 'draft-v1'
export const CLASSIFY_SYSTEM_PROMPT: string;
export const DRAFT_SYSTEM_PROMPT: string;

export function buildClassifyUserPrompt(input: { message: string }): string;

export function buildDraftUserPrompt(input: {
  thread: string[];                  // guest-visible messages only, oldest first
  resortInfo: string;                // current approved facts, already rendered
  quoteBlock: string | null;         // rendered by calculateQuote, or null
  extractedNotes: string | null;
}): string;
```

Both take only what INV-21 permits: the **guest-visible** thread, current approved
`resort_info`, and a quote block the backend rendered itself. Internal notes and any other
guest's data cannot reach them, because the caller never selects them.

## src/core/policy.ts

Every business limit, in one frozen object. **Built in 1A, already on disk.** Validators, core
functions, the worker and the tests all import from here. A limit written as a literal in a Zod
schema and again in a core function is how the two drift.

```ts
export const POLICY: {
  timezone: 'Asia/Kolkata';
  stay: { maxRoomsPerBooking: 4; maxNightsPerBooking: 14; bookingHorizonDays: 365;
          minAdultsPerRoom: 1 };
  expiry: { quoteMinutes: 5; paymentHoldMinutes: 10; accessTokenMinutes: 15;
            refreshSessionDays: 7 };
  otp: { digits: 6; expiryMinutes: 5; maxAttempts: 5; resendCooldownSeconds: 60 };
  pagination: { defaultLimit: 25; maxLimit: 100; maxRangeDays: 366 };
  bodyLimitBytes: number;
  jobs: { defaultMaxAttempts: 5; staleLockSeconds: 300; claimBatchSize: 10;
          pollIntervalMs: 2000 };
  ai: { timeoutMs: 20000; maxAttempts: 2; minConfidence: 0.6 };
};
```

**Never hardcode any of these numbers anywhere else.** If a value needs to change, change it
here and in the `03-decisions.md` policy table in the same edit.

## response.locals — the only trusted request state

Typed in `src/types/express.d.ts`, **built in 1A**. Middleware writes it; controllers read it.

```ts
interface Locals {
  requestId: string;          // middleware/requestId, every request
  principal?: Principal;      // middleware/userAuth or adminAuth; absent on public routes
  idempotencyKey?: string;    // middleware/idempotency, on routes that require one
}
```

`request.user` **does not exist in this project**. One location, one spelling. A controller that
reads a user id, role, email or amount from `request.body`, `request.query` or a header is
wrong — INV-7, INV-35.

## Middleware — exact export names

One canonical name per guard. `02-permissions.md` describes *who passes*; this is what the
function is *called*. Do not invent a second spelling.

| File | Exports | Sub-phase |
|---|---|---|
| `middleware/requestId.ts` | `requestId` | 1A ✓ |
| `middleware/errors.ts` | `AppError`, `ErrorCode`, `notFound`, `forbidden`, `unauthenticated`, `badRequest`, `notFoundHandler`, `errorHandler` | 1A ✓, `badRequest` 1D ✓ |
| `middleware/cors.ts` | `cors` | 1A ✓ |
| `middleware/rateLimit.ts` | `rateLimit(options)`, `resetRateLimits()` | 1A ✓ |
| `middleware/userAuth.ts` | `requireGuest`, `requireVerifiedGuest`, `optionalGuest` | 1D ✓ |
| `middleware/idempotency.ts` | `requireIdempotencyKey` | 1G |
| `middleware/demoOnly.ts` | `demoOnly` | 1H |
| `middleware/adminAuth.ts` | `requireEmployee`, `requireGm`, `requireOwner`, `requireExporter` | 2A ✓ |

`assignedOrAbove` and `ownsRecord` are **not** middleware. They need the record, so they are a
check inside the controller after the row is loaded — one named helper per feature folder.
Writing them as middleware would mean loading the row twice.

`optionalGuest` populates `response.locals.principal` when a valid token is present and passes
through when it is not. Used by `user/quotes` and `user/availability`, which price for signed-out
visitors but must stamp the guest when there is one.

```ts
/** Turns a Zod failure into the standard 400. The ONLY place a ZodError becomes a response,
 *  so `details.issues` has one shape everywhere. Both trees use it — it is cross-cutting
 *  middleware, not route code, so this is not a share-nothing breach. */
export function badRequest(error: ZodError): AppError;
```

## src/core/inventory.ts — the night key

`assertAvailable` takes `requestedPerNight: Map<string, number>`. The key is **not** free-form:

```ts
/** The canonical key for a (room type, date) pair. Used for every Map, Set and lookup that
 *  is keyed by night. Never build this string inline. */
export function nightKey(roomTypeId: string, stayDate: string): string;   // `${roomTypeId}|${stayDate}`
```

The **value is a room count, not a booking count.** Two Estate Rooms on one night means
`requestedPerNight.get(nightKey(estate, date)) === 2`. A booking that lists the same room type
twice sums; it does not overwrite. `createBookingHold` builds this map by iterating
`quote.lines` — one entry per room sold — not by iterating distinct room types.

## src/core/booking.ts — reference generation

```ts
/** Guest-facing booking reference. Format: `BK-` + 8 chars from `23456789ABCDEFGHJKMNPQRSTVWXYZ`
 *  (no 0/O, 1/I/L, U/V confusion) — unambiguous when read aloud over a phone.
 *  Random, NOT sequential: a sequential reference lets one guest guess another's (GI-2).
 *  Called inside createBookingHold's transaction. `bookings.reference` is UNIQUE, so on a
 *  unique violation retry up to 5 times, then fail with internal_error. **The insert must be
 *  wrapped in `withSavepoint`** — without it the caught violation leaves the transaction
 *  aborted and the retry cannot succeed (RB-7). */
export function generateReference(): string;
```

The same shape serves `enquiries.public_ref` — `generateEnquiryRef` in
`core/enquiry/assignment.ts`, `ENQ-` + 8 chars from the same non-sequential rule, retried
against its UNIQUE index inside the same `withSavepoint`. The three supplied fixtures
(`ENQ-4410/4411/4412`) are seeded literals, not generated — do not make the generator reproduce
them.

## Where `terms_version` comes from

`bookings.terms_version` is `NOT NULL` and must be the version the guest was **shown**, not
whatever is current when they pay.

- `quotes.terms_version` (column added in 1A) stores it at pricing time.
- `calculateQuote` reads it from `resort_info` where `key = 'booking_terms' AND is_current`.
- **No current `booking_terms` row is a loud failure**, exactly like missing `tax_config`
  (INV-6) — never a silent `0`. Seeds must publish one (1J).
- `createBookingHold` copies `quotes.terms_version` onto the booking. It does **not** re-read
  `resort_info` (INV-58).

## middleware/idempotency.ts — the decision table

Built in 1G. Required on `POST /api/user/bookings` and `POST /api/user/payments/:bookingId/attempts`.

```ts
/** Reads `Idempotency-Key`, which must be a UUIDv4, and sets response.locals.idempotencyKey.
 *  Replays a completed call; refuses a reused key with a different body. */
export function requireIdempotencyKey(endpoint: string): RequestHandler;
```

Before the controller runs, `INSERT ... ON CONFLICT (key) DO NOTHING` a row with
`(key, user_id, endpoint, sha256(canonical body), status 'in_flight')`, then branch on what is
actually in the table:

| State found | Response |
|---|---|
| Insert succeeded (no prior row) | Run the controller |
| `completed`, same endpoint **and** same `request_hash` | Replay `response_code` + `response_body`. **Do not run the controller** (INV-30) |
| Any state, different `request_hash` or endpoint | `409 idempotency_key_reused` |
| `in_flight`, same hash | `409` — the first call is still running. The client retries and then sees the replay (ID-3) |

Capture the response by wrapping `response.json` **once**, in this middleware, and on a 2xx
writing `(response_code, response_body, booking_id, completed_at, status='completed')`. On a
non-2xx, **delete the row** so the client can legitimately retry a failure with the same key.

A `request_hash` is `sha256` of the body serialised with sorted keys — otherwise an identical
body with reordered fields reads as a different request.

## Admin range edits — the preview token

2F must "show what will be replaced and require confirmation" and must not let a concurrent
admin silently overwrite a newer edit. The mechanism, so it is not invented three times:

```ts
/** Hash of the current state of every room_day row a range edit would touch. Returned by
 *  POST /preview, required by the matching PUT/DELETE. */
export function previewToken(rows: Array<{
  roomTypeId: string; stayDate: string;
  pricePaise: number | null; allotment: number | null; isBlackout: boolean;
}>): string;
```

`POST /preview` returns `{ affected: [...], conflicts: NightRef[], previewToken }`. The `PUT` or
`DELETE` requires that token, recomputes it **inside the transaction after taking the locks**,
and returns `409 stale_write` if it differs. One mechanism, three features (`rates`,
`inventory`, `blackouts`) — INV-57.

## Response shapes

```ts
// Every non-2xx, without exception — see 00-conventions.md
type ErrorResponse = { error: {
  code: string; message: string; details?: unknown; requestId: string;
} };

// Every paginated list
type Page<T> = { items: T[]; nextCursor: string | null };
```

## Rules for changing this file

1. A signature change here and the implementation change go in the **same commit**.
2. Before changing one, open `06-touch-map.md` and update every caller listed.
3. Adding a parameter: make it optional, or update all callers in the same change. Never leave
   a caller passing the old shape.
4. Never widen what `core/` accepts to include Express types. Controllers adapt HTTP to these
   functions; these functions never learn about HTTP.
