# Conventions

The single place for these rules. Other docs and code link here instead of restating them.

## Money

| Rule | Detail |
|---|---|
| Unit | **Integer paise.** `BIGINT` in Postgres, `number` in TS (safe: ₹1 crore = 10⁹ paise). Never floats, never rupees |
| Field naming | Always suffixed `_paise` |
| Rounding | **Half-up**, applied once, at the per-room-night tax computation. Nothing else rounds |
| Totals | `total_paise = room_paise − discount_paise + tax_paise`, asserted before persisting |
| Authority | The backend computes every amount. A total, price or discount sent by a client is ignored, not validated |
| Display | The API returns paise; the UI formats with `Intl.NumberFormat('en-IN', {style:'currency', currency:'INR'})` |

**Discount allocation.** A promo discount is spread across room-nights in proportion to each
room-night's price, floored to paise, and the leftover remainder is added to the single
highest-priced room-night so the parts sum exactly to the discount. This matters because the
GST bracket is decided per room-night on the **post-discount** value — see
`03-decisions.md`.

## Dates and time

| Rule | Detail |
|---|---|
| Resort timezone | `Asia/Kolkata`. Used for "today", export date filtering, and working hours |
| Stay dates | Postgres `DATE`, `YYYY-MM-DD` on the wire. No timezone, ever — a stay night is a calendar date |
| Check-in / checkout | Check-in **inclusive**, checkout **exclusive**. A 14→16 Nov stay consumes nights 14 and 15 |
| Nights | `checkout − checkin`, must be ≥ 1 |
| Event timestamps | `timestamptz`, UTC on the wire, ISO 8601 |
| Expiry | Server-stamped and server-checked. A client clock, or a page refresh, never extends a quote or a hold |

## Error envelope

Every non-2xx response, without exception:

```json
{ "error": { "code": "availability_conflict", "message": "Human-readable, safe to show",
             "details": { "...": "optional, structured" }, "requestId": "01J..." } }
```

`code` is a stable snake_case string the UI may branch on; `message` is for people. Never a
stack trace, SQL fragment, driver message or internal identifier.

| Status | Used for |
|---|---|
| 400 | `validation_failed` — Zod rejected body, query or params. `details.issues` carries the field paths |
| 401 | `unauthenticated` — missing, invalid or expired access token |
| 403 | `forbidden` — authenticated but not permitted, incl. disabled employee, incl. another guest's record |
| 404 | `not_found` — also returned instead of 403 where confirming existence would itself leak |
| 409 | `availability_conflict`, `promo_exhausted`, `idempotency_key_reused`, `quote_already_booked` — that quote already produced a live booking, `stale_write`, `last_owner` — disabling the last active owner |
| 410 | `quote_expired`, `hold_expired` — it existed, it is gone, the client must restart the step |
| 422 | `price_changed` — the quote is valid but the amount moved; carries the new quote for acknowledgement |
| 429 | `rate_limited` — with `Retry-After` |
| 500 | `internal_error` — message is generic, detail goes to the log with the same `requestId` |

Every request gets a `requestId` (`X-Request-Id`, echoed), logged with the outcome.

## Pagination

Keyset, never offset. `?limit=&cursor=` where `limit` is 1–100 (default 25) and `cursor` is
an opaque base64 of the last row's `(created_at, id)`.

```json
{ "items": [], "nextCursor": "eyJ..." }
```

`nextCursor: null` means the end. Unbounded list endpoints do not exist; neither do date
ranges wider than 366 days.

This rule holds everywhere **except two endpoints that break it today** — see `08-known-issues.md`
(KI-1, KI-2). They are registered violations awaiting a cursor, not precedent. Do not copy them;
`routes/admin/audit/controllers.ts` is the shape to follow.

## Idempotency

Required on every POST that moves money or inventory: hold creation, payment attempt, refund,
promo redemption. Header `Idempotency-Key`, a client-generated UUIDv4.

- First call stores `(key, user, endpoint, sha256(body))` and, on completion, the response.
- A repeat with the **same** key and body replays the stored response and status — it does not
  re-execute.
- A repeat with the same key and a **different** body is `409 idempotency_key_reused`.
- An in-flight duplicate gets `409`; the client retries and then sees the replay.

Mock payment webhook events carry their own `payment_events.event_key` unique constraint, so a
redelivered event is a no-op rather than a second confirmation or a second refund.

## SQL

- Values are **always** parameterised (`$1`). No string interpolation of values, ever.
- Dynamic identifiers — sort columns, direction, filter columns — come from a hardcoded
  allowlist map, never from the request string.
- Every multi-statement write runs through `withTransaction` on one checked-out client.
- Lock ordering is fixed and documented per table in `01-data-model.md`.

## Naming

`snake_case` in Postgres; **`camelCase` on the wire and in TypeScript** — every guest/admin
controller serializes `snake_case` columns to camelCase JSON (`maxAdults`, `totalPaise`,
`checkIn`), mapped at the module boundary. (Corrected during Phase 3's frontend wiring — this
line previously said snake_case on the wire, which the code has never done; see
`Docs/14-frontend-api-map.md`.) Tables plural, join tables singular-prefixed (`booking_rooms`, `booking_nights`).
Enum-like columns are `TEXT` with a `CHECK` constraint, not Postgres `ENUM` — cheaper to
evolve in a migration.

## Audit

Write an `audit_events` row for: price, allotment and blackout changes; promo changes;
employee create / role / team / disable; enquiry assignment and classification corrections;
staff-approved replies; booking, payment and refund transitions; CSV exports. Owner actions
are audited like everyone else's.

Each row records actor, actor role, action, target, before/after and `requestId`. The table is
append-only — no code path updates or deletes it. Never log a password, OTP value, token or
connection string, there or anywhere.
