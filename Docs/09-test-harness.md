# Test harness

The cases live in `tests-phase1.md` and `tests-phase2.md`. This file is **how** to write them:
the helper signatures, and the three things that are easy to fake by accident.

Build `tests/helpers/` once, in 1B, before the first test file. Every later sub-phase imports
from it and adds factories as its tables arrive.

## Database

```ts
// tests/helpers/db.ts

/** Refuses to run unless TEST_DATABASE_URL is set and DIFFERENT from DATABASE_URL.
 *  Called once per test file, at the top. The suite is destructive. */
export function requireTestDatabase(): void;

/** TRUNCATE every table except tax_config, in one statement with CASCADE, then re-seed
 *  tax_config v1 if it is missing. Called in beforeEach.
 *  audit_events must be truncated too — the append-only trigger fires on UPDATE and DELETE,
 *  not TRUNCATE, which is exactly why it is TRUNCATE and not DELETE. */
export function resetDatabase(): Promise<void>;

/** A second, independent pool. Needed for genuine concurrency: two transactions on the same
 *  pool can still interleave correctly, but a pool of 10 under a 10-way test will starve. */
export function extraPool(): Pool;
```

`resetDatabase` truncates; it does not drop. Running `bun run migrate` against
`TEST_DATABASE_URL` once is a prerequisite, not something the suite does.

## Factories

```ts
// tests/helpers/factories.ts   — all amounts in paise, all dates 'YYYY-MM-DD'

export function futureDate(daysFromToday: number): string;        // resort-local, POLICY.timezone

export function createRoomType(overrides?: Partial<{
  slug: string; name: string; basePricePaise: number; physicalStock: number;
  baseAllotment: number; maxAdults: number; maxChildren: number; maxOccupancy: number;
  inclusions: string[]; isActive: boolean;
}>): Promise<{ id: string; slug: string; basePricePaise: number }>;

export function createGuest(overrides?: Partial<{
  name: string; email: string; phone: string;
  emailVerified: boolean; phoneVerified: boolean;      // default BOTH true
}>): Promise<{ id: string; accessToken: string }>;

export function createEmployee(input: {
  role: 'staff' | 'gm' | 'owner'; team?: 'reservations' | 'sales'; isActive?: boolean;
}): Promise<{ id: string; username: string; accessToken: string }>;

/** Sets an override, an allotment or a blackout on one date. Writes room_day directly —
 *  tests arrange state, they do not drive the admin API to do it. */
export function setRoomDay(input: {
  roomTypeId: string; stayDate: string;
  pricePaise?: number; allotment?: number; isBlackout?: boolean;
}): Promise<void>;

export function createPromo(input: {
  code: string; kind: 'percent' | 'fixed'; value: number;
  maxUses?: number; startsAt?: string; endsAt?: string; isActive?: boolean;
}): Promise<{ id: string }>;

export function publishResortInfo(input: {
  key: string; title: string; body: string;
}): Promise<{ version: number }>;

/** Shortcut to a priced quote, so a booking test is not also a pricing test. */
export function createQuote(input: {
  guestUserId?: string; checkIn: string; checkOut: string;
  rooms: Array<{ roomTypeId: string; adults: number; children: number }>;
  promoCode?: string;
}): Promise<{ id: string; totalPaise: number }>;

/** A hold in whatever state the case needs. `holdExpiresAt: 'past'` back-dates the hold so
 *  an expiry case does not have to wait ten minutes. */
export function createBooking(input: {
  guestUserId: string; quoteId?: string;
  status?: 'pending_payment' | 'confirmed' | 'payment_failed' | 'expired';
  holdExpiresAt?: string | 'past';
}): Promise<{ id: string; reference: string }>;
```

**Every factory writes with parameterised SQL and returns real ids.** No fixture JSON file, no
shared mutable object between cases — `resetDatabase` in `beforeEach` means each case builds
exactly what it needs.

## 1. Real concurrency, not sequential awaits

`inventory.oversell` and `promo.concurrency` are the graded tests. Two `await`s in a row are
**not** concurrent and will pass against code that oversells. The attempts must be inside open
transactions at the same moment.

```ts
// tests/helpers/concurrency.ts

/** Runs `bodies.length` transactions that all reach a barrier before any of them proceeds
 *  past it, so the contended section genuinely overlaps. Each body gets its own checked-out
 *  client. Returns settled results in input order — losers are expected, so never Promise.all. */
export function runConcurrently<T>(
  bodies: Array<(client: Tx, barrier: () => Promise<void>) => Promise<T>>,
): Promise<Array<{ status: 'ok'; value: T } | { status: 'error'; error: unknown }>>;
```

Implementation: one `Promise` resolved when the last participant has arrived, each body
`await barrier()` after `BEGIN` and before the lock.

For the end-to-end oversell cases, the same rule applies at the HTTP level: fire the requests
with `Promise.allSettled`, not in a loop with `await`.

```ts
const results = await Promise.allSettled(
  Array.from({ length: 10 }, () => postBooking(quoteIds.shift()!, guest)),
);
expect(results.filter(succeeded)).toHaveLength(3);
```

And assert the **outcome in the database**, not just the status codes:

```ts
const { rows } = await pool.query(
  `SELECT count(*)::int AS n FROM booking_nights bn
     JOIN bookings b ON b.id = bn.booking_id
    WHERE bn.room_type_id = $1 AND bn.stay_date = $2
      AND (b.status = 'confirmed'
           OR (b.status = 'pending_payment' AND b.hold_expires_at > now()))`,
  [roomTypeId, stayDate],
);
expect(rows[0].n).toBe(3);        // never 4 — INV-1
```

That query **is** the availability expression. If a test writes its own version of it and they
drift, the test stops proving anything — see the first change-together rule in `06-touch-map.md`.

## 2. Time, without a fake clock

Never patch `Date.now` or install fake timers: the expiry rule is enforced in SQL with `now()`,
so a patched JS clock tests nothing. Move the data instead.

- "hold expired" → insert `hold_expires_at = now() - interval '1 minute'`.
- "quote expired by one second" → `expires_at = now() - interval '1 second'`.
- "OTP older than five minutes" → back-date `expires_at`.
- "worker has not run" → simply do not run it. That is the point of OS-10 and JR-6.

## 3. Forcing a mid-transaction failure

RB-1 needs a failure *after* `booking_rooms` is inserted and *before* `booking_nights`. Do not
add a production seam, a mock or an injected flag for this. Use the database:

```ts
await pool.query(`
  CREATE OR REPLACE FUNCTION test_fail_nights() RETURNS trigger LANGUAGE plpgsql AS
  $fn$ BEGIN RAISE EXCEPTION 'injected failure'; END $fn$;
  CREATE TRIGGER test_fail_nights BEFORE INSERT ON booking_nights
    FOR EACH ROW EXECUTE FUNCTION test_fail_nights();
`);
// ... attempt the hold, expect it to throw ...
await pool.query('DROP TRIGGER test_fail_nights ON booking_nights');
```

Then assert **zero** rows in `bookings`, `booking_rooms` and `booking_nights`, and that the
promo redemption was not consumed (AT-4). The real transaction rolled back the real work.

## Running them

```bash
bun run migrate            # once, against TEST_DATABASE_URL
bun test                   # whole suite
bun test tests/inventory.oversell.test.ts
```

`src/db.ts` throws at import when `NODE_ENV=test` and `TEST_DATABASE_URL` is unset. That is
deliberate: a suite that silently truncated the working database would be unrecoverable.

Call `resetRateLimits()` from `middleware/rateLimit.ts` in `beforeEach` for any test that makes
more than a handful of requests to a limited route, or a later case will fail on a window the
earlier one used up.
