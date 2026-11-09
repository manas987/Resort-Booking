/**
 * No case list exists for 1F in Docs/tests-phase1.md — the GST brackets are already covered
 * by pricing.gst.test.ts (1B); this exercises the HTTP layer and the ownership model that
 * Docs/10-phase1-backend-guest.md's 1F section spells out in prose (quote ownership, expiry
 * reporting, booking-time-only promo validation).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';
import { pool } from '../src/db.ts';
import { requireTestDatabase, resetDatabase } from './helpers/db.ts';
import { createRoomType, futureDate, publishResortInfo, createGuest, createPromo } from './helpers/factories.ts';

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

async function post(path: string, body: unknown, accessToken?: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function get(path: string, accessToken?: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
  });
}

describe('quotes and promos — 1F', () => {
  it('a signed-out quote has a null guest_user_id', async () => {
    const room = await createRoomType();
    const response = await post('/api/user/quotes', {
      checkIn: futureDate(10),
      checkOut: futureDate(11),
      rooms: [{ roomTypeId: room.id, adults: 1, children: 0 }],
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { quoteId: string };
    const { rows } = await pool.query<{ guest_user_id: string | null }>(
      `SELECT guest_user_id FROM quotes WHERE id = $1`,
      [body.quoteId],
    );
    expect(rows[0]!.guest_user_id).toBeNull();
  });

  it('a signed-in quote is stamped with the principal', async () => {
    const room = await createRoomType();
    const guest = await createGuest();
    const response = await post(
      '/api/user/quotes',
      {
        checkIn: futureDate(10),
        checkOut: futureDate(11),
        rooms: [{ roomTypeId: room.id, adults: 1, children: 0 }],
      },
      guest.accessToken,
    );
    const body = (await response.json()) as { quoteId: string };
    const { rows } = await pool.query<{ guest_user_id: string | null }>(
      `SELECT guest_user_id FROM quotes WHERE id = $1`,
      [body.quoteId],
    );
    expect(rows[0]!.guest_user_id).toBe(guest.id);
  });

  it('a signed-out visitor can read a quote they just created, and then claim it signed in', async () => {
    const room = await createRoomType();
    const create = await post('/api/user/quotes', {
      checkIn: futureDate(10),
      checkOut: futureDate(11),
      rooms: [{ roomTypeId: room.id, adults: 1, children: 0 }],
    });
    const { quoteId } = (await create.json()) as { quoteId: string };

    const anonymousRead = await get(`/api/user/quotes/${quoteId}`);
    expect(anonymousRead.status).toBe(200);

    const guest = await createGuest();
    const signedInRead = await get(`/api/user/quotes/${quoteId}`, guest.accessToken);
    expect(signedInRead.status).toBe(200); // NULL-owned quotes are claimable once signed in
  });

  it('a quote owned by a different guest is 404, never 403 (INV-34)', async () => {
    const room = await createRoomType();
    const owner = await createGuest();
    const create = await post(
      '/api/user/quotes',
      { checkIn: futureDate(10), checkOut: futureDate(11), rooms: [{ roomTypeId: room.id, adults: 1, children: 0 }] },
      owner.accessToken,
    );
    const { quoteId } = (await create.json()) as { quoteId: string };

    const stranger = await createGuest();
    const response = await get(`/api/user/quotes/${quoteId}`, stranger.accessToken);
    expect(response.status).toBe(404);
  });

  it('GET /quotes/:quoteId reports expiry; a refresh never extends it', async () => {
    const room = await createRoomType();
    const create = await post('/api/user/quotes', {
      checkIn: futureDate(10),
      checkOut: futureDate(11),
      rooms: [{ roomTypeId: room.id, adults: 1, children: 0 }],
    });
    const { quoteId } = (await create.json()) as { quoteId: string };
    await pool.query(`UPDATE quotes SET expires_at = now() - interval '1 second' WHERE id = $1`, [quoteId]);

    const first = await get(`/api/user/quotes/${quoteId}`);
    const second = await get(`/api/user/quotes/${quoteId}`);
    expect((await first.json() as { expired: boolean; expiresAt: string }).expired).toBe(true);
    const secondBody = (await second.json()) as { expired: boolean; expiresAt: string };
    expect(secondBody.expired).toBe(true);
  });

  it('a stay already in the past cannot be priced — the lower half of the booking horizon', async () => {
    // `GET /availability` has always refused a past window; the quote endpoint did not, so a
    // stay that had already happened could be priced and then sold (Docs/03-decisions.md,
    // "Booking horizon"). Both halves of the window now live on both endpoints.
    const room = await createRoomType();
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 30);
    const checkIn = yesterday.toISOString().slice(0, 10);
    const checkOut = new Date(yesterday.getTime() + 86_400_000).toISOString().slice(0, 10);

    const response = await post('/api/user/quotes', {
      checkIn,
      checkOut,
      rooms: [{ roomTypeId: room.id, adults: 1, children: 0 }],
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string; details: { issues: Array<{ message: string }> } } };
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.details.issues.map((i) => i.message)).toContain('checkIn cannot be in the past.');

    const { rows } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM quotes`);
    expect(rows[0]!.n).toBe(0);
  });

  it('occupancy is validated per room — spare capacity elsewhere never excuses it', async () => {
    const small = await createRoomType({ maxAdults: 2, maxOccupancy: 3 });
    const spacious = await createRoomType({ maxAdults: 4, maxChildren: 2, maxOccupancy: 6 });
    const response = await post('/api/user/quotes', {
      checkIn: futureDate(10),
      checkOut: futureDate(11),
      rooms: [
        { roomTypeId: small.id, adults: 3, children: 0 },
        { roomTypeId: spacious.id, adults: 1, children: 0 },
      ],
    });
    expect(response.status).toBe(400);
  });

  it('POST /promos/validate accepts a currently-valid code and reserves nothing', async () => {
    await createPromo({ code: 'SAVE10', kind: 'percent', value: 1000 });
    const response = await post('/api/user/promos/validate', { code: 'save10' });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { valid: boolean; kind: string; value: number };
    expect(body).toEqual({ valid: true, kind: 'percent', value: 1000 });
    const { rows } = await pool.query(`SELECT * FROM promo_redemptions`);
    expect(rows).toHaveLength(0);
  });

  it('POST /promos/validate rejects a code outside its booking-time window', async () => {
    await createPromo({
      code: 'EXPIRED',
      kind: 'fixed',
      value: 10000,
      startsAt: futureDate(-30),
      endsAt: futureDate(-1),
    });
    const response = await post('/api/user/promos/validate', { code: 'EXPIRED' });
    const body = (await response.json()) as { valid: boolean };
    expect(body.valid).toBe(false);
  });

  it('POST /promos/validate rejects an unknown code', async () => {
    const response = await post('/api/user/promos/validate', { code: 'NOSUCHCODE' });
    const body = (await response.json()) as { valid: boolean };
    expect(body.valid).toBe(false);
  });
});
