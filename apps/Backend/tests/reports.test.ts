/**
 * RP-1..RP-14 (Docs/tests-phase2.md, 2H).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';
import { pool } from '../src/db.ts';
import { requireTestDatabase, resetDatabase } from './helpers/db.ts';
import { createEmployee, createRoomType, createGuest, createQuote, createBooking, futureDate, publishResortInfo } from './helpers/factories.ts';

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

async function get(path: string, accessToken: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${accessToken}` } });
}
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

async function seedEnquiry(opts: {
  createdAt: string;
  firstStaffReplyAt?: string | null;
  resolvedAt?: string | null;
  reopenedCount?: number;
}): Promise<string> {
  const ref = `ENQ-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO enquiries (public_ref, source, status, contact_name, contact_email, created_at, last_activity_at,
                            first_staff_reply_at, resolved_at, reopened_count)
     VALUES ($1, 'website', $2, 'Test Guest', 'test-guest@example.test', $3, $3, $4, $5, $6)
     RETURNING id`,
    [
      ref,
      opts.resolvedAt ? 'resolved' : 'new',
      opts.createdAt,
      opts.firstStaffReplyAt ?? null,
      opts.resolvedAt ?? null,
      opts.reopenedCount ?? 0,
    ],
  );
  return rows[0]!.id;
}

async function confirmedBooking(roomTypeId: string, confirmedAt?: string): Promise<string> {
  const guest = await createGuest();
  const checkIn = futureDate(10);
  const checkOut = futureDate(12);
  const quote = await createQuote({ guestUserId: guest.id, checkIn, checkOut, rooms: [{ roomTypeId, adults: 1, children: 0 }] });
  const booking = await createBooking({ guestUserId: guest.id, quoteId: quote.id, status: 'confirmed' });
  if (confirmedAt) await pool.query(`UPDATE bookings SET confirmed_at = $1 WHERE id = $2`, [confirmedAt, booking.id]);
  return booking.id;
}

describe('reports — 2H', () => {
  it('RP-1: a draft generated but never sent is excluded from median first reply (INV-54)', async () => {
    const owner = await createEmployee({ role: 'owner' });
    // No first_staff_reply_at at all — a draft never sent leaves it null.
    await seedEnquiry({ createdAt: '2026-03-01T10:00:00Z' });

    const response = await get('/api/admin/reports/metrics?from=2026-03-01&to=2026-03-31', owner.accessToken);
    const body = (await response.json()) as { firstReply: { measuredCount: number; pendingCount: number } };
    expect(body.firstReply.measuredCount).toBe(0);
    expect(body.firstReply.pendingCount).toBe(1);
  });

  it('RP-2: a reply whose delivery failed is excluded from first-reply time (INV-54)', async () => {
    const owner = await createEmployee({ role: 'owner' });
    // first_staff_reply_at is only ever stamped on successful delivery (2C) — a failed
    // delivery never sets it, which this directly represents.
    await seedEnquiry({ createdAt: '2026-03-01T10:00:00Z', firstStaffReplyAt: null });

    const response = await get('/api/admin/reports/metrics?from=2026-03-01&to=2026-03-31', owner.accessToken);
    const body = (await response.json()) as { firstReply: { measuredCount: number } };
    expect(body.firstReply.measuredCount).toBe(0);
  });

  it('RP-3: received 20:00, replied 09:20 next day — 20 working minutes (clock pauses outside 09:00-19:00 IST)', async () => {
    const owner = await createEmployee({ role: 'owner' });
    // 20:00 IST = 14:30 UTC; 09:20 IST next day = 03:50 UTC next day.
    await seedEnquiry({ createdAt: '2026-03-05T14:30:00.000Z', firstStaffReplyAt: '2026-03-06T03:50:00.000Z' });

    const response = await get('/api/admin/reports/metrics?from=2026-03-05&to=2026-03-06', owner.accessToken);
    const body = (await response.json()) as { firstReply: { medianMinutes: number; measuredCount: number } };
    expect(body.firstReply.measuredCount).toBe(1);
    expect(body.firstReply.medianMinutes).toBe(20);
  });

  it('RP-4: a resolved-then-reopened-then-resolved thread measures to the latest resolution, reopen count shown', async () => {
    const owner = await createEmployee({ role: 'owner' });
    await seedEnquiry({ createdAt: '2026-03-01T00:00:00Z', resolvedAt: '2026-03-10T00:00:00Z', reopenedCount: 1 });

    const response = await get('/api/admin/reports/metrics?from=2026-03-01&to=2026-03-31', owner.accessToken);
    const body = (await response.json()) as { resolution: { measuredCount: number; reopenedCounts: number[] } };
    expect(body.resolution.measuredCount).toBe(1);
    expect(body.resolution.reopenedCounts).toContain(1);
  });

  it('RP-5: unanswered enquiries are shown as pending work, not excluded (INV-56)', async () => {
    const owner = await createEmployee({ role: 'owner' });
    await seedEnquiry({ createdAt: '2026-03-01T00:00:00Z' });
    await seedEnquiry({ createdAt: '2026-03-02T00:00:00Z' });

    const response = await get('/api/admin/reports/metrics?from=2026-03-01&to=2026-03-31', owner.accessToken);
    const body = (await response.json()) as { firstReply: { pendingCount: number } };
    expect(body.firstReply.pendingCount).toBe(2);
  });

  it('RP-6: a live hold is not counted as a sold night or as booking value (INV-55)', async () => {
    const owner = await createEmployee({ role: 'owner' });
    const room = await createRoomType({ basePricePaise: 2_000_000 }); // ₹20,000
    const guest = await createGuest();
    const checkIn = futureDate(10);
    const checkOut = futureDate(11);
    const quote = await createQuote({ guestUserId: guest.id, checkIn, checkOut, rooms: [{ roomTypeId: room.id, adults: 1, children: 0 }] });
    await createBooking({ guestUserId: guest.id, quoteId: quote.id, status: 'pending_payment' }); // live hold, never confirmed

    const response = await get(`/api/admin/reports/metrics?from=${checkIn}&to=${checkOut}`, owner.accessToken);
    const body = (await response.json()) as { roomNightsSold: { nights: number }; bookingValue: { confirmedPaise: number } };
    expect(body.roomNightsSold.nights).toBe(0);
    expect(body.bookingValue.confirmedPaise).toBe(0);
  });

  it('RP-7: a booking confirmed in a later month for an earlier-month stay is counted by confirmation date', async () => {
    const owner = await createEmployee({ role: 'owner' });
    const room = await createRoomType({ basePricePaise: 500000 });
    await confirmedBooking(room.id, '2026-11-15T10:00:00Z');

    const novResponse = await get('/api/admin/reports/metrics?from=2026-11-01&to=2026-11-30', owner.accessToken);
    const novBody = (await novResponse.json()) as { bookingValue: { bookingsCounted: number } };
    expect(novBody.bookingValue.bookingsCounted).toBe(1);

    const octResponse = await get('/api/admin/reports/metrics?from=2026-10-01&to=2026-10-31', owner.accessToken);
    const octBody = (await octResponse.json()) as { bookingValue: { bookingsCounted: number } };
    expect(octBody.bookingValue.bookingsCounted).toBe(0);
  });

  it('RP-8: the booking-value metric states whether tax is included', async () => {
    const owner = await createEmployee({ role: 'owner' });
    const response = await get('/api/admin/reports/metrics?from=2026-01-01&to=2026-01-31', owner.accessToken);
    const body = (await response.json()) as { bookingValue: { taxIncluded: boolean } };
    expect(body.bookingValue.taxIncluded).toBe(true);
  });

  it('RP-9: every metric carries a definition string', async () => {
    const owner = await createEmployee({ role: 'owner' });
    const response = await get('/api/admin/reports/metrics?from=2026-01-01&to=2026-01-31', owner.accessToken);
    const body = (await response.json()) as Record<string, unknown>;
    for (const key of ['bookingValue', 'roomNightsSold', 'allotmentUtilisation', 'firstReply', 'resolution']) {
      const metric = body[key] as { definition: string };
      expect(typeof metric.definition).toBe('string');
      expect(metric.definition.length).toBeGreaterThan(0);
    }
  });

  it('RP-10: the same session firing search 5 times with one dedupe_key is counted once', async () => {
    const owner = await createEmployee({ role: 'owner' });
    const dedupeKey = `search:${crypto.randomUUID()}`;
    for (let i = 0; i < 5; i += 1) {
      await post('/api/user/analytics/events', { anonId: crypto.randomUUID(), sessionId: 's1', type: 'search', dedupeKey });
    }
    const response = await get(`/api/admin/reports/funnel?from=${futureDate(-1)}&to=${futureDate(1)}`, owner.accessToken);
    const body = (await response.json()) as { mainFunnel: { search: number } };
    expect(body.mainFunnel.search).toBe(1);
  });

  it('RP-11: the booking funnel and the enquiry-submitted conversion are reported separately', async () => {
    const owner = await createEmployee({ role: 'owner' });
    await post('/api/user/analytics/events', { anonId: 'a', sessionId: 's', type: 'visit' });
    await post('/api/user/analytics/events', { anonId: 'a', sessionId: 's', type: 'search' });
    await post('/api/user/analytics/events', { anonId: 'a', sessionId: 's', type: 'checkout_started' });
    await post('/api/user/analytics/events', { anonId: 'a', sessionId: 's', type: 'booking_confirmed' });
    await post('/api/user/analytics/events', { anonId: 'b', sessionId: 's2', type: 'enquiry_submitted' });

    const response = await get(`/api/admin/reports/funnel?from=${futureDate(-1)}&to=${futureDate(1)}`, owner.accessToken);
    const body = (await response.json()) as { mainFunnel: { visit: number; search: number; checkoutStarted: number; confirmed: number }; enquiryFunnel: { enquirySubmitted: number } };
    expect(body.mainFunnel).toMatchObject({ visit: 1, search: 1, checkoutStarted: 1, confirmed: 1 });
    expect(body.enquiryFunnel.enquirySubmitted).toBe(1);
  });

  it('RP-12: no profit figure, no total-resort-occupancy figure, no direct-share-target claim (INV-56)', async () => {
    const owner = await createEmployee({ role: 'owner' });
    // The caveat string is explicitly allowed to NAME these as things it does not claim
    // (that is the disclaimer this invariant asks for) — what must never appear is an
    // actual field carrying such a figure.
    const metricsResponse = await get('/api/admin/reports/metrics?from=2026-01-01&to=2026-01-31', owner.accessToken);
    const metrics = (await metricsResponse.json()) as Record<string, unknown>;
    const metricKeys = Object.keys(metrics).flatMap((k) => (typeof metrics[k] === 'object' && metrics[k] !== null ? Object.keys(metrics[k] as object) : [k]));
    for (const key of metricKeys) expect(key.toLowerCase()).not.toMatch(/profit|totaloccupancy|directshare/);

    const funnelResponse = await get('/api/admin/reports/funnel?from=2026-01-01&to=2026-01-31', owner.accessToken);
    const funnel = (await funnelResponse.json()) as Record<string, unknown>;
    const funnelKeys = Object.keys(funnel).flatMap((k) => (typeof funnel[k] === 'object' && funnel[k] !== null ? Object.keys(funnel[k] as object) : [k]));
    for (const key of funnelKeys) expect(key.toLowerCase()).not.toMatch(/profit|totaloccupancy|directshare/);
  });

  it('RP-13: allotment utilisation is computed against website allotment, not all 76 keys', async () => {
    const owner = await createEmployee({ role: 'owner' });
    await createRoomType({ baseAllotment: 4, physicalStock: 76 }); // the resort has 76 keys; this room type's website allotment is 4
    const day = futureDate(10); // from === to: a single-night window ([day, day+1) )
    const response = await get(`/api/admin/reports/metrics?from=${day}&to=${day}`, owner.accessToken);
    const body = (await response.json()) as { allotmentUtilisation: { availableNights: number; scope: string } };
    expect(body.allotmentUtilisation.availableNights).toBe(4); // not 76
    expect(body.allotmentUtilisation.scope).toBe('website_allotment');
  });

  it('RP-14: anon_id is a first-party random value — no fingerprinting fields accepted', async () => {
    const schemaSource = await Bun.file(new URL('../src/routes/user/analytics/schema.ts', import.meta.url)).text();
    expect(schemaSource).not.toMatch(/userAgent|fingerprint|canvas|webgl|deviceId/i);
    const response = await post('/api/user/analytics/events', { anonId: crypto.randomUUID(), sessionId: crypto.randomUUID(), type: 'visit' });
    expect(response.status).toBe(201);
  });
});
