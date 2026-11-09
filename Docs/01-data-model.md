# Data model

DDL: `apps/Backend/migrations/001_init.sql` **after sub-phase 1A**; until 1A runs it is still
at `apps/Backend/db/migrations/001_init.sql`. Conventions: `00-conventions.md`.
This file is the *why* — read it before writing SQL or adding a column.

28 tables. Money is `BIGINT` paise, stay dates are `DATE`, events are `timestamptz`,
enum-like columns are `TEXT` + `CHECK`.

## Tables

### Identity

| Table | Purpose | Notable |
|---|---|---|
| `users` | Guests **and** employees, one table | `kind` guest/employee, `role`, `team`. CHECKs make a guest structurally unable to hold an employee role, a team, or a username; an employee row without username/email/password_hash is rejected. Case-insensitive partial unique indexes on email, username, google_sub, phone |
| `sessions` | Rotating refresh credentials | Opaque random value, stored **only** as `token_hash`. `rotated_from` chains rotations so reuse of a retired token is detectable. `revoked_reason` records *why* — including `employee_disabled` |
| `otp_challenges` | Email/phone OTP | `code_hash` never the code. `attempts` and `resend_count` are columns so the limits are enforced in the database row, not in memory. Partial unique index allows exactly one live challenge per (purpose, destination) |

One `users` table rather than separate guest and employee tables: they share
authentication, sessions and audit references, and the CHECK constraints give the same
safety a split would, without the joins.

### Pricing and inventory

| Table | Purpose | Notable |
|---|---|---|
| `tax_config` | Versioned GST rules | Rates as basis points, threshold in paise. Row 1 is seeded in the migration with its notification citation. The version in force is copied onto each quote and booking |
| `room_types` | The sellable catalogue | `physical_stock` vs `base_allotment` are different things; a CHECK stops allotment exceeding stock. `max_occupancy <= max_adults + max_children`. `amenities` (what the room has) and `inclusions` (what the rate covers) are separate arrays — §8C lists them separately and the AI quotes inclusions |
| `room_photos` | Responsive variants | Pre-generated `variants` jsonb, not an upload pipeline. Exactly one cover per room type (partial unique index) |
| `room_day` | **The one that matters.** Per-(room type, date) override *and* lock row | See below |

### `room_day`

One row per room type per calendar date, doing three jobs:

1. optional `price_paise` override (NULL = use the base price),
2. optional `allotment` override (NULL = use the base allotment) and the `is_blackout` flag,
3. **the lock target** for reservations.

Rows are materialised on demand with `INSERT … ON CONFLICT DO NOTHING`, so absence means
"no override" — which is why the override columns are nullable rather than defaulted.

Overrides are stored **per date, not as ranges**. The admin UI accepts a date range and
expands it. Three things get easier: overlapping edits become a primary-key conflict instead
of custom interval logic, the effective-rate lookup is one join, and the override row *is*
the row a reservation already needs to lock — so there is only one thing to lock.

**Effective allotment** for a (room type, date):

```
blackout            -> 0
allotment override  -> least(override, physical_stock)
otherwise           -> least(base_allotment, physical_stock)
```

**Committed inventory is computed, never stored.** There is no "rooms sold" counter anywhere:

```sql
SELECT count(*) FROM booking_nights n JOIN bookings b ON b.id = n.booking_id
WHERE n.room_type_id = $1 AND n.stay_date = $2
  AND (b.status = 'confirmed'
       OR (b.status = 'pending_payment' AND b.hold_expires_at > now()))
```

A counter would need an expiry worker to stay truthful, and would drift the moment one ran
late or twice. This expression is correct the instant a hold lapses, with no worker in the
correctness path — the worker only tidies statuses and triggers refunds. Cost is covered by
`booking_nights_inventory_idx (room_type_id, stay_date)` and
`bookings_live_hold_idx (hold_expires_at) WHERE status='pending_payment'`.

**The invariant:** confirmed + live holds ≤ effective allotment, for every room type and
night. Enforced in application logic inside a locked transaction — not by a constraint,
because it spans rows.

**Lock order, fixed everywhere:** `SELECT … FOR UPDATE … ORDER BY room_type_id, stay_date`.
Both the reservation path and the admin allotment/blackout path use it. Consistent ordering is
what stops two concurrent multi-room checkouts deadlocking on each other's rows. Recheck
availability **after** the locks are held, never before.

### Quotes and bookings

| Table | Purpose | Notable |
|---|---|---|
| `quotes` | Priced, expiring snapshot | `lines` + full `pricing` jsonb (per-room-night breakdown, discount allocation, tax bracketing). CHECK asserts `total = room − discount + tax` |
| `bookings` | One row per reservation | Purchased-price snapshot. CHECKs: dates ordered, total consistent, `pending_payment` must have a `hold_expires_at`, `confirmed` must have a `confirmed_at` |
| `booking_rooms` | One per room sold | Per-room occupancy, plus `room_name_snapshot` so a later catalogue rename doesn't rewrite history |
| `booking_nights` | One per room **per night** | The inventory-consuming rows, and the per-unit-day tax record: `price`, `discount`, `taxable`, `tax_rate_bps`, `tax`. Unique on `(booking_room_id, stay_date)` |

**Why the money is duplicated onto `booking_nights`.** The GST bracket is decided per unit per
day on post-discount value (`03-decisions.md`), so the rate genuinely varies night to night
within one booking. Storing it per night is what makes a booking reproducible years later
without replaying the rate tables. Snapshots on the booking, not the current rate tables, are
the record of what was sold — a later base-price, festival-override, promo or tax change must
never move a sold total, and a live hold keeps its agreed quote until it expires.

### Money movement

| Table | Purpose | Notable |
|---|---|---|
| `payments` | One row per attempt | `UNIQUE (booking_id, attempt_no)`; partial unique index allows at most one `processing` attempt per booking |
| `payment_events` | The server-controlled mock ledger | `event_key` UNIQUE — a redelivered event is a no-op, not a second confirmation. `processed_at` gates reprocessing |
| `refunds` | Mock refunds | `UNIQUE (payment_id, reason)` makes a double refund structurally impossible. Exactly one reason exists: `late_payment_inventory_released` — payment recovery, **not** cancellation (§29) |
| `idempotency_keys` | Request replay | Stores `request_hash` and the completed response. Same key + same body replays; same key + different body is 409 |
| `promo_codes` / `promo_redemptions` | Discounts | Percent in basis points, fixed in paise. Capacity is counted from `held` + `consumed` rows under a `FOR UPDATE` lock on the promo row — never a cached counter. Partial unique index enforces one code per booking |

The browser cannot declare a booking paid. Confirmation only happens by the server processing
a ledger event it generated itself.

### Enquiries

| Table | Purpose | Notable |
|---|---|---|
| `enquiries` | One per thread | `status` is the 4 conversation states only. `category` is **nullable** — uncertain means unset, never a guessed category. `needs_review` and `is_complaint` are flags/filters, not extra statuses. CHECK: only a `website` enquiry may carry a `guest_user_id`, so an email or WhatsApp thread can never surface in a guest account even when the contact matches |
| `enquiry_messages` | Thread contents | `visibility` guest/internal. CHECKs stop an internal note or an inbound message ever being marked delivered. `from_ai_run_id` records that an outbound message came from a draft — needed for honest metrics |
| `enquiry_events` | Assignment/classification history | Survives employee disabling, so reassignment doesn't erase the trail |
| `enquiry_reads` | Per-employee unread state | Drives new-activity indicators |
| `ai_runs` | One per model call | Provider, model, prompt version, knowledge version, status, validation errors, latency, tokens. Stores **validated output only** — not raw prompts (§17) |
| `ai_drafts` | The draft awaiting review | Separate from messages on purpose: a draft is not a message until a human sends it. Partial unique index allows one `pending` draft per thread. `quote_block` holds backend-rendered price text, never model-authored |

`ai_runs.status` distinguishes `schema_invalid`, `semantic_invalid`, `low_confidence`,
`timeout`, `provider_error` and `price_claim_rejected` — because "the AI failed" is not one
thing and the GM's review lane needs to say which.

### Operations

| Table | Purpose | Notable |
|---|---|---|
| `resort_info` | Approved facts, versioned | New row per revision, `is_current` partial unique per key. The only factual source the AI may quote. Prices never come from here |
| `jobs` | Postgres-backed queue | Claimed with `FOR UPDATE SKIP LOCKED`. `run_after`, `attempts`/`max_attempts`, `locked_at` for reclaiming work a crashed worker abandoned, optional `dedupe_key` for at-most-once jobs. No Redis |
| `notifications` | In-app alerts | Complaint alerts, unassigned enquiries, AI failures, recorded refunds |
| `audit_events` | Append-only trail | **A trigger raises on UPDATE and DELETE**, so immutability is structural rather than a promise. Owner actions are audited like anyone's |
| `analytics_events` | Funnel counting | `anon_id` is a random first-party cookie value, not a fingerprint. `dedupe_key` unique so a repeated client event counts once |
| `schema_migrations` | Applied versions | Created by the runner, not by `001`. Stores a checksum; an edited applied migration is refused |

## Verified behaviour

Run against PostgreSQL 18 on 2026-11-07. `001_init.sql` applies clean; the runner is
idempotent on a second run and refuses a migration whose checksum drifted. 20 negative cases
were rejected by the schema itself, including: a guest row with an employee role, a team on a
GM, allotment above physical stock, incoherent occupancy, a negative price override, checkout
before check-in, a total that doesn't add up, `pending_payment` without a hold expiry, a
percent promo above 100%, a WhatsApp enquiry owned by a guest account, an internal note marked
delivered, a second pending AI draft, a duplicate payment event key, a duplicate refund, a
second live payment attempt, two covers on one room type, a case-insensitive duplicate email,
and a second live OTP challenge. `audit_events` survived both an UPDATE and a DELETE attempt.

## Added in the pre-handoff review

**`room_types.inclusions text[] NOT NULL DEFAULT '{}'`** — what the *rate* includes, as opposed
to what the room *has* (`amenities`). §8C lists them separately and they genuinely differ.
Structured rather than prose so the AI can state inclusions without inventing them.

**`quotes.terms_version int NOT NULL`** — the `booking_terms` version in force when the quote
was priced. `bookings.terms_version` is `NOT NULL` and had no source before this: deriving it at
hold time would hold a guest to terms published *after* they agreed. See INV-58.

Both landed in `001_init.sql` in sub-phase 1A, verified applied on PostgreSQL 18. The table
count is 28 plus `schema_migrations`.

### Public identifier formats

Neither is sequential, because a sequential identifier lets one guest guess another's (GI-2).

| Column | Format | Generated by |
|---|---|---|
| `bookings.reference` | `BK-` + 8 chars of `23456789ABCDEFGHJKMNPQRSTVWXYZ` | `generateReference()` in `core/booking.ts`, inside the hold transaction; `UNIQUE`, retry up to 5 times on collision |
| `enquiries.public_ref` | `ENQ-` + 4 digits, random | 1I, same retry rule. The three supplied fixtures are seeded literals, never generated |

The alphabet omits `0/O`, `1/I/L` and `U/V` so a reference survives being read aloud over a
phone — which is the only reason it exists as a short string rather than the uuid.
