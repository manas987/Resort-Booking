/**
 * The ONLY place a stay amount is computed (Docs/04-contracts.md). No Express types here
 * (INV-59 territory for `core/` in general) — a plain `Tx` in, plain data out.
 */
import type { Tx } from '../db.ts';
import { AppError } from '../middleware/errors.ts';
import { POLICY } from './policy.ts';

export type StayRange = { checkIn: string; checkOut: string };
export type RoomSelection = { roomTypeId: string; adults: number; children: number };
// A night of one room, the unit everything inventory-related is counted in.
export type NightRef = { roomTypeId: string; stayDate: string };

export type QuoteLineNight = {
  roomTypeId: string;
  stayDate: string;
  pricePaise: number;
  discountPaise: number;
  taxablePaise: number;
  taxRateBps: number;
  taxPaise: number;
};

export type QuoteResult = {
  nights: QuoteLineNight[];
  roomPaise: number;
  discountPaise: number;
  taxPaise: number;
  totalPaise: number;
  taxConfigVersion: number;
  termsVersion: number;
};

export type TaxConfig = { version: number; thresholdPaise: number; lowRateBps: number; highRateBps: number };

/** Per-unit-day bracket. Pure. taxablePaise <= threshold -> low bps, else high bps (INV-4). */
export function taxRateForUnitDay(taxablePaise: number, config: TaxConfig): number {
  return taxablePaise <= config.thresholdPaise ? config.lowRateBps : config.highRateBps;
}

/** Half-up, done once, via integer math so no float ever touches a money value (INV-29). */
function taxForUnitDay(taxablePaise: number, bps: number): number {
  return Number((BigInt(taxablePaise) * BigInt(bps) + 5000n) / 10000n);
}

/** Spreads `discountPaise` across nights in proportion to price, floored, remainder to the
 *  highest-priced night so the parts sum EXACTLY to the input (INV-5). Pure. */
export function allocateDiscount(nightPrices: number[], discountPaise: number): number[] {
  const roomPaise = nightPrices.reduce((sum, p) => sum + p, 0);
  if (roomPaise === 0 || discountPaise === 0) return nightPrices.map(() => 0);

  const shares = nightPrices.map((price) =>
    Number((BigInt(price) * BigInt(discountPaise)) / BigInt(roomPaise)),
  );
  const allocated = shares.reduce((sum, s) => sum + s, 0);
  const remainder = discountPaise - allocated;

  let highestIndex = 0;
  for (let i = 1; i < nightPrices.length; i += 1) {
    if (nightPrices[i]! > nightPrices[highestIndex]!) highestIndex = i;
  }
  shares[highestIndex] = shares[highestIndex]! + remainder;
  return shares;
}

function datesInRange(checkIn: string, checkOut: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${checkIn}T00:00:00Z`);
  const end = new Date(`${checkOut}T00:00:00Z`);
  while (cursor < end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

type RoomTypeRow = {
  id: string;
  max_adults: number;
  max_children: number;
  max_occupancy: number;
  base_price_paise: number;
};

/** The ONLY place a stay amount is computed. Reads effective rates and tax config, applies the
 *  promo, allocates the discount (INV-5), brackets GST per room-night (INV-4).
 *  Throws AppError('validation_failed') on occupancy breach, AppError('internal_error') if tax
 *  config or booking terms are missing — never silently zero tax (INV-6, INV-58). */
export async function calculateQuote(
  client: Tx,
  input: { stay: StayRange; rooms: RoomSelection[]; promoCode?: string },
): Promise<QuoteResult> {
  const { stay, rooms, promoCode } = input;
  const dates = datesInRange(stay.checkIn, stay.checkOut);
  if (dates.length === 0) {
    throw new AppError('validation_failed', 'Checkout must be after check-in.');
  }
  if (rooms.length === 0) {
    throw new AppError('validation_failed', 'At least one room must be selected.');
  }

  const roomTypeIds = [...new Set(rooms.map((r) => r.roomTypeId))];
  const { rows: roomTypeRows } = await client.query<RoomTypeRow>(
    `SELECT id, max_adults, max_children, max_occupancy, base_price_paise
       FROM room_types WHERE id = ANY($1)`,
    [roomTypeIds],
  );
  const roomTypes = new Map(roomTypeRows.map((r) => [r.id, r]));
  for (const roomTypeId of roomTypeIds) {
    if (!roomTypes.has(roomTypeId)) {
      throw new AppError('validation_failed', `Unknown room type ${roomTypeId}.`);
    }
  }

  // Occupancy is checked per room — spare capacity in one room never excuses another's limit.
  for (const room of rooms) {
    const roomType = roomTypes.get(room.roomTypeId)!;
    if (
      room.adults < POLICY.stay.minAdultsPerRoom ||
      room.adults > roomType.max_adults ||
      room.children > roomType.max_children ||
      room.adults + room.children > roomType.max_occupancy
    ) {
      throw new AppError('validation_failed', 'Room occupancy exceeds this room type\'s limit.');
    }
  }

  const { rows: overrideRows } = await client.query<{
    room_type_id: string;
    stay_date: string;
    price_paise: number;
  }>(
    `SELECT room_type_id, stay_date, price_paise FROM room_day
      WHERE room_type_id = ANY($1) AND stay_date >= $2 AND stay_date < $3
        AND price_paise IS NOT NULL`,
    [roomTypeIds, stay.checkIn, stay.checkOut],
  );
  const overrides = new Map(
    overrideRows.map((r) => [`${r.room_type_id}|${r.stay_date}`, r.price_paise]),
  );

  const { rows: taxRows } = await client.query<{
    version: number;
    threshold_paise: number;
    low_rate_bps: number;
    high_rate_bps: number;
  }>(
    `SELECT version, threshold_paise, low_rate_bps, high_rate_bps
       FROM tax_config ORDER BY effective_from DESC, version DESC LIMIT 1`,
  );
  if (taxRows.length === 0) {
    throw new AppError('internal_error', 'Tax configuration is missing.');
  }
  const taxRow = taxRows[0]!;
  const taxConfig: TaxConfig = {
    version: taxRow.version,
    thresholdPaise: taxRow.threshold_paise,
    lowRateBps: taxRow.low_rate_bps,
    highRateBps: taxRow.high_rate_bps,
  };

  const { rows: termsRows } = await client.query<{ version: number }>(
    `SELECT version FROM resort_info WHERE key = 'booking_terms' AND is_current`,
  );
  if (termsRows.length === 0) {
    throw new AppError('internal_error', 'Booking terms are not configured.');
  }
  const termsVersion = termsRows[0]!.version;

  // One entry per room selection per night — a room-night is the pricing unit, not a room type.
  const roomTypeIdPerNight: string[] = [];
  const pricePerNight: number[] = [];
  const datePerNight: string[] = [];
  for (const room of rooms) {
    for (const date of dates) {
      const override = overrides.get(`${room.roomTypeId}|${date}`);
      roomTypeIdPerNight.push(room.roomTypeId);
      datePerNight.push(date);
      pricePerNight.push(override ?? roomTypes.get(room.roomTypeId)!.base_price_paise);
    }
  }
  const roomPaise = pricePerNight.reduce((sum, p) => sum + p, 0);

  let discountPaise = 0;
  if (promoCode) {
    const { rows: promoRows } = await client.query<{
      kind: 'percent' | 'fixed';
      value: number;
    }>(
      `SELECT kind, value FROM promo_codes
         WHERE upper(code) = upper($1) AND is_active
           AND (starts_at IS NULL OR starts_at <= now())
           AND (ends_at IS NULL OR ends_at > now())`,
      [promoCode],
    );
    if (promoRows.length === 0) {
      throw new AppError('validation_failed', 'Invalid or expired promo code.');
    }
    const promo = promoRows[0]!;
    const rawDiscount =
      promo.kind === 'percent'
        ? Number((BigInt(roomPaise) * BigInt(promo.value)) / 10000n)
        : promo.value;
    discountPaise = Math.min(rawDiscount, roomPaise); // INV-32: a total can never go negative
  }

  const discountPerNight = allocateDiscount(pricePerNight, discountPaise);

  const nights: QuoteLineNight[] = pricePerNight.map((pricePaise, i) => {
    const discount = discountPerNight[i]!;
    const taxablePaise = pricePaise - discount;
    const taxRateBps = taxRateForUnitDay(taxablePaise, taxConfig);
    const taxPaise = taxForUnitDay(taxablePaise, taxRateBps);
    return {
      roomTypeId: roomTypeIdPerNight[i]!,
      stayDate: datePerNight[i]!,
      pricePaise,
      discountPaise: discount,
      taxablePaise,
      taxRateBps,
      taxPaise,
    };
  });

  const taxPaise = nights.reduce((sum, n) => sum + n.taxPaise, 0);
  const totalPaise = roomPaise - discountPaise + taxPaise;

  return {
    nights,
    roomPaise,
    discountPaise,
    taxPaise,
    totalPaise,
    taxConfigVersion: taxConfig.version,
    termsVersion,
  };
}
