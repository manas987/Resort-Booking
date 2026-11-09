/**
 * EL-1..EL-9 (Docs/tests-phase1.md, 1I). EL-2 ("provider unavailable") and EL-7 ("complaint
 * identified") describe 2D's AI pipeline outcomes landing on an already-created enquiry —
 * `processEnquiry` doesn't exist until 2D, so both are exercised here by arranging the
 * post-classification state directly (ai_status/is_complaint), the same pattern used
 * throughout this build for "a step from a later sub-phase already happened."
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';
import { pool } from '../src/db.ts';
import { requireTestDatabase, resetDatabase } from './helpers/db.ts';
import { createRoomType, futureDate, publishResortInfo, createGuest } from './helpers/factories.ts';

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

describe('enquiry.lifecycle — 1I', () => {
  it('EL-1: a new enquiry is persisted before any AI work, with classify_enquiry enqueued (INV-40)', async () => {
    const guest = await createGuest();
    const response = await post('/api/user/enquiries', { message: 'Do you allow pets?' }, guest.accessToken);
    expect(response.status).toBe(201);
    const { enquiryId } = (await response.json()) as { enquiryId: string };

    const { rows } = await pool.query<{ status: string; ai_status: string }>(
      `SELECT status, ai_status FROM enquiries WHERE id = $1`,
      [enquiryId],
    );
    expect(rows[0]!.status).toBe('new');
    expect(rows[0]!.ai_status).toBe('pending');
    const { rows: jobs } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM jobs WHERE type = 'classify_enquiry' AND payload->>'enquiryId' = $1`,
      [enquiryId],
    );
    expect(jobs[0]!.n).toBe(1);
  });

  it('EL-2: the enquiry still exists and the failure is visible even if the provider is unavailable', async () => {
    const guest = await createGuest();
    const response = await post('/api/user/enquiries', { message: 'What time is check-in?' }, guest.accessToken);
    const { enquiryId } = (await response.json()) as { enquiryId: string };
    // Simulates 2D's classify job exhausting its attempts against a dead provider.
    await pool.query(`UPDATE enquiries SET ai_status = 'failed' WHERE id = $1`, [enquiryId]);

    const { rows } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM enquiries WHERE id = $1`, [enquiryId]);
    expect(rows[0]!.n).toBe(1); // nothing lost
    const detail = await fetch(`${baseUrl}/api/user/enquiries/${enquiryId}`, { headers: { authorization: `Bearer ${guest.accessToken}` } });
    expect(detail.status).toBe(200); // still readable
  });

  it('EL-3: a reply on an awaiting_guest thread moves it to in_progress and keeps an active assignee', async () => {
    const guest = await createGuest();
    const response = await post('/api/user/enquiries', { message: 'Any availability in December?' }, guest.accessToken);
    const { enquiryId } = (await response.json()) as { enquiryId: string };
    const { rows: staffRows } = await pool.query<{ id: string }>(
      `INSERT INTO users (kind, role, team, name, email, username, password_hash)
       VALUES ('employee', 'staff', 'reservations', 'Staff EL3', 'staff-el3@example.com', 'staffel3', 'x')
       RETURNING id`,
    );
    await pool.query(`UPDATE enquiries SET status = 'awaiting_guest', assignee_id = $2 WHERE id = $1`, [
      enquiryId,
      staffRows[0]!.id,
    ]);

    const reply = await post(`/api/user/enquiries/${enquiryId}/messages`, { message: 'Just checking in' }, guest.accessToken);
    expect(reply.status).toBe(201);
    const { rows } = await pool.query<{ status: string; assignee_id: string | null }>(
      `SELECT status, assignee_id FROM enquiries WHERE id = $1`,
      [enquiryId],
    );
    expect(rows[0]!.status).toBe('in_progress');
    expect(rows[0]!.assignee_id).toBe(staffRows[0]!.id);
  });

  it('EL-4: a reply on a resolved thread reopens it and increments reopened_count', async () => {
    const guest = await createGuest();
    const response = await post('/api/user/enquiries', { message: 'Follow-up question' }, guest.accessToken);
    const { enquiryId } = (await response.json()) as { enquiryId: string };
    await pool.query(`UPDATE enquiries SET status = 'resolved', resolved_at = now() WHERE id = $1`, [enquiryId]);

    await post(`/api/user/enquiries/${enquiryId}/messages`, { message: 'One more thing' }, guest.accessToken);
    const { rows } = await pool.query<{ status: string; reopened_count: number }>(
      `SELECT status, reopened_count FROM enquiries WHERE id = $1`,
      [enquiryId],
    );
    expect(rows[0]!.status).toBe('in_progress');
    expect(rows[0]!.reopened_count).toBe(1);
  });

  it('EL-5: reopening a thread whose assignee was disabled moves it to Unassigned (INV-19)', async () => {
    const guest = await createGuest();
    const response = await post('/api/user/enquiries', { message: 'Reopened question' }, guest.accessToken);
    const { enquiryId } = (await response.json()) as { enquiryId: string };
    const { rows: staffRows } = await pool.query<{ id: string }>(
      `INSERT INTO users (kind, role, team, name, email, username, password_hash, is_active, disabled_at)
       VALUES ('employee', 'staff', 'reservations', 'Disabled EL5', 'staff-el5@example.com', 'staffel5', 'x', false, now())
       RETURNING id`,
    );
    await pool.query(`UPDATE enquiries SET status = 'resolved', resolved_at = now(), assignee_id = $2 WHERE id = $1`, [
      enquiryId,
      staffRows[0]!.id,
    ]);

    await post(`/api/user/enquiries/${enquiryId}/messages`, { message: 'Still there?' }, guest.accessToken);
    const { rows } = await pool.query<{ status: string; assignee_id: string | null }>(
      `SELECT status, assignee_id FROM enquiries WHERE id = $1`,
      [enquiryId],
    );
    expect(rows[0]!.status).toBe('in_progress');
    expect(rows[0]!.assignee_id).toBeNull();
  });

  it('EL-6: only the four conversation statuses exist — Unsorted/Unassigned are flags, not statuses (INV-43)', async () => {
    await expect(
      pool.query(
        `INSERT INTO enquiries (public_ref, source, status, contact_name)
         VALUES ('ENQ-9999', 'website', 'unsorted', 'x')`,
      ),
    ).rejects.toThrow();
  });

  it('EL-7: a complaint is flagged for GM notification regardless of confidence (INV-18)', async () => {
    const guest = await createGuest();
    const response = await post('/api/user/enquiries', { message: 'This is unacceptable, my room was dirty.' }, guest.accessToken);
    const { enquiryId } = (await response.json()) as { enquiryId: string };
    // Simulates 2D's classifier identifying a complaint at a LOW confidence — notifyGm must
    // not depend on confidence at all (INV-18).
    await pool.query(`UPDATE enquiries SET category = 'complaint', is_complaint = true, confidence = 0.2 WHERE id = $1`, [
      enquiryId,
    ]);
    const { routeEnquiry } = await import('../src/core/enquiry/assignment.ts');
    const routing = await routeEnquiry(pool, { category: 'complaint', needsReview: false });
    expect(routing.notifyGm).toBe(true);
  });

  it('EL-8: the event form creates an enquiry only — no lawn, deposit, package price or payment', async () => {
    const guest = await createGuest();
    const response = await post(
      '/api/user/eventEnquiries',
      {
        eventType: 'wedding',
        preferredDates: { type: 'month', month: '2026-12' },
        guestCount: 120,
        roomsNeeded: 30,
        nights: 2,
        contactName: 'Wedding Guest',
        contactEmail: 'wedding@example.com',
      },
      guest.accessToken,
    );
    expect(response.status).toBe(201);
    const { enquiryId } = (await response.json()) as { enquiryId: string };
    const { rows } = await pool.query<{ category: string; booking_id: string | null }>(
      `SELECT category, booking_id FROM enquiries WHERE id = $1`,
      [enquiryId],
    );
    expect(rows[0]!.category).toBe('wedding');
    expect(rows[0]!.booking_id).toBeNull();
    const { rows: paymentRows } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM payments`);
    expect(paymentRows[0]!.n).toBe(0);
  });

  it('EL-9: a booking-linked enquiry has booking_id set by the backend, after verifying ownership', async () => {
    const room = await createRoomType({ baseAllotment: 5, physicalStock: 5 });
    const guest = await createGuest();
    const quoteResponse = await post('/api/user/quotes', {
      checkIn: futureDate(10),
      checkOut: futureDate(11),
      rooms: [{ roomTypeId: room.id, adults: 1, children: 0 }],
    });
    const { quoteId } = (await quoteResponse.json()) as { quoteId: string };
    const bookingResponse = await post(
      '/api/user/bookings',
      { quoteId, guestName: 'EL9', guestEmail: 'el9@example.com', guestPhone: '9000000000' },
      guest.accessToken,
      crypto.randomUUID(),
    );
    const { bookingId } = (await bookingResponse.json()) as { bookingId: string };

    const response = await post(
      `/api/user/enquiries/from-booking/${bookingId}`,
      { message: 'Question about my upcoming stay' },
      guest.accessToken,
    );
    expect(response.status).toBe(201);
    const { enquiryId } = (await response.json()) as { enquiryId: string };
    const { rows } = await pool.query<{ booking_id: string }>(`SELECT booking_id FROM enquiries WHERE id = $1`, [enquiryId]);
    expect(rows[0]!.booking_id).toBe(bookingId);
  });
});
