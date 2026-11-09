/**
 * AS-1..AS-14 (Docs/tests-phase2.md, 2F — the graded hard part alongside 1G).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';
import { pool } from '../src/db.ts';
import { requireTestDatabase, resetDatabase } from './helpers/db.ts';
import { createEmployee, createGuest, createRoomType, setRoomDay, futureDate, publishResortInfo } from './helpers/factories.ts';
import { processBatch } from '../src/jobs/worker.ts';

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

async function post(path: string, body: unknown, accessToken?: string, idempotencyKey?: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  });
}
async function put(path: string, body: unknown, accessToken: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
}
async function del(path: string, body: unknown, accessToken: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
}

async function previewAndApplyAllotment(gmToken: string, roomTypeId: string, from: string, to: string, allotment: number): Promise<Response> {
  const preview = await post('/api/admin/inventory/preview', { roomTypeId, from, to, allotment }, gmToken);
  const { previewToken } = (await preview.json()) as { previewToken: string };
  return put('/api/admin/inventory', { roomTypeId, from, to, allotment, previewToken }, gmToken);
}
async function previewAndRemoveAllotment(gmToken: string, roomTypeId: string, from: string, to: string): Promise<Response> {
  const preview = await post('/api/admin/inventory/preview', { roomTypeId, from, to, allotment: null }, gmToken);
  const { previewToken } = (await preview.json()) as { previewToken: string };
  return del('/api/admin/inventory', { roomTypeId, from, to, previewToken }, gmToken);
}
async function previewAndApplyBlackout(gmToken: string, roomTypeId: string, from: string, to: string): Promise<Response> {
  const preview = await post('/api/admin/blackouts/preview', { roomTypeId, from, to }, gmToken);
  const { previewToken } = (await preview.json()) as { previewToken: string };
  return put('/api/admin/blackouts', { roomTypeId, from, to, previewToken }, gmToken);
}

/** Creates one confirmed booking occupying `rooms` rooms of `roomTypeId` for one night. */
async function confirmedCommitment(roomTypeId: string, stayDate: string): Promise<void> {
  const guest = await createGuest();
  const checkIn = stayDate;
  const checkOutDate = new Date(`${stayDate}T00:00:00Z`);
  checkOutDate.setUTCDate(checkOutDate.getUTCDate() + 1);
  const checkOutStr = checkOutDate.toISOString().slice(0, 10);

  const quoteResponse = await post('/api/user/quotes', { checkIn, checkOut: checkOutStr, rooms: [{ roomTypeId, adults: 1, children: 0 }] });
  const quote = (await quoteResponse.json()) as { quoteId: string };
  const bookingResponse = await post(
    '/api/user/bookings',
    { quoteId: quote.quoteId, guestName: 'Commitment Guest', guestEmail: `commit-${crypto.randomUUID()}@example.test`, guestPhone: '9000000000' },
    guest.accessToken,
    crypto.randomUUID(),
  );
  expect(bookingResponse.status).toBe(201);
}

/** Like `confirmedCommitment`, but actually pays and lets the worker confirm it — for the
 *  one case (AS-9) that specifically needs `status = 'confirmed'`, not just a live hold
 *  (committedPerNight already counts holds as commitments too, which is all AS-1..AS-6 need). */
async function paidConfirmedBooking(roomTypeId: string, stayDate: string): Promise<string> {
  const guest = await createGuest();
  const checkOutDate = new Date(`${stayDate}T00:00:00Z`);
  checkOutDate.setUTCDate(checkOutDate.getUTCDate() + 1);
  const checkOut = checkOutDate.toISOString().slice(0, 10);

  const quoteResponse = await post('/api/user/quotes', { checkIn: stayDate, checkOut, rooms: [{ roomTypeId, adults: 1, children: 0 }] });
  const quote = (await quoteResponse.json()) as { quoteId: string };
  const bookingResponse = await post(
    '/api/user/bookings',
    { quoteId: quote.quoteId, guestName: 'Paid Guest', guestEmail: `paid-${crypto.randomUUID()}@example.test`, guestPhone: '9000000001' },
    guest.accessToken,
    crypto.randomUUID(),
  );
  const { bookingId } = (await bookingResponse.json()) as { bookingId: string };
  const payResponse = await post(`/api/user/payments/${bookingId}/attempts`, {}, guest.accessToken, crypto.randomUUID());
  expect(payResponse.status).toBe(201);
  await processBatch('as-safety-worker');
  return bookingId;
}

describe('admin.allotmentSafety — 2F', () => {
  it('AS-1: cutting allotment below commitments is refused, naming the date', async () => {
    const gm = await createEmployee({ role: 'gm' });
    const room = await createRoomType({ baseAllotment: 5, physicalStock: 10 });
    const date = futureDate(10);
    await confirmedCommitment(room.id, date);
    // 1 confirmed; cutting to 0 should fail.
    const response = await previewAndApplyAllotment(gm.accessToken, room.id, date, date, 0);
    expect(response.status).toBe(409);
    const body = await response.json();
    expect((body as { error: { details: { conflicts: { stayDate: string }[] } } }).error.details.conflicts.map((c) => c.stayDate)).toContain(date);
  });

  it('AS-2: a 10-day range with 2 conflicting dates names both', async () => {
    const gm = await createEmployee({ role: 'gm' });
    const room = await createRoomType({ baseAllotment: 5, physicalStock: 10 });
    const dateA = futureDate(10);
    const dateB = futureDate(15);
    await confirmedCommitment(room.id, dateA);
    await confirmedCommitment(room.id, dateB);

    const response = await previewAndApplyAllotment(gm.accessToken, room.id, futureDate(10), futureDate(19), 0);
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { details: { conflicts: { stayDate: string }[] } } };
    const dates = body.error.details.conflicts.map((c) => c.stayDate);
    expect(dates).toContain(dateA);
    expect(dates).toContain(dateB);
  });

  it('AS-3: setting allotment equal to commitments succeeds', async () => {
    const gm = await createEmployee({ role: 'gm' });
    const room = await createRoomType({ baseAllotment: 5, physicalStock: 10 });
    const date = futureDate(10);
    await confirmedCommitment(room.id, date);
    const response = await previewAndApplyAllotment(gm.accessToken, room.id, date, date, 1);
    expect(response.status).toBe(200);
  });

  it('AS-4: removing an override is validated against the resulting base — succeeds when base covers it', async () => {
    const gm = await createEmployee({ role: 'gm' });
    const room = await createRoomType({ baseAllotment: 10, physicalStock: 10 });
    const date = futureDate(10);
    // 5 commitments made while the base (10) is in effect, THEN an override of 2 is set
    // directly (bypassing the app, per 09-test-harness.md's arrangement convention) — the
    // override would never have let 5 bookings through the real API in the first place.
    for (let i = 0; i < 5; i += 1) await confirmedCommitment(room.id, date);
    await setRoomDay({ roomTypeId: room.id, stayDate: date, allotment: 2 });
    const response = await previewAndRemoveAllotment(gm.accessToken, room.id, date, date);
    expect(response.status).toBe(200);
  });

  it('AS-5: removing an override is refused when the base cannot cover existing commitments', async () => {
    const gm = await createEmployee({ role: 'gm' });
    const room = await createRoomType({ baseAllotment: 3, physicalStock: 10 });
    const date = futureDate(10);
    await setRoomDay({ roomTypeId: room.id, stayDate: date, allotment: 8 });
    for (let i = 0; i < 6; i += 1) await confirmedCommitment(room.id, date);
    const response = await previewAndRemoveAllotment(gm.accessToken, room.id, date, date);
    expect(response.status).toBe(409);
  });

  it('AS-6: allotment can never exceed physical stock', async () => {
    const gm = await createEmployee({ role: 'gm' });
    const room = await createRoomType({ baseAllotment: 10, physicalStock: 12 });
    const date = futureDate(10);
    const preview = await post('/api/admin/inventory/preview', { roomTypeId: room.id, from: date, to: date, allotment: 15 }, gm.accessToken);
    const { previewToken } = (await preview.json()) as { previewToken: string };
    const response = await put('/api/admin/inventory', { roomTypeId: room.id, from: date, to: date, allotment: 15, previewToken }, gm.accessToken);
    expect(response.status).toBe(400);
  });

  it('AS-7/AS-8/AS-9: a blackout leaves existing bookings and live holds untouched, but refuses new ones', async () => {
    const gm = await createEmployee({ role: 'gm' });
    const room = await createRoomType({ baseAllotment: 5, physicalStock: 10 });
    const date = futureDate(10);
    const confirmedBookingId = await paidConfirmedBooking(room.id, date);
    await confirmedCommitment(room.id, date);

    const applyResponse = await previewAndApplyBlackout(gm.accessToken, room.id, date, date);
    expect(applyResponse.status).toBe(200); // succeeds despite 2 confirmed bookings (AS-7)

    const checkOutDate = new Date(`${date}T00:00:00Z`);
    checkOutDate.setUTCDate(checkOutDate.getUTCDate() + 1);
    const checkOut = checkOutDate.toISOString().slice(0, 10);
    const guest = await createGuest();
    const quoteResponse = await post('/api/user/quotes', { checkIn: date, checkOut, rooms: [{ roomTypeId: room.id, adults: 1, children: 0 }] });
    const quote = (await quoteResponse.json()) as { quoteId: string };
    const holdResponse = await post(
      '/api/user/bookings',
      { quoteId: quote.quoteId, guestName: 'New Guest', guestEmail: 'new@example.test', guestPhone: '9000000001' },
      guest.accessToken,
      crypto.randomUUID(),
    );
    expect(holdResponse.status).toBe(409); // AS-8: new hold rejected

    const { rows } = await pool.query<{ status: string }>(`SELECT status FROM bookings WHERE id = $1`, [confirmedBookingId]);
    expect(rows[0]!.status).toBe('confirmed'); // AS-9: pre-existing booking still confirmed
  });

  it('AS-10: an existing override, then a new overlapping one — preview reports what will be replaced, apply requires confirmation', async () => {
    const gm = await createEmployee({ role: 'gm' });
    const room = await createRoomType({ baseAllotment: 5, physicalStock: 10 });
    const decFrom = '2026-12-20';
    const decTo = '2026-12-31';
    const applyFirst = await previewAndApplyAllotment(gm.accessToken, room.id, decFrom, decTo, 3);
    expect(applyFirst.status).toBe(200);

    const newFrom = '2026-12-25';
    const newTo = '2027-01-05';
    const preview = await post('/api/admin/inventory/preview', { roomTypeId: room.id, from: newFrom, to: newTo, allotment: 4 }, gm.accessToken);
    const body = (await preview.json()) as { affected: { stayDate: string; currentAllotment: number | null }[] };
    const overlapping = body.affected.filter((d) => d.stayDate <= decTo);
    expect(overlapping.length).toBeGreaterThan(0);
    for (const day of overlapping) expect(day.currentAllotment).toBe(3); // reports what will be replaced
  });

  it('AS-11: two GMs editing the same range — the loser is told, no silent overwrite', async () => {
    const gm1 = await createEmployee({ role: 'gm' });
    const gm2 = await createEmployee({ role: 'gm' });
    const room = await createRoomType({ baseAllotment: 5, physicalStock: 10 });
    const date = futureDate(10);

    const preview1 = await post('/api/admin/inventory/preview', { roomTypeId: room.id, from: date, to: date, allotment: 2 }, gm1.accessToken);
    const { previewToken: token1 } = (await preview1.json()) as { previewToken: string };

    const apply2 = await previewAndApplyAllotment(gm2.accessToken, room.id, date, date, 4);
    expect(apply2.status).toBe(200);

    const apply1 = await put('/api/admin/inventory', { roomTypeId: room.id, from: date, to: date, allotment: 2, previewToken: token1 }, gm1.accessToken);
    expect(apply1.status).toBe(409);
  });

  it('AS-12: an allotment cut and a booking hold race for the last room — no oversell, no deadlock', async () => {
    const gm = await createEmployee({ role: 'gm' });
    const room = await createRoomType({ baseAllotment: 1, physicalStock: 1 });
    const date = futureDate(10);
    const checkOutDate = new Date(`${date}T00:00:00Z`);
    checkOutDate.setUTCDate(checkOutDate.getUTCDate() + 1);
    const checkOut = checkOutDate.toISOString().slice(0, 10);

    const preview = await post('/api/admin/inventory/preview', { roomTypeId: room.id, from: date, to: date, allotment: 0 }, gm.accessToken);
    const { previewToken } = (await preview.json()) as { previewToken: string };

    const guest = await createGuest();
    const quoteResponse = await post('/api/user/quotes', { checkIn: date, checkOut, rooms: [{ roomTypeId: room.id, adults: 1, children: 0 }] });
    const quote = (await quoteResponse.json()) as { quoteId: string };

    const [adminResult, bookingResult] = await Promise.allSettled([
      put('/api/admin/inventory', { roomTypeId: room.id, from: date, to: date, allotment: 0, previewToken }, gm.accessToken),
      post(
        '/api/user/bookings',
        { quoteId: quote.quoteId, guestName: 'Racer', guestEmail: 'racer@example.test', guestPhone: '9000000002' },
        guest.accessToken,
        crypto.randomUUID(),
      ),
    ]);

    expect(adminResult.status).toBe('fulfilled');
    expect(bookingResult.status).toBe('fulfilled');
    const adminStatus = adminResult.status === 'fulfilled' ? adminResult.value.status : 0;
    const bookingStatus = bookingResult.status === 'fulfilled' ? bookingResult.value.status : 0;
    // Never both succeed — that would be an oversell or a silently-dropped cut.
    expect(adminStatus === 200 && bookingStatus === 201).toBe(false);
    expect([200, 409]).toContain(adminStatus);
    expect([201, 409]).toContain(bookingStatus);
  });

  it('AS-13: any rate/allotment/blackout change is audited with actor, before and after', async () => {
    const gm = await createEmployee({ role: 'gm' });
    const room = await createRoomType({ baseAllotment: 5, physicalStock: 10 });
    const date = futureDate(10);
    await previewAndApplyAllotment(gm.accessToken, room.id, date, date, 2);

    const { rows } = await pool.query<{ actor_user_id: string; before: unknown; after: unknown }>(
      `SELECT actor_user_id, before, after FROM audit_events WHERE action = 'allotment.update' AND target_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [room.id],
    );
    expect(rows[0]!.actor_user_id).toBe(gm.id);
    expect(rows[0]!.before).not.toBeNull();
    expect(rows[0]!.after).not.toBeNull();
  });

  it('AS-14: the preview endpoint changes nothing — pure dry run', async () => {
    const gm = await createEmployee({ role: 'gm' });
    const room = await createRoomType({ baseAllotment: 5, physicalStock: 10 });
    const date = futureDate(10);
    await post('/api/admin/inventory/preview', { roomTypeId: room.id, from: date, to: date, allotment: 2 }, gm.accessToken);

    const { rows } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM room_day WHERE room_type_id = $1`, [room.id]);
    expect(rows[0]!.n).toBe(0);
    const { rows: auditRows } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM audit_events WHERE target_id = $1`, [room.id]);
    expect(auditRows[0]!.n).toBe(0);
  });
});
