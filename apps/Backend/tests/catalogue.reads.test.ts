/**
 * CR-1..CR-13 (Docs/tests-phase1.md, 1E).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';
import { pool } from '../src/db.ts';
import { requireTestDatabase, resetDatabase } from './helpers/db.ts';
import {
  createRoomType,
  futureDate,
  publishResortInfo,
  createGuest,
  createQuote,
  createBooking,
} from './helpers/factories.ts';

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

async function addPhoto(roomTypeId: string, isCover: boolean): Promise<void> {
  await pool.query(
    `INSERT INTO room_photos (room_type_id, alt, width, height, variants, is_cover)
     VALUES ($1, 'Room photo', 1200, 800, '[{"w":640,"format":"avif","url":"https://example.com/a.avif"}]', $2)`,
    [roomTypeId, isCover],
  );
}

describe('catalogue.reads — 1E', () => {
  it('CR-1: GET /rooms returns cover photo, summary, amenities, inclusions, capacity and a labelled "from" price', async () => {
    const room = await createRoomType({ inclusions: ['Breakfast'] });
    await pool.query(`UPDATE room_types SET amenities = $1 WHERE id = $2`, [['Wifi', 'AC'], room.id]);
    await addPhoto(room.id, true);

    const response = await get('/api/user/rooms');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { rooms: Array<Record<string, unknown>> };
    const listed = body.rooms.find((r) => r.id === room.id)!;
    expect(listed.coverPhoto).not.toBeNull();
    expect(listed.amenities).toEqual(['Wifi', 'AC']);
    expect(listed.inclusions).toEqual(['Breakfast']);
    expect(listed.maxAdults).toBeDefined();
    expect(listed.fromPricePaise).toBe(room.basePricePaise);
  });

  it('CR-2: GET /rooms/:slug keeps inclusions and amenities as separate arrays', async () => {
    const room = await createRoomType({ slug: 'cr2-room', inclusions: ['Estate walk'] });
    await pool.query(`UPDATE room_types SET amenities = $1 WHERE id = $2`, [['Wifi'], room.id]);

    const response = await get('/api/user/rooms/cr2-room');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { amenities: string[]; inclusions: string[] };
    expect(body.inclusions).toEqual(['Estate walk']);
    expect(body.amenities).toEqual(['Wifi']);
    expect(body.inclusions).not.toEqual(body.amenities);
  });

  it('CR-3: an inactive room type is absent from GET /rooms', async () => {
    await createRoomType({ isActive: false });
    const response = await get('/api/user/rooms');
    const body = (await response.json()) as { rooms: Array<Record<string, unknown>> };
    expect(body.rooms).toHaveLength(0);
  });

  it('CR-4: GET /rooms/:slug with an unknown slug is a 404 with the standard envelope', async () => {
    const response = await get('/api/user/rooms/does-not-exist');
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe('not_found');
    expect(body.error.requestId).toBeTruthy();
  });

  it('CR-5: GET /availability with no dates is a 400', async () => {
    const response = await get('/api/user/availability');
    expect(response.status).toBe(400);
  });

  it('CR-6: checkOut before checkIn is a 400', async () => {
    const response = await get(`/api/user/availability?checkIn=${futureDate(11)}&checkOut=${futureDate(10)}`);
    expect(response.status).toBe(400);
  });

  it('CR-7: a check-in 400 days out is a 400 (365-day horizon)', async () => {
    const response = await get(
      `/api/user/availability?checkIn=${futureDate(400)}&checkOut=${futureDate(401)}`,
    );
    expect(response.status).toBe(400);
  });

  it('CR-8: occupancy exceeding every room type returns rooms marked unavailable with a reason', async () => {
    await createRoomType({ maxAdults: 2, maxOccupancy: 3 });
    const response = await get(
      `/api/user/availability?checkIn=${futureDate(10)}&checkOut=${futureDate(11)}&adults=20&rooms=1`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { rooms: Array<{ available: boolean; reason?: string }> };
    expect(body.rooms.length).toBeGreaterThan(0);
    for (const room of body.rooms) {
      expect(room.available).toBe(false);
      expect(room.reason).toBe('occupancy');
    }
  });

  it('CR-9: a fully committed night shows 0 remaining and a sold-out state', async () => {
    const room = await createRoomType({ baseAllotment: 1, physicalStock: 1 });
    const checkIn = futureDate(10);
    const checkOut = futureDate(11);
    const guest = await createGuest();
    const quote = await createQuote({
      checkIn,
      checkOut,
      rooms: [{ roomTypeId: room.id, adults: 1, children: 0 }],
    });
    await createBooking({ guestUserId: guest.id, quoteId: quote.id, status: 'confirmed' });

    const response = await get(`/api/user/availability?checkIn=${checkIn}&checkOut=${checkOut}`);
    const body = (await response.json()) as {
      rooms: Array<{ roomTypeId: string; available: boolean; reason?: string; remaining: number }>;
    };
    const listed = body.rooms.find((r) => r.roomTypeId === room.id)!;
    expect(listed.remaining).toBe(0);
    expect(listed.available).toBe(false);
    expect(listed.reason).toBe('sold_out');
  });

  it('CR-10: GET /availability is never cached', async () => {
    const response = await get(`/api/user/availability?checkIn=${futureDate(10)}&checkOut=${futureDate(11)}`);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('CR-11: a newly published resort_info version is served immediately', async () => {
    await publishResortInfo({ key: 'faq', title: 'FAQ v1', body: 'First version.' });
    const first = await get('/api/user/content');
    const firstBody = (await first.json()) as { content: Array<{ key: string; version: number }> };
    const v1 = firstBody.content.find((c) => c.key === 'faq')!.version;

    await publishResortInfo({ key: 'faq', title: 'FAQ v2', body: 'Second version.' });
    const second = await get('/api/user/content');
    const secondBody = (await second.json()) as { content: Array<{ key: string; title: string; version: number }> };
    const v2 = secondBody.content.find((c) => c.key === 'faq')!;
    expect(v2.version).toBe(v1 + 1);
    expect(v2.title).toBe('FAQ v2');
  });

  it('CR-12: GET /content includes booking_terms and its version', async () => {
    const response = await get('/api/user/content');
    const body = (await response.json()) as { content: Array<{ key: string; version: number }> };
    const terms = body.content.find((c) => c.key === 'booking_terms');
    expect(terms).toBeDefined();
    expect(terms!.version).toBeGreaterThanOrEqual(1);
  });

  it('CR-13: no catalogue response leaks physical stock, allotment or audit data', async () => {
    const room = await createRoomType({ physicalStock: 42, baseAllotment: 7 });
    const rooms = await get('/api/user/rooms');
    const roomsText = await rooms.text();
    expect(roomsText).not.toMatch(/physical_stock|physicalStock|base_allotment|baseAllotment|audit/i);

    const detail = await get(`/api/user/rooms/${room.slug}`);
    const detailText = await detail.text();
    expect(detailText).not.toMatch(/physical_stock|physicalStock|base_allotment|baseAllotment|audit/i);

    const availability = await get(
      `/api/user/availability?checkIn=${futureDate(10)}&checkOut=${futureDate(11)}`,
    );
    const availabilityText = await availability.text();
    expect(availabilityText).not.toMatch(/physical_stock|physicalStock|base_allotment|baseAllotment|audit/i);
  });
});
