/**
 * AN-1..AN-9 (Docs/tests-phase1.md, 1J). `runSeeds` is exercised against TEST_DATABASE_URL
 * here, never DATABASE_URL — `src/db.ts` already points `pool` at TEST_DATABASE_URL whenever
 * NODE_ENV=test, so this is the same safety the rest of the suite relies on, not a special
 * case for seeds.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';
import { pool } from '../src/db.ts';
import { requireTestDatabase, resetDatabase } from './helpers/db.ts';
import { runSeeds } from '../seeds/run.ts';
import { SUPPLIED_ENQUIRIES } from '../seeds/data/enquiries.ts';

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
});

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('analytics.seeds — 1J', () => {
  it('AN-1: a fresh session posting a visit event produces one row with a random anon_id', async () => {
    const response = await post('/api/user/analytics/events', {
      anonId: crypto.randomUUID(),
      sessionId: crypto.randomUUID(),
      type: 'visit',
    });
    expect(response.status).toBe(201);
    const { rows } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM analytics_events WHERE type = 'visit'`);
    expect(rows[0]!.n).toBe(1);
  });

  it('AN-2: the same dedupe_key posted 5 times produces one row', async () => {
    const dedupeKey = `visit:${crypto.randomUUID()}`;
    for (let i = 0; i < 5; i += 1) {
      await post('/api/user/analytics/events', {
        anonId: crypto.randomUUID(),
        sessionId: crypto.randomUUID(),
        type: 'visit',
        dedupeKey,
      });
    }
    const { rows } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM analytics_events WHERE dedupe_key = $1`, [dedupeKey]);
    expect(rows[0]!.n).toBe(1);
  });

  it('AN-3: an unknown event type is a 400 — types come from a fixed enum', async () => {
    const response = await post('/api/user/analytics/events', {
      anonId: crypto.randomUUID(),
      sessionId: crypto.randomUUID(),
      type: 'definitely_not_a_real_type',
    });
    expect(response.status).toBe(400);
  });

  it('AN-4: an oversized payload is 413 — bounded like every other body', async () => {
    const response = await fetch(`${baseUrl}/api/user/analytics/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        anonId: crypto.randomUUID(),
        sessionId: crypto.randomUUID(),
        type: 'visit',
        payload: { blob: 'x'.repeat(100_000) },
      }),
    });
    expect(response.status).toBe(413);
  });

  it('AN-5: the seeded ENQ-4410/4411/4412 are present with their original message text byte-for-byte', async () => {
    await runSeeds({ force: true });
    for (const fixture of SUPPLIED_ENQUIRIES) {
      const { rows } = await pool.query<{ id: string }>(`SELECT id FROM enquiries WHERE public_ref = $1`, [fixture.publicRef]);
      expect(rows).toHaveLength(1);
      const { rows: messages } = await pool.query<{ body: string }>(
        `SELECT body FROM enquiry_messages WHERE enquiry_id = $1 AND direction = 'inbound' ORDER BY created_at LIMIT 1`,
        [rows[0]!.id],
      );
      expect(messages[0]!.body).toBe(fixture.message);
    }
  });

  it('AN-6: every §26 fixture is present', async () => {
    await runSeeds({ force: true });

    const { rows: roomTypes } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM room_types`);
    expect(roomTypes[0]!.n).toBe(4);

    const { rows: festival } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM room_day WHERE price_paise IS NOT NULL`,
    );
    expect(festival[0]!.n).toBeGreaterThan(0);
    const { rows: blackout } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM room_day WHERE is_blackout`);
    expect(blackout[0]!.n).toBeGreaterThan(0);
    const { rows: soldOutOverride } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM room_day WHERE allotment = 0`);
    expect(soldOutOverride[0]!.n).toBeGreaterThan(0);

    const { rows: statuses } = await pool.query<{ status: string; n: number }>(
      `SELECT status, count(*)::int AS n FROM bookings GROUP BY status`,
    );
    const byStatus = Object.fromEntries(statuses.map((s) => [s.status, s.n]));
    expect(byStatus.confirmed).toBeGreaterThan(0);
    expect(byStatus.payment_failed ?? byStatus.pending_payment).toBeGreaterThan(0);
    expect(byStatus.expired).toBeGreaterThan(0);

    const { rows: refunds } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM refunds`);
    expect(refunds[0]!.n).toBeGreaterThan(0);

    const { rows: promoRedemptions } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM promo_redemptions pr
         JOIN promo_codes pc ON pc.id = pr.promo_id
        WHERE pc.code = 'ESTATE2' AND pr.state = 'consumed'`,
    );
    expect(promoRedemptions[0]!.n).toBe(2); // at its cap

    const { rows: mixedRoomBooking } = await pool.query<{ n: number }>(
      `SELECT count(DISTINCT booking_id)::int AS n FROM booking_rooms GROUP BY booking_id HAVING count(*) > 1`,
    );
    expect(mixedRoomBooking.length).toBeGreaterThan(0);

    const { rows: categories } = await pool.query<{ category: string | null; n: number }>(
      `SELECT category, count(*)::int AS n FROM enquiries GROUP BY category`,
    );
    const categoryCounts = Object.fromEntries(categories.map((c) => [c.category ?? 'null', c.n]));
    expect(categoryCounts.null).toBeGreaterThan(0); // unassigned/unclassified present
    const { rows: lowConfidence } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM enquiries WHERE needs_review`);
    expect(lowConfidence[0]!.n).toBeGreaterThan(0);
    const { rows: complaints } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM enquiries WHERE is_complaint`);
    expect(complaints[0]!.n).toBeGreaterThan(0);
    const { rows: aiFailures } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM enquiries WHERE ai_status = 'failed'`);
    expect(aiFailures[0]!.n).toBeGreaterThan(0);
    const { rows: reopened } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM enquiries WHERE reopened_count > 0`);
    expect(reopened[0]!.n).toBeGreaterThan(0);

    const { rows: disabledStaff } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM users WHERE kind = 'employee' AND is_active = false`,
    );
    expect(disabledStaff[0]!.n).toBeGreaterThan(0);
    const { rows: reassigned } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM enquiry_events WHERE type = 'unassigned'`,
    );
    expect(reassigned[0]!.n).toBeGreaterThan(0);

    const { rows: reservationsAndSales } = await pool.query<{ team: string; n: number }>(
      `SELECT team, count(*)::int AS n FROM users WHERE kind = 'employee' AND role = 'staff' GROUP BY team`,
    );
    expect(reservationsAndSales.map((r) => r.team).sort()).toEqual(['reservations', 'sales']);

    const { rows: analytics } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM analytics_events`);
    expect(analytics[0]!.n).toBeGreaterThan(0);
  });

  it('AN-7: bun run seed refuses a non-empty database without --force', async () => {
    await runSeeds({ force: true }); // first run — empty database, succeeds
    await expect(runSeeds()).rejects.toThrow(); // second run — non-empty, no force — refused
  });

  it('AN-8: no real personal data — grep the fixtures for anything that is not fictional', async () => {
    // Every seeded email must sit under the reserved `.test` TLD (RFC 2606), which can never
    // resolve or be registered — that is the actual rule, and it is what makes the fixtures
    // safe. It used to enumerate two specific domains, which failed the moment the reviewer
    // identity `demo@resort.test` was seeded: an address fixed by DEMO_DESTINATIONS in
    // src/routes/user/auth/otp.ts, equally fictional, and the only one DEMO_MODE will reveal an
    // OTP for. Widened to the rule rather than renaming that address, because the address is
    // not ours to choose.
    await runSeeds({ force: true });
    const { rows } = await pool.query<{ email: string | null }>(`SELECT email FROM users WHERE email IS NOT NULL`);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.email).toMatch(/@[a-z0-9-]+(\.[a-z0-9-]+)*\.test$/);
    }
  });

  it('AN-9: the seeded reviewer flows do not depend on an empty database', async () => {
    await runSeeds({ force: true });
    // A guest flow (browsing rooms) works exactly the same whether or not seed data exists —
    // it is a read against room_types, not a count of zero rows.
    const response = await fetch(`${baseUrl}/api/user/rooms`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { rooms: unknown[] };
    expect(body.rooms.length).toBeGreaterThan(0);
  });
});
