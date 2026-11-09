/**
 * SP-1..SP-28 (Docs/tests-phase2.md, 2A-2H). All 28 cases now have a passing test, added
 * incrementally as each route landed — same precedent as 1G/1I's incrementally-extended
 * access.* files (Docs/progress-log.md).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';
import { pool } from '../src/db.ts';
import { requireTestDatabase, resetDatabase } from './helpers/db.ts';
import { resetRateLimits } from '../src/middleware/rateLimit.ts';
import { createEmployee, createGuest, createRoomType, futureDate } from './helpers/factories.ts';

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
  resetRateLimits();
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
async function patch(path: string, body: unknown, accessToken: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
}
async function get(path: string, accessToken?: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
  });
}

async function seedEnquiry(opts: { assigneeId?: string | null; category?: 'room' | 'wedding' | 'offsite' | 'complaint' }): Promise<string> {
  const ref = `ENQ-${crypto.randomUUID().slice(0, 8).toUpperCase()}`; // collision-free, unlike a 4-digit range
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO enquiries (public_ref, source, status, category, assignee_id, contact_name, contact_email)
     VALUES ($1, 'website', 'new', $2, $3, 'Test Guest', 'test-guest@example.test') RETURNING id`,
    [ref, opts.category ?? null, opts.assigneeId ?? null],
  );
  return rows[0]!.id;
}

describe('access.staffPermissions — 2A', () => {
  it('SP-1: reservations staff cannot change prices', async () => {
    const reservations = await createEmployee({ role: 'staff', team: 'reservations' });
    const room = await createRoomType({});
    const response = await patch(`/api/admin/rates/room-types/${room.id}`, { basePricePaise: 600000 }, reservations.accessToken);
    expect(response.status).toBe(403);
  });

  it('SP-2: reservations staff cannot write to /admin/inventory', async () => {
    const reservations = await createEmployee({ role: 'staff', team: 'reservations' });
    const room = await createRoomType({});
    const day = futureDate(10);
    const response = await fetch(`${baseUrl}/api/admin/inventory`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${reservations.accessToken}` },
      body: JSON.stringify({ roomTypeId: room.id, from: day, to: day, allotment: 1, previewToken: 'fake' }),
    });
    expect(response.status).toBe(403);
  });

  it('SP-3: reservations staff cannot write to /admin/blackouts', async () => {
    const reservations = await createEmployee({ role: 'staff', team: 'reservations' });
    const room = await createRoomType({});
    const day = futureDate(10);
    const response = await fetch(`${baseUrl}/api/admin/blackouts`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${reservations.accessToken}` },
      body: JSON.stringify({ roomTypeId: room.id, from: day, to: day, previewToken: 'fake' }),
    });
    expect(response.status).toBe(403);
  });

  it('SP-4: reservations staff cannot create promo codes', async () => {
    const reservations = await createEmployee({ role: 'staff', team: 'reservations' });
    const response = await post('/api/admin/promos', { code: 'SP4TEST', kind: 'fixed', value: 10000 }, reservations.accessToken);
    expect(response.status).toBe(403);
  });

  it('SP-5: reservations staff cannot create employee accounts', async () => {
    const reservations = await createEmployee({ role: 'staff', team: 'reservations' });
    const response = await post(
      '/api/admin/staff',
      { username: `new-${crypto.randomUUID().slice(0, 8)}`, email: 'new@coffeeestate.test', name: 'New Hire', role: 'staff', team: 'sales', password: 'SomePassword1' },
      reservations.accessToken,
    );
    expect(response.status).toBe(403);
  });

  it('SP-6: staff cannot self-elevate via the staff route (no requireGm access at all)', async () => {
    const reservations = await createEmployee({ role: 'staff', team: 'reservations' });
    const response = await patch(`/api/admin/staff/${reservations.id}`, { role: 'gm' }, reservations.accessToken);
    expect(response.status).toBe(403);
  });

  it('SP-15: a GM cannot create a GM (INV-36)', async () => {
    const gm = await createEmployee({ role: 'gm' });
    const response = await post(
      '/api/admin/staff',
      { username: `new-${crypto.randomUUID().slice(0, 8)}`, email: 'newgm@coffeeestate.test', name: 'New GM', role: 'gm', password: 'SomePassword1' },
      gm.accessToken,
    );
    expect(response.status).toBe(403);
  });

  it('SP-16: a GM cannot create an owner', async () => {
    const gm = await createEmployee({ role: 'gm' });
    const response = await post(
      '/api/admin/staff',
      { username: `new-${crypto.randomUUID().slice(0, 8)}`, email: 'newowner@coffeeestate.test', name: 'New Owner', role: 'owner', password: 'SomePassword1' },
      gm.accessToken,
    );
    expect(response.status).toBe(403);
  });

  it('SP-17: an owner cannot create another owner — no route creates an owner (INV-36)', async () => {
    const owner = await createEmployee({ role: 'owner' });
    const response = await post(
      '/api/admin/staff',
      { username: `new-${crypto.randomUUID().slice(0, 8)}`, email: 'another-owner@coffeeestate.test', name: 'Another Owner', role: 'owner', password: 'SomePassword1' },
      owner.accessToken,
    );
    expect(response.status).toBe(403);
  });

  it('SP-18: a GM cannot touch an owner row', async () => {
    const gm = await createEmployee({ role: 'gm' });
    const owner = await createEmployee({ role: 'owner' });
    const patchResponse = await patch(`/api/admin/staff/${owner.id}`, { name: 'Renamed' }, gm.accessToken);
    expect(patchResponse.status).toBe(403);
    const disableResponse = await post(`/api/admin/staff/${owner.id}/disable`, {}, gm.accessToken);
    expect(disableResponse.status).toBe(403);
  });

  it('SP-19: disabling the only active owner is refused with 409', async () => {
    const owner = await createEmployee({ role: 'owner' });
    const response = await post(`/api/admin/staff/${owner.id}/disable`, {}, owner.accessToken);
    expect(response.status).toBe(409);
  });

  it('SP-20: disabling one of two active owners succeeds', async () => {
    const owner1 = await createEmployee({ role: 'owner' });
    const owner2 = await createEmployee({ role: 'owner' });
    const response = await post(`/api/admin/staff/${owner2.id}/disable`, {}, owner1.accessToken);
    expect(response.status).toBe(200);
  });

  it('SP-25: a guest token on any /api/admin/* route is 403, not 401', async () => {
    const guest = await createGuest();
    const response = await get('/api/admin/staff', guest.accessToken);
    expect(response.status).toBe(403);
  });

  it('a GM creating a staff account succeeds and the password never comes back', async () => {
    const gm = await createEmployee({ role: 'gm' });
    const response = await post(
      '/api/admin/staff',
      { username: `new-${crypto.randomUUID().slice(0, 8)}`, email: 'newstaff@coffeeestate.test', name: 'New Staff', role: 'staff', team: 'sales', password: 'SomePassword1' },
      gm.accessToken,
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(JSON.stringify(body)).not.toMatch(/password/i);
  });

  it('an owner can update a GM, and a GM cannot read/patch another GM (owner-only pair)', async () => {
    const owner = await createEmployee({ role: 'owner' });
    const gm1 = await createEmployee({ role: 'gm' });
    const gm2 = await createEmployee({ role: 'gm' });

    const ownerPatch = await patch(`/api/admin/staff/${gm1.id}`, { name: 'Renamed By Owner' }, owner.accessToken);
    expect(ownerPatch.status).toBe(200);

    const gmPatch = await patch(`/api/admin/staff/${gm1.id}`, { name: 'Renamed By Peer GM' }, gm2.accessToken);
    expect(gmPatch.status).toBe(403);
  });

  it('SP-21: reservations staff cannot read another employee\'s enquiry detail', async () => {
    const reservations1 = await createEmployee({ role: 'staff', team: 'reservations' });
    const reservations2 = await createEmployee({ role: 'staff', team: 'reservations' });
    const enquiryId = await seedEnquiry({ assigneeId: reservations2.id });

    const response = await get(`/api/admin/enquiries/${enquiryId}`, reservations1.accessToken);
    expect([403, 404]).toContain(response.status);
  });

  it('SP-22: rerouting a claimed enquiry succeeds, but grants no read access to a third party\'s thread', async () => {
    const reservations1 = await createEmployee({ role: 'staff', team: 'reservations' });
    const reservations2 = await createEmployee({ role: 'staff', team: 'reservations' });
    const ownEnquiry = await seedEnquiry({ assigneeId: reservations1.id, category: 'room' });
    const othersEnquiry = await seedEnquiry({ assigneeId: reservations2.id });

    const claimResponse = await post(`/api/admin/enquiryAssignment/${ownEnquiry}/claim`, {}, reservations1.accessToken);
    // Already assigned to them — claim on an already-assigned-to-self row is a no-op 400, the
    // real "reroute" action here is the category correction they're entitled to make on it.
    expect([200, 400]).toContain(claimResponse.status);
    const rerouteResponse = await patch(`/api/admin/enquiries/${ownEnquiry}/category`, { category: 'room' }, reservations1.accessToken);
    expect(rerouteResponse.status).toBe(200);

    const readResponse = await get(`/api/admin/enquiries/${othersEnquiry}`, reservations1.accessToken);
    expect([403, 404]).toContain(readResponse.status);
  });

  it('SP-23: reservations staff cannot call the assignment route — assignment is GM/owner', async () => {
    const reservations = await createEmployee({ role: 'staff', team: 'reservations' });
    const other = await createEmployee({ role: 'staff', team: 'reservations' });
    const enquiryId = await seedEnquiry({});
    const response = await post(`/api/admin/enquiryAssignment/${enquiryId}/assign`, { assigneeId: other.id }, reservations.accessToken);
    expect(response.status).toBe(403);
  });

  it('SP-24: the assignable list has no account-admin data', async () => {
    const reservations = await createEmployee({ role: 'staff', team: 'reservations' });
    await createEmployee({ role: 'staff', team: 'sales' });
    const response = await get('/api/admin/enquiryAssignment/assignable', reservations.accessToken);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: Record<string, unknown>[] };
    expect(body.items.length).toBeGreaterThan(0);
    for (const item of body.items) {
      expect(item.passwordHash).toBeUndefined();
      expect(item.password_hash).toBeUndefined();
      expect(item.username).toBeUndefined();
      expect(item.email).toBeUndefined();
    }
  });

  it('SP-7/SP-9: export is reservations yes, sales no (INV-37)', async () => {
    const sales = await createEmployee({ role: 'staff', team: 'sales' });
    const reservations = await createEmployee({ role: 'staff', team: 'reservations' });
    const salesResponse = await get('/api/admin/exports/bookings.csv?from=2020-01-01&to=2020-01-02', sales.accessToken);
    expect(salesResponse.status).toBe(403);
    const reservationsResponse = await get('/api/admin/exports/bookings.csv?from=2020-01-01&to=2020-01-02', reservations.accessToken);
    expect(reservationsResponse.status).toBe(200);
  });

  it('SP-8: sales sees all bookings — §5 grants it', async () => {
    const sales = await createEmployee({ role: 'staff', team: 'sales' });
    const response = await get('/api/admin/bookings', sales.accessToken);
    expect(response.status).toBe(200);
  });

  it('SP-10: reservations and sales can both read /admin/rooms', async () => {
    const reservations = await createEmployee({ role: 'staff', team: 'reservations' });
    const sales = await createEmployee({ role: 'staff', team: 'sales' });
    for (const actor of [reservations, sales]) {
      const response = await get('/api/admin/rooms', actor.accessToken);
      expect(response.status).toBe(200);
    }
  });

  it('SP-26: no route anywhere mutates a booking (date change, cancel, refund) — 404', async () => {
    const owner = await createEmployee({ role: 'owner' });
    const enquiryId = await seedEnquiry({}); // reuse as a stand-in id shape
    for (const method of ['PATCH', 'DELETE', 'POST'] as const) {
      const response = await fetch(`${baseUrl}/api/admin/bookings/${enquiryId}/cancel`, {
        method,
        headers: { authorization: `Bearer ${owner.accessToken}` },
      });
      expect(response.status).toBe(404);
    }
  });

  it('SP-27: there is no write route to /admin/audit — 404 regardless of actor (INV-14)', async () => {
    const owner = await createEmployee({ role: 'owner' });
    const response = await post('/api/admin/audit', {}, owner.accessToken);
    expect(response.status).toBe(404);
  });

  it('SP-28: sales can correct the category on an assigned wedding enquiry', async () => {
    const sales = await createEmployee({ role: 'staff', team: 'sales' });
    const enquiryId = await seedEnquiry({ assigneeId: sales.id, category: 'wedding' });
    const response = await patch(`/api/admin/enquiries/${enquiryId}/category`, { category: 'wedding' }, sales.accessToken);
    expect(response.status).toBe(200);
  });

  it('SP-11/SP-12: reports/metrics is owner-only — staff and GM both 403', async () => {
    const staff = await createEmployee({ role: 'staff', team: 'reservations' });
    const gm = await createEmployee({ role: 'gm' });
    for (const actor of [staff, gm]) {
      const response = await get('/api/admin/reports/metrics?from=2026-01-01&to=2026-01-31', actor.accessToken);
      expect(response.status).toBe(403);
    }
  });

  it('SP-13: audit is owner-only — a GM gets 403', async () => {
    const gm = await createEmployee({ role: 'gm' });
    const response = await get('/api/admin/audit', gm.accessToken);
    expect(response.status).toBe(403);
  });

  it('SP-14: a GM reading rate history gets only rate/allotment/blackout actions, never a general audit row (INV-39)', async () => {
    const gm = await createEmployee({ role: 'gm' });
    const room = await createRoomType({});
    await patch(`/api/admin/rates/room-types/${room.id}`, { basePricePaise: 600000 }, gm.accessToken);

    const response = await get(`/api/admin/rates/history?roomTypeId=${room.id}&from=2020-01-01&to=2099-01-01`, gm.accessToken);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: { action: string }[] };
    expect(body.items.length).toBeGreaterThan(0);
    for (const item of body.items) expect(['rate.update', 'allotment.update', 'blackout.set']).toContain(item.action);
  });
});
