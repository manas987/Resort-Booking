import { describe, it, expect, beforeEach } from 'bun:test';
import { pool } from '../src/db.ts';
import { requireTestDatabase, resetDatabase } from './helpers/db.ts';
import { createRoomType, setRoomDay, createPromo, publishResortInfo, futureDate } from './helpers/factories.ts';
import { calculateQuote, allocateDiscount, taxRateForUnitDay } from '../src/core/pricing.ts';

requireTestDatabase();

beforeEach(async () => {
  await resetDatabase();
  await publishResortInfo({ key: 'booking_terms', title: 'Terms', body: 'Standard booking terms.' });
});

describe('pricing.gst — 1B', () => {
  it('GST-1: Garden Suite at ₹7,200, 1 room 1 night → 5% bracket', async () => {
    const room = await createRoomType({ basePricePaise: 720000 });
    const checkIn = futureDate(10);
    const checkOut = futureDate(11);
    const result = await calculateQuote(pool, {
      stay: { checkIn, checkOut },
      rooms: [{ roomTypeId: room.id, adults: 1, children: 0 }],
    });
    expect(result.nights).toHaveLength(1);
    expect(result.nights[0]!.taxRateBps).toBe(500);
    expect(result.nights[0]!.taxPaise).toBe(36000);
    expect(result.totalPaise).toBe(756000);
  });

  it('GST-2: exactly ₹7,500 is still the low bracket — inclusive threshold (INV-4)', async () => {
    const room = await createRoomType({ basePricePaise: 750000 });
    const checkIn = futureDate(10);
    const checkOut = futureDate(11);
    const result = await calculateQuote(pool, {
      stay: { checkIn, checkOut },
      rooms: [{ roomTypeId: room.id, adults: 1, children: 0 }],
    });
    expect(result.nights[0]!.taxRateBps).toBe(500);
  });

  it('GST-3: ₹7,500 + 1 paise crosses into the high bracket', async () => {
    const room = await createRoomType({ basePricePaise: 750001 });
    const checkIn = futureDate(10);
    const checkOut = futureDate(11);
    const result = await calculateQuote(pool, {
      stay: { checkIn, checkOut },
      rooms: [{ roomTypeId: room.id, adults: 1, children: 0 }],
    });
    expect(result.nights[0]!.taxRateBps).toBe(1800);
  });

  it('GST-4: Plantation Cottage ₹9,500, 1 night → 18% bracket, tax ₹1,710', async () => {
    const room = await createRoomType({ basePricePaise: 950000 });
    const checkIn = futureDate(10);
    const checkOut = futureDate(11);
    const result = await calculateQuote(pool, {
      stay: { checkIn, checkOut },
      rooms: [{ roomTypeId: room.id, adults: 1, children: 0 }],
    });
    expect(result.nights[0]!.taxRateBps).toBe(1800);
    expect(result.nights[0]!.taxPaise).toBe(171000);
  });

  it('GST-5: a festival override crosses the bracket on one night only, not the average', async () => {
    const room = await createRoomType({ basePricePaise: 580000 });
    const checkIn = futureDate(24);
    const mid = futureDate(25);
    const checkOut = futureDate(26);
    await setRoomDay({ roomTypeId: room.id, stayDate: mid, pricePaise: 890000 });

    const result = await calculateQuote(pool, {
      stay: { checkIn, checkOut },
      rooms: [{ roomTypeId: room.id, adults: 1, children: 0 }],
    });
    expect(result.nights).toHaveLength(2);
    const [night1, night2] = result.nights as [typeof result.nights[0], typeof result.nights[0]];
    expect(night1.stayDate).toBe(checkIn);
    expect(night1.taxRateBps).toBe(500);
    expect(night2.stayDate).toBe(mid);
    expect(night2.taxRateBps).toBe(1800);
  });

  it('GST-6: a fixed promo can move a night across the bracket', async () => {
    const room = await createRoomType({ basePricePaise: 950000 });
    const checkIn = futureDate(10);
    const checkOut = futureDate(11);
    await createPromo({ code: 'MOVE', kind: 'fixed', value: 210000 });

    const result = await calculateQuote(pool, {
      stay: { checkIn, checkOut },
      rooms: [{ roomTypeId: room.id, adults: 1, children: 0 }],
      promoCode: 'MOVE',
    });
    expect(result.nights[0]!.taxablePaise).toBe(740000);
    expect(result.nights[0]!.taxRateBps).toBe(500);
    expect(result.nights[0]!.taxPaise).toBe(37000);
    expect(result.totalPaise).toBe(777000);
  });

  it('GST-7: a percent promo across two rooms and three nights allocates exactly (INV-5)', async () => {
    const roomA = await createRoomType({ basePricePaise: 400000 });
    const roomB = await createRoomType({ basePricePaise: 700000 });
    const checkIn = futureDate(10);
    const checkOut = futureDate(13); // 3 nights
    await createPromo({ code: 'TENOFF', kind: 'percent', value: 1000 }); // 10%

    const result = await calculateQuote(pool, {
      stay: { checkIn, checkOut },
      rooms: [
        { roomTypeId: roomA.id, adults: 1, children: 0 },
        { roomTypeId: roomB.id, adults: 1, children: 0 },
      ],
      promoCode: 'TENOFF',
    });

    const sumOfNightDiscounts = result.nights.reduce((sum, n) => sum + n.discountPaise, 0);
    expect(sumOfNightDiscounts).toBe(result.discountPaise);

    const highestPrice = Math.max(...result.nights.map((n) => n.pricePaise));
    const highestNight = result.nights.find((n) => n.pricePaise === highestPrice)!;
    const naiveShare = Math.floor((highestNight.pricePaise * result.discountPaise) / result.roomPaise);
    expect(highestNight.discountPaise).toBeGreaterThanOrEqual(naiveShare);
  });

  it('GST-8: an uneven discount split sums exactly to the input (pure)', () => {
    const shares = allocateDiscount([200000, 300000, 400000], 100000);
    expect(shares.reduce((sum, s) => sum + s, 0)).toBe(100000);
    expect(shares.every((s) => Number.isInteger(s))).toBe(true);
  });

  it('GST-9: a fixed promo larger than the room total floors at tax-on-zero (INV-32)', async () => {
    const room = await createRoomType({ basePricePaise: 500000 });
    const checkIn = futureDate(10);
    const checkOut = futureDate(11);
    await createPromo({ code: 'HUGE', kind: 'fixed', value: 5000000 });

    const result = await calculateQuote(pool, {
      stay: { checkIn, checkOut },
      rooms: [{ roomTypeId: room.id, adults: 1, children: 0 }],
      promoCode: 'HUGE',
    });
    expect(result.discountPaise).toBe(500000);
    expect(result.nights[0]!.taxablePaise).toBe(0);
    expect(result.nights[0]!.taxPaise).toBe(0);
    expect(result.totalPaise).toBe(0);
    expect(result.totalPaise).toBeGreaterThanOrEqual(0);
  });

  it('GST-10: an emptied tax_config fails the request loudly, never zero tax (INV-6)', async () => {
    const room = await createRoomType({ basePricePaise: 500000 });
    await pool.query('DELETE FROM tax_config');
    const checkIn = futureDate(10);
    const checkOut = futureDate(11);

    await expect(
      calculateQuote(pool, {
        stay: { checkIn, checkOut },
        rooms: [{ roomTypeId: room.id, adults: 1, children: 0 }],
      }),
    ).rejects.toThrow();
  });

  it('GST-11: an inverted tax bracket is rejected by the CHECK constraint', async () => {
    await expect(
      pool.query(
        `INSERT INTO tax_config (version, effective_from, threshold_paise, low_rate_bps, high_rate_bps, source_note)
         VALUES (99, now(), 750000, 1800, 500, 'inverted — must be rejected')`,
      ),
    ).rejects.toThrow();
  });

  it('GST-12: every amount in a quote is an integer and the totals reconcile', async () => {
    const roomA = await createRoomType({ basePricePaise: 333333 });
    const roomB = await createRoomType({ basePricePaise: 777777 });
    const checkIn = futureDate(10);
    const checkOut = futureDate(13);
    await createPromo({ code: 'ODD', kind: 'percent', value: 333 });

    const result = await calculateQuote(pool, {
      stay: { checkIn, checkOut },
      rooms: [
        { roomTypeId: roomA.id, adults: 1, children: 0 },
        { roomTypeId: roomB.id, adults: 1, children: 0 },
      ],
      promoCode: 'ODD',
    });

    for (const night of result.nights) {
      expect(Number.isInteger(night.pricePaise)).toBe(true);
      expect(Number.isInteger(night.discountPaise)).toBe(true);
      expect(Number.isInteger(night.taxablePaise)).toBe(true);
      expect(Number.isInteger(night.taxPaise)).toBe(true);
      expect(night.taxablePaise).toBe(night.pricePaise - night.discountPaise);
    }
    expect(result.totalPaise).toBe(result.roomPaise - result.discountPaise + result.taxPaise);
    expect(Number.isInteger(result.totalPaise)).toBe(true);
  });

  it('taxRateForUnitDay is pure and threshold-inclusive', () => {
    const config = { version: 1, thresholdPaise: 750000, lowRateBps: 500, highRateBps: 1800 };
    expect(taxRateForUnitDay(750000, config)).toBe(500);
    expect(taxRateForUnitDay(750001, config)).toBe(1800);
  });
});
