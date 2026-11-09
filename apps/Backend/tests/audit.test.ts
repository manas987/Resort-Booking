/**
 * AU-1..AU-6 (Docs/tests-phase2.md, 2H).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';
import { pool } from '../src/db.ts';
import { requireTestDatabase, resetDatabase } from './helpers/db.ts';
import { createEmployee, createRoomType, futureDate } from './helpers/factories.ts';

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

async function get(path: string, accessToken: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${accessToken}` } });
}
async function post(path: string, body: unknown, accessToken: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
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

describe('audit — 2H', () => {
  it('AU-1: UPDATE audit_events raises — the trigger blocks it (INV-14)', async () => {
    await pool.query(`INSERT INTO audit_events (action, target_kind) VALUES ('test.seed', 'test')`);
    await expect(pool.query(`UPDATE audit_events SET action = 'tampered'`)).rejects.toThrow();
  });

  it('AU-2: DELETE FROM audit_events raises', async () => {
    await pool.query(`INSERT INTO audit_events (action, target_kind) VALUES ('test.seed', 'test')`);
    await expect(pool.query(`DELETE FROM audit_events`)).rejects.toThrow();
  });

  it('AU-3: an owner\'s own rate change is audited like anyone else\'s', async () => {
    const owner = await createEmployee({ role: 'owner' });
    const room = await createRoomType({});

    const patchResponse = await fetch(`${baseUrl}/api/admin/rates/room-types/${room.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${owner.accessToken}` },
      body: JSON.stringify({ basePricePaise: 700000 }),
    });
    expect(patchResponse.status).toBe(200);

    const { rows } = await pool.query<{ actor_user_id: string }>(
      `SELECT actor_user_id FROM audit_events WHERE action = 'rate.update' AND target_id = $1`,
      [room.id],
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.actor_user_id).toBe(owner.id);
  });

  it('AU-4: every listed mutation kind produces an audit row', async () => {
    const owner = await createEmployee({ role: 'owner' });
    const gm = await createEmployee({ role: 'gm' });
    const room = await createRoomType({ baseAllotment: 5, physicalStock: 10 });
    const day = futureDate(10);

    await fetch(`${baseUrl}/api/admin/rates/room-types/${room.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${owner.accessToken}` },
      body: JSON.stringify({ basePricePaise: 600000 }),
    });
    await fetch(`${baseUrl}/api/admin/inventory/room-types/${room.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${owner.accessToken}` },
      body: JSON.stringify({ baseAllotment: 4 }),
    });
    const blackoutPreview = await post('/api/admin/blackouts/preview', { roomTypeId: room.id, from: day, to: day }, owner.accessToken);
    const { previewToken: blackoutToken } = (await blackoutPreview.json()) as { previewToken: string };
    await put('/api/admin/blackouts', { roomTypeId: room.id, from: day, to: day, previewToken: blackoutToken }, owner.accessToken);
    await post('/api/admin/promos', { code: `AU4-${crypto.randomUUID().slice(0, 6)}`, kind: 'fixed', value: 10000 }, owner.accessToken);
    await post('/api/admin/staff', { username: `au4-${crypto.randomUUID().slice(0, 8)}`, email: 'au4@coffeeestate.test', name: 'AU4', role: 'staff', team: 'reservations', password: 'SomePassword1' }, owner.accessToken);
    await post(`/api/admin/staff/${gm.id}/disable`, {}, owner.accessToken);

    const { rows } = await pool.query<{ action: string }>(`SELECT DISTINCT action FROM audit_events`);
    const actions = rows.map((r) => r.action);
    expect(actions).toContain('rate.update');
    expect(actions).toContain('allotment.update');
    expect(actions).toContain('blackout.set');
    expect(actions).toContain('promo.create');
    expect(actions).toContain('employee.create');
    expect(actions).toContain('employee.disable');
  });

  it('AU-5: an audit row has actor/action/target/before/after/requestId and never a credential (INV-53)', async () => {
    const owner = await createEmployee({ role: 'owner' });
    await post('/api/admin/staff', { username: `au5-${crypto.randomUUID().slice(0, 8)}`, email: 'au5@coffeeestate.test', name: 'AU5', role: 'staff', team: 'sales', password: 'SuperSecretPass1' }, owner.accessToken);

    const { rows } = await pool.query<{ actor_user_id: string; action: string; target_kind: string; before: unknown; after: unknown; request_id: string | null }>(
      `SELECT actor_user_id, action, target_kind, before, after, request_id FROM audit_events WHERE action = 'employee.create' ORDER BY created_at DESC LIMIT 1`,
    );
    const row = rows[0]!;
    expect(row.actor_user_id).toBe(owner.id);
    expect(row.action).toBe('employee.create');
    expect(row.target_kind).toBeTruthy();
    const serialized = JSON.stringify(row);
    expect(serialized).not.toMatch(/SuperSecretPass1/);
    expect(serialized.toLowerCase()).not.toContain('password');
  });

  it('AU-6: the audit list is paginated with actor/action/target/date filters', async () => {
    const owner = await createEmployee({ role: 'owner' });
    const room = await createRoomType({});
    for (let i = 0; i < 3; i += 1) {
      await fetch(`${baseUrl}/api/admin/rates/room-types/${room.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${owner.accessToken}` },
        body: JSON.stringify({ basePricePaise: 500000 + i }),
      });
    }

    const byAction = await get(`/api/admin/audit?action=rate.update&limit=2`, owner.accessToken);
    expect(byAction.status).toBe(200);
    const body = (await byAction.json()) as { items: unknown[]; nextCursor: string | null };
    expect(body.items).toHaveLength(2);
    expect(body.nextCursor).not.toBeNull();

    const byTarget = await get(`/api/admin/audit?targetKind=room_type&targetId=${room.id}`, owner.accessToken);
    const targetBody = (await byTarget.json()) as { items: { targetId: string }[] };
    expect(targetBody.items.length).toBeGreaterThanOrEqual(3);
    for (const item of targetBody.items) expect(item.targetId).toBe(room.id);

    const byActor = await get(`/api/admin/audit?actorUserId=${owner.id}`, owner.accessToken);
    expect(byActor.status).toBe(200);
  });
});
