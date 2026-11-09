/**
 * Test data factories. Signatures fixed in Docs/09-test-harness.md. All amounts in paise, all
 * dates 'YYYY-MM-DD'. Every factory writes with parameterised SQL and returns real ids.
 *
 * `createEmployee` is added in 2A, once `middleware/adminAuth.ts` exists to consume it.
 * `createGuestUserId` is a bare stand-in used only by `createBooking`, from before
 * `createGuest` existed — kept for 1C's callers, which need no token.
 */
import { pool } from '../../src/db.ts';
import { POLICY } from '../../src/core/policy.ts';
import { calculateQuote } from '../../src/core/pricing.ts';
import type { QuoteLineNight } from '../../src/core/pricing.ts';
import { loadPrincipal, mintAccessToken } from '../../src/core/tokens.ts';

function kolkataToday(): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: POLICY.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [y, m, d] = parts.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

export function futureDate(daysFromToday: number): string {
  const d = kolkataToday();
  d.setUTCDate(d.getUTCDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
}

/** Not a documented factory — just the `created_by` every owner-authored row needs, before
 *  `createEmployee` exists (1D). A fixed id, upserted every call, so it survives
 *  `resetDatabase`'s TRUNCATE without a cross-file cache to invalidate. */
const TEST_OWNER_ID = '00000000-0000-0000-0000-000000000001';
async function ownerUserId(): Promise<string> {
  await pool.query(
    `INSERT INTO users (id, kind, role, name, email, username, password_hash)
     VALUES ($1, 'employee', 'owner', 'Test Owner', 'test-owner@example.com', 'test-owner', 'x')
     ON CONFLICT (id) DO NOTHING`,
    [TEST_OWNER_ID],
  );
  return TEST_OWNER_ID;
}

/** Same stand-in pattern as `ownerUserId`, for a bare guest row — `createBooking` needs a
 *  `guestUserId` before `createGuest` (with its minted token) exists (1D). Each call makes a
 *  fresh guest, since inventory tests need distinct guests racing each other. */
export async function createGuestUserId(): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (id, kind, role, name, email)
     VALUES (gen_random_uuid(), 'guest', 'guest', 'Test Guest', $1)
     RETURNING id`,
    [`guest-${crypto.randomUUID()}@example.com`],
  );
  return rows[0]!.id;
}

export async function createRoomType(
  overrides: Partial<{
    slug: string;
    name: string;
    basePricePaise: number;
    physicalStock: number;
    baseAllotment: number;
    maxAdults: number;
    maxChildren: number;
    maxOccupancy: number;
    inclusions: string[];
    isActive: boolean;
  }> = {},
): Promise<{ id: string; slug: string; basePricePaise: number }> {
  const slug = overrides.slug ?? `room-${crypto.randomUUID()}`;
  const basePricePaise = overrides.basePricePaise ?? 500000;
  const physicalStock = overrides.physicalStock ?? 10;
  const baseAllotment = overrides.baseAllotment ?? 10;
  const maxAdults = overrides.maxAdults ?? 2;
  const maxChildren = overrides.maxChildren ?? 1;
  const maxOccupancy = overrides.maxOccupancy ?? 3;
  const inclusions = overrides.inclusions ?? [];
  const isActive = overrides.isActive ?? true;

  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO room_types
       (slug, name, summary, description, inclusions, max_adults, max_children, max_occupancy,
        physical_stock, base_price_paise, base_allotment, is_active)
     VALUES ($1, $2, 'Test summary', 'Test description', $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      slug,
      overrides.name ?? 'Test Room',
      inclusions,
      maxAdults,
      maxChildren,
      maxOccupancy,
      physicalStock,
      basePricePaise,
      baseAllotment,
      isActive,
    ],
  );
  return { id: rows[0]!.id, slug, basePricePaise };
}

/** Sets an override, an allotment or a blackout on one date. Writes `room_day` directly. */
export async function setRoomDay(input: {
  roomTypeId: string;
  stayDate: string;
  pricePaise?: number;
  allotment?: number;
  isBlackout?: boolean;
}): Promise<void> {
  await pool.query(
    `INSERT INTO room_day (room_type_id, stay_date, price_paise, allotment, is_blackout)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (room_type_id, stay_date) DO UPDATE SET
       price_paise = EXCLUDED.price_paise,
       allotment = EXCLUDED.allotment,
       is_blackout = EXCLUDED.is_blackout,
       updated_at = now()`,
    [input.roomTypeId, input.stayDate, input.pricePaise ?? null, input.allotment ?? null, input.isBlackout ?? false],
  );
}

export async function createPromo(input: {
  code: string;
  kind: 'percent' | 'fixed';
  value: number;
  maxUses?: number;
  startsAt?: string;
  endsAt?: string;
  isActive?: boolean;
}): Promise<{ id: string }> {
  const createdBy = await ownerUserId();
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO promo_codes (code, kind, value, max_uses, starts_at, ends_at, is_active, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      input.code,
      input.kind,
      input.value,
      input.maxUses ?? null,
      input.startsAt ?? null,
      input.endsAt ?? null,
      input.isActive ?? true,
      createdBy,
    ],
  );
  return { id: rows[0]!.id };
}

export async function publishResortInfo(input: {
  key: string;
  title: string;
  body: string;
}): Promise<{ version: number }> {
  const createdBy = await ownerUserId();
  const { rows: current } = await pool.query<{ version: number }>(
    `SELECT version FROM resort_info WHERE key = $1 AND is_current`,
    [input.key],
  );
  const nextVersion = (current[0]?.version ?? 0) + 1;

  await pool.query(`UPDATE resort_info SET is_current = false WHERE key = $1`, [input.key]);
  const { rows } = await pool.query<{ version: number }>(
    `INSERT INTO resort_info (key, title, body, version, is_current, created_by)
     VALUES ($1, $2, $3, $4, true, $5)
     RETURNING version`,
    [input.key, input.title, input.body, nextVersion, createdBy],
  );
  return { version: rows[0]!.version };
}

/** Shortcut to a priced quote, so a booking test is not also a pricing test. */
export async function createQuote(input: {
  guestUserId?: string;
  checkIn: string;
  checkOut: string;
  rooms: Array<{ roomTypeId: string; adults: number; children: number }>;
  promoCode?: string;
}): Promise<{ id: string; totalPaise: number }> {
  const result = await calculateQuote(pool, {
    stay: { checkIn: input.checkIn, checkOut: input.checkOut },
    rooms: input.rooms,
    promoCode: input.promoCode,
  });

  let promoId: string | null = null;
  if (input.promoCode) {
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM promo_codes WHERE upper(code) = upper($1)`,
      [input.promoCode],
    );
    promoId = rows[0]?.id ?? null;
  }

  const { rows } = await pool.query<{ id: string; total_paise: number }>(
    `INSERT INTO quotes
       (guest_user_id, check_in, check_out, lines, pricing, promo_id, room_paise,
        discount_paise, tax_paise, total_paise, tax_config_version, terms_version, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now() + interval '1 minute' * $13)
     RETURNING id, total_paise`,
    [
      input.guestUserId ?? null,
      input.checkIn,
      input.checkOut,
      JSON.stringify(input.rooms),
      JSON.stringify(result),
      promoId,
      result.roomPaise,
      result.discountPaise,
      result.taxPaise,
      result.totalPaise,
      result.taxConfigVersion,
      result.termsVersion,
      POLICY.expiry.quoteMinutes,
    ],
  );
  return { id: rows[0]!.id, totalPaise: rows[0]!.total_paise };
}

type QuoteRow = {
  check_in: string;
  check_out: string;
  lines: Array<{ roomTypeId: string; adults: number; children: number }>;
  pricing: { nights: QuoteLineNight[] };
  promo_id: string | null;
  room_paise: number;
  discount_paise: number;
  tax_paise: number;
  total_paise: number;
  tax_config_version: number;
  terms_version: number;
};

const REFERENCE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
function testReference(): string {
  let ref = 'BK-';
  for (let i = 0; i < 8; i += 1) {
    ref += REFERENCE_ALPHABET[Math.floor(Math.random() * REFERENCE_ALPHABET.length)];
  }
  return ref;
}

/** A hold in whatever state the case needs. `holdExpiresAt: 'past'` back-dates the hold so an
 *  expiry case does not have to wait ten minutes. With `quoteId`, the booking's rooms and
 *  nights are built from that quote's already-computed pricing (`createQuote`), so an
 *  inventory test is not also re-deriving pricing — `core/booking.ts` (createBookingHold)
 *  does not exist until 1G, so this factory inserts the rows directly. */
export async function createBooking(input: {
  guestUserId: string;
  quoteId?: string;
  status?: 'pending_payment' | 'confirmed' | 'payment_failed' | 'expired';
  holdExpiresAt?: string | 'past';
}): Promise<{ id: string; reference: string }> {
  const status = input.status ?? 'pending_payment';
  const holdExpiresAt =
    input.holdExpiresAt === 'past'
      ? "now() - interval '1 minute'"
      : input.holdExpiresAt
        ? `'${input.holdExpiresAt}'`
        : status === 'pending_payment'
          ? `now() + interval '1 minute' * ${POLICY.expiry.paymentHoldMinutes}`
          : 'NULL';
  const confirmedAt = status === 'confirmed' ? 'now()' : 'NULL';
  const reference = testReference();

  let quote: QuoteRow | null = null;
  if (input.quoteId) {
    const { rows } = await pool.query<QuoteRow>(
      `SELECT check_in, check_out, lines, pricing, promo_id, room_paise, discount_paise,
              tax_paise, total_paise, tax_config_version, terms_version
         FROM quotes WHERE id = $1`,
      [input.quoteId],
    );
    quote = rows[0] ?? null;
  }

  const checkIn = quote?.check_in ?? futureDate(1);
  const checkOut = quote?.check_out ?? futureDate(2);
  const taxConfigVersion =
    quote?.tax_config_version ??
    (await pool.query<{ version: number }>(`SELECT max(version) AS version FROM tax_config`))
      .rows[0]!.version;
  const termsVersion =
    quote?.terms_version ??
    (
      await pool.query<{ version: number }>(
        `SELECT version FROM resort_info WHERE key = 'booking_terms' AND is_current`,
      )
    ).rows[0]?.version ?? 0;

  const { rows: bookingRows } = await pool.query<{ id: string }>(
    `INSERT INTO bookings
       (reference, guest_user_id, status, check_in, check_out, hold_expires_at, quote_id,
        promo_id, room_paise, discount_paise, tax_paise, total_paise, tax_config_version,
        terms_version, guest_name, guest_email, guest_phone, confirmed_at)
     VALUES ($1, $2, $3, $4, $5, ${holdExpiresAt}, $6, $7, $8, $9, $10, $11, $12, $13,
             'Test Guest', 'test-guest@example.com', '9999999999', ${confirmedAt})
     RETURNING id`,
    [
      reference,
      input.guestUserId,
      status,
      checkIn,
      checkOut,
      input.quoteId ?? null,
      quote?.promo_id ?? null,
      quote?.room_paise ?? 0,
      quote?.discount_paise ?? 0,
      quote?.tax_paise ?? 0,
      quote?.total_paise ?? 0,
      taxConfigVersion,
      termsVersion,
    ],
  );
  const bookingId = bookingRows[0]!.id;

  if (quote) {
    const nightsPerRoom = quote.pricing.nights.length / quote.lines.length;
    for (let lineIndex = 0; lineIndex < quote.lines.length; lineIndex += 1) {
      const line = quote.lines[lineIndex]!;
      const { rows: roomTypeRows } = await pool.query<{ name: string }>(
        `SELECT name FROM room_types WHERE id = $1`,
        [line.roomTypeId],
      );
      const { rows: roomRows } = await pool.query<{ id: string }>(
        `INSERT INTO booking_rooms (booking_id, room_type_id, room_name_snapshot, adults, children)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [bookingId, line.roomTypeId, roomTypeRows[0]!.name, line.adults, line.children],
      );
      const bookingRoomId = roomRows[0]!.id;

      const ownNights = quote.pricing.nights.slice(
        lineIndex * nightsPerRoom,
        (lineIndex + 1) * nightsPerRoom,
      );
      for (const night of ownNights) {
        await pool.query(
          `INSERT INTO booking_nights
             (booking_id, booking_room_id, room_type_id, stay_date, price_paise, discount_paise,
              taxable_paise, tax_rate_bps, tax_paise)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            bookingId,
            bookingRoomId,
            night.roomTypeId,
            night.stayDate,
            night.pricePaise,
            night.discountPaise,
            night.taxablePaise,
            night.taxRateBps,
            night.taxPaise,
          ],
        );
      }
    }
  }

  return { id: bookingId, reference };
}

/** A logged-in guest, both contacts verified by default — most tests want a guest who can
 *  already book, not one mid-signup. */
export async function createGuest(
  overrides: Partial<{
    name: string;
    email: string;
    phone: string;
    emailVerified: boolean;
    phoneVerified: boolean;
  }> = {},
): Promise<{ id: string; accessToken: string }> {
  const name = overrides.name ?? 'Test Guest';
  const email = overrides.email ?? `guest-${crypto.randomUUID()}@example.com`;
  const phone = overrides.phone ?? `9${Math.floor(100000000 + Math.random() * 899999999)}`;
  const emailVerified = overrides.emailVerified ?? true;
  const phoneVerified = overrides.phoneVerified ?? true;

  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (kind, role, name, email, phone, email_verified_at, phone_verified_at)
     VALUES ('guest', 'guest', $1, $2, $3,
             CASE WHEN $4 THEN now() ELSE NULL END,
             CASE WHEN $5 THEN now() ELSE NULL END)
     RETURNING id`,
    [name, email, phone, emailVerified, phoneVerified],
  );
  const id = rows[0]!.id;
  const principal = await loadPrincipal(id);
  const accessToken = await mintAccessToken(principal!);
  return { id, accessToken };
}

/** Docs/09-test-harness.md. The password is fixed and never asserted on — tests exercise
 *  `/admin/auth/login` through a real password only when the case is about login itself
 *  (`tests/helpers/employeeAuth.ts` would be overkill for one shared literal). */
export const TEST_EMPLOYEE_PASSWORD = 'TestEmployee!2026';

export async function createEmployee(
  input: { role: 'staff' | 'gm' | 'owner'; team?: 'reservations' | 'sales'; isActive?: boolean },
): Promise<{ id: string; username: string; accessToken: string }> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const username = `${input.role}-${suffix}`;
  const passwordHash = await Bun.password.hash(TEST_EMPLOYEE_PASSWORD, { algorithm: 'argon2id' });
  const isActive = input.isActive ?? true;

  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (
       kind, role, team, name, email, email_verified_at, username, password_hash,
       is_active, disabled_at
     )
     VALUES (
       'employee', $1, $2, $3, $4, now(), $5, $6,
       $7, CASE WHEN $7 THEN NULL ELSE now() END
     )
     RETURNING id`,
    [input.role, input.team ?? null, `Test ${input.role}`, `${username}@coffeeestate.test`, username, passwordHash, isActive],
  );
  const id = rows[0]!.id;
  const principal = await loadPrincipal(id);
  // A disabled employee has no live principal by design (INV-15) — mint straight from the
  // row for that case, since DE-3 needs a token that was valid before the disable, not after.
  const accessToken = principal
    ? await mintAccessToken(principal)
    : await mintAccessToken({
        userId: id, kind: 'employee', role: input.role, team: input.team ?? null,
        emailVerified: true, phoneVerified: false,
      });
  return { id, username, accessToken };
}
