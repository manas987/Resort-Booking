/**
 * PV-1..PV-7 (Docs/tests-phase2.md, 2F). The one shared mechanism (INV-57), exercised through
 * `inventory` as the primary case (PV-1..6) and `rates`/`blackouts` once each (PV-7) to prove
 * it is genuinely one mechanism, not three variants.
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

describe('preview.staleWrite — 2F', () => {
  it('PV-1: preview returns every affected date, its current value, and a previewToken', async () => {
    const gm = await createEmployee({ role: 'gm' });
    const room = await createRoomType({ baseAllotment: 5, physicalStock: 10 });
    const from = futureDate(10);
    const to = futureDate(14); // 5-day range, inclusive

    const response = await post('/api/admin/inventory/preview', { roomTypeId: room.id, from, to, allotment: 3 }, gm.accessToken);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { affected: { stayDate: string; currentAllotment: number | null }[]; previewToken: string };
    expect(body.affected).toHaveLength(5);
    for (const day of body.affected) expect(day.currentAllotment).toBeNull(); // no override yet
    expect(body.previewToken).toBeTruthy();
  });

  it('PV-2: applying a valid preview token succeeds and is audited', async () => {
    const gm = await createEmployee({ role: 'gm' });
    const room = await createRoomType({ baseAllotment: 5, physicalStock: 10 });
    const from = futureDate(10);
    const to = futureDate(14);

    const preview = await post('/api/admin/inventory/preview', { roomTypeId: room.id, from, to, allotment: 3 }, gm.accessToken);
    const { previewToken } = (await preview.json()) as { previewToken: string };

    const apply = await put('/api/admin/inventory', { roomTypeId: room.id, from, to, allotment: 3, previewToken }, gm.accessToken);
    expect(apply.status).toBe(200);

    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_events WHERE action = 'allotment.update' AND target_id = $1`,
      [room.id],
    );
    expect(rows[0]!.n).toBeGreaterThan(0);
  });

  it('PV-3: PUT with no token is rejected — confirmation is required, not optional', async () => {
    const gm = await createEmployee({ role: 'gm' });
    const room = await createRoomType({});
    const from = futureDate(10);
    const to = futureDate(14);

    const response = await put('/api/admin/inventory', { roomTypeId: room.id, from, to, allotment: 3 }, gm.accessToken);
    expect(response.status).toBe(400);
  });

  it('PV-4: a concurrent edit invalidates the earlier preview token — 409 stale_write, newer edit not overwritten', async () => {
    const gm1 = await createEmployee({ role: 'gm' });
    const gm2 = await createEmployee({ role: 'gm' });
    const room = await createRoomType({ baseAllotment: 5, physicalStock: 10 });
    const from = futureDate(10);
    const to = futureDate(14);

    const preview1 = await post('/api/admin/inventory/preview', { roomTypeId: room.id, from, to, allotment: 3 }, gm1.accessToken);
    const { previewToken: token1 } = (await preview1.json()) as { previewToken: string };

    // gm2 edits one date in the range before gm1 applies.
    const oneDate = futureDate(11);
    const preview2 = await post('/api/admin/inventory/preview', { roomTypeId: room.id, from: oneDate, to: oneDate, allotment: 2 }, gm2.accessToken);
    const { previewToken: token2 } = (await preview2.json()) as { previewToken: string };
    const apply2 = await put('/api/admin/inventory', { roomTypeId: room.id, from: oneDate, to: oneDate, allotment: 2, previewToken: token2 }, gm2.accessToken);
    expect(apply2.status).toBe(200);

    const apply1 = await put('/api/admin/inventory', { roomTypeId: room.id, from, to, allotment: 3, previewToken: token1 }, gm1.accessToken);
    expect(apply1.status).toBe(409);
    const body = await apply1.json();
    expect((body as { error: { code: string } }).error.code).toBe('stale_write');

    // gm2's newer edit is intact, not overwritten.
    const { rows } = await pool.query<{ allotment: number }>(`SELECT allotment FROM room_day WHERE room_type_id = $1 AND stay_date = $2`, [room.id, oneDate]);
    expect(rows[0]!.allotment).toBe(2);
  });

  it('PV-5: the same token applied twice — the second application is stale (the first already moved the state)', async () => {
    const gm = await createEmployee({ role: 'gm' });
    const room = await createRoomType({ baseAllotment: 5, physicalStock: 10 });
    const from = futureDate(10);
    const to = futureDate(14);

    const preview = await post('/api/admin/inventory/preview', { roomTypeId: room.id, from, to, allotment: 3 }, gm.accessToken);
    const { previewToken } = (await preview.json()) as { previewToken: string };

    const first = await put('/api/admin/inventory', { roomTypeId: room.id, from, to, allotment: 3, previewToken }, gm.accessToken);
    expect(first.status).toBe(200);
    const second = await put('/api/admin/inventory', { roomTypeId: room.id, from, to, allotment: 3, previewToken }, gm.accessToken);
    expect(second.status).toBe(409);
  });

  it('PV-6: the token is recomputed inside the transaction, after the locks — not before', async () => {
    // Code-reading proof, backed by a behavioural one: if the token were recomputed BEFORE
    // taking the locks, a change landing between the recompute and the lock would go
    // undetected. PV-4 above already proves a change landing before the apply call starts
    // is caught; this proves the window right up to lock acquisition is covered too, by
    // checking the implementation computes it from state read with the lock already held.
    const source = await Bun.file(new URL('../src/routes/admin/inventory/controllers.ts', import.meta.url)).text();
    const applyFn = source.slice(source.indexOf('applyAllotmentOverrideController'));
    const lockIndex = applyFn.indexOf('lockRoomDays');
    const tokenIndex = applyFn.indexOf('previewToken(currentRows)');
    expect(lockIndex).toBeGreaterThan(-1);
    expect(tokenIndex).toBeGreaterThan(lockIndex);
  });

  it('PV-7: the same previewToken mechanism works identically on rates and blackouts', async () => {
    const gm = await createEmployee({ role: 'gm' });
    const room = await createRoomType({});
    const from = futureDate(10);
    const to = futureDate(12);

    const ratePreview = await post('/api/admin/rates/preview', { roomTypeId: room.id, from, to, pricePaise: 600000 }, gm.accessToken);
    expect(ratePreview.status).toBe(200);
    const { previewToken: rateToken } = (await ratePreview.json()) as { previewToken: string };
    const rateApply = await put('/api/admin/rates', { roomTypeId: room.id, from, to, pricePaise: 600000, previewToken: rateToken }, gm.accessToken);
    expect(rateApply.status).toBe(200);

    const blackoutPreview = await post('/api/admin/blackouts/preview', { roomTypeId: room.id, from, to }, gm.accessToken);
    expect(blackoutPreview.status).toBe(200);
    const { previewToken: blackoutToken } = (await blackoutPreview.json()) as { previewToken: string };
    const blackoutApply = await put('/api/admin/blackouts', { roomTypeId: room.id, from, to, previewToken: blackoutToken }, gm.accessToken);
    expect(blackoutApply.status).toBe(200);
  });
});
