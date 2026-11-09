/**
 * CR-14..CR-19 (Docs/tests-phase1.md, 1E/3B) — GET /api/user/availability/calendar.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';
import { requireTestDatabase, resetDatabase } from './helpers/db.ts';
import { createRoomType, createGuest, createQuote, createBooking, setRoomDay, futureDate, publishResortInfo } from './helpers/factories.ts';

requireTestDatabase();

let baseUrl: string;
let server: ReturnType<ReturnType<typeof createApp>['listen']>;

beforeAll(() => {
  const app = createApp();
  server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server.close();
});

beforeEach(async () => {
  await resetDatabase();
  await publishResortInfo({ key: 'booking_terms', title: 'Terms', body: 'Standard booking terms.' });
});

async function get(path: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`);
}

describe('availability.calendar — 3B', () => {
  it('CR-14: one row per date; a sold-out night and a blackout night are both distinguished', async () => {
    const room = await createRoomType({ slug: 'cr14-room', baseAllotment: 1, physicalStock: 1 });
    const from = futureDate(10);
    const soldOut = futureDate(11);
    const blackout = futureDate(12);
    const open = futureDate(13);
    const to = futureDate(14);

    const guest = await createGuest();
    const quote = await createQuote({
      checkIn: soldOut,
      checkOut: open,
      rooms: [{ roomTypeId: room.id, adults: 1, children: 0 }],
    });
    await createBooking({ guestUserId: guest.id, quoteId: quote.id, status: 'confirmed' });
    await setRoomDay({ roomTypeId: room.id, stayDate: blackout, isBlackout: true });

    const response = await get(`/api/user/availability/calendar?slug=${room.slug}&from=${from}&to=${to}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { slug: string; days: Array<{ date: string; remaining: number; isBlackout: boolean; pricePaise: number }> };
    expect(body.slug).toBe(room.slug);
    // from..to is checkout-exclusive, same convention as every other stay range (00-conventions.md).
    expect(body.days.map((d) => d.date)).toEqual([from, soldOut, blackout, open]);

    const soldOutDay = body.days.find((d) => d.date === soldOut)!;
    expect(soldOutDay.remaining).toBe(0);
    expect(soldOutDay.isBlackout).toBe(false);

    const blackoutDay = body.days.find((d) => d.date === blackout)!;
    expect(blackoutDay.remaining).toBe(0);
    expect(blackoutDay.isBlackout).toBe(true);

    const openDay = body.days.find((d) => d.date === open)!;
    expect(openDay.remaining).toBe(1);
  });

  it('CR-15: a room_day price override on one date is reflected only on that date', async () => {
    const room = await createRoomType({ slug: 'cr15-room', basePricePaise: 500000 });
    const from = futureDate(10);
    const overridden = futureDate(11);
    const to = futureDate(13);
    await setRoomDay({ roomTypeId: room.id, stayDate: overridden, pricePaise: 890000 });

    const response = await get(`/api/user/availability/calendar?slug=${room.slug}&from=${from}&to=${to}`);
    const body = (await response.json()) as { days: Array<{ date: string; pricePaise: number }> };
    expect(body.days.find((d) => d.date === overridden)!.pricePaise).toBe(890000);
    expect(body.days.find((d) => d.date === from)!.pricePaise).toBe(500000);
  });

  it('CR-16: a 63-day window is rejected (62-day cap)', async () => {
    const room = await createRoomType({ slug: 'cr16-room' });
    const from = futureDate(10);
    const to = futureDate(10 + 63);
    const response = await get(`/api/user/availability/calendar?slug=${room.slug}&from=${from}&to=${to}`);
    expect(response.status).toBe(400);
  });

  it('CR-17: to before from is a 400', async () => {
    const room = await createRoomType({ slug: 'cr17-room' });
    const response = await get(
      `/api/user/availability/calendar?slug=${room.slug}&from=${futureDate(11)}&to=${futureDate(10)}`,
    );
    expect(response.status).toBe(400);
  });

  it('CR-18: an unknown or inactive slug is a 404', async () => {
    const missing = await get(
      `/api/user/availability/calendar?slug=does-not-exist&from=${futureDate(10)}&to=${futureDate(11)}`,
    );
    expect(missing.status).toBe(404);

    const inactive = await createRoomType({ slug: 'cr18-inactive', isActive: false });
    const response = await get(
      `/api/user/availability/calendar?slug=${inactive.slug}&from=${futureDate(10)}&to=${futureDate(11)}`,
    );
    expect(response.status).toBe(404);
  });

  it('CR-19: the response is never cached', async () => {
    const room = await createRoomType({ slug: 'cr19-room' });
    const response = await get(
      `/api/user/availability/calendar?slug=${room.slug}&from=${futureDate(10)}&to=${futureDate(11)}`,
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
