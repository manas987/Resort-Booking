/**
 * `GET/PUT /api/admin/resortInfo` — the approved-facts corpus the AI drafter is grounded in.
 *
 * Publishing never edits a row in place (same rule as `tax_config`): it writes a new version and
 * moves `is_current`. The console's information editor shows that history, which is what
 * `?history=true` serves.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';
import { requireTestDatabase, resetDatabase } from './helpers/db.ts';
import { createEmployee } from './helpers/factories.ts';

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

type Item = { key: string; title: string; body: string; version: number; isCurrent: boolean; editor: string | null };

async function get(path: string, accessToken: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${accessToken}` } });
}
async function publish(body: object, accessToken: string): Promise<Response> {
  return fetch(`${baseUrl}/api/admin/resortInfo`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('resort information', () => {
  it('RI-1: publishing supersedes rather than edits, and only one version is current', async () => {
    const gm = await createEmployee({ role: 'gm' });
    await publish({ key: 'faq', title: 'FAQ', body: 'First answer.' }, gm.accessToken);
    await publish({ key: 'faq', title: 'FAQ', body: 'Second answer.' }, gm.accessToken);

    const current = (await (await get('/api/admin/resortInfo', gm.accessToken)).json()) as { items: Item[] };
    expect(current.items).toHaveLength(1);
    expect(current.items[0]!.body).toBe('Second answer.');
    expect(current.items[0]!.version).toBe(2);
  });

  it('RI-2: history=true returns superseded versions, newest first, with their editor', async () => {
    const gm = await createEmployee({ role: 'gm' });
    await publish({ key: 'faq', title: 'FAQ', body: 'First answer.' }, gm.accessToken);
    await publish({ key: 'faq', title: 'FAQ', body: 'Second answer.' }, gm.accessToken);

    const body = (await (await get('/api/admin/resortInfo?key=faq&history=true', gm.accessToken)).json()) as { items: Item[] };
    expect(body.items).toHaveLength(2);
    expect(body.items.map((i) => i.version)).toEqual([2, 1]);
    expect(body.items.filter((i) => i.isCurrent)).toHaveLength(1);
    // Who published it, resolved through created_by — the editor line names a person.
    expect(typeof body.items[0]!.editor).toBe('string');
    expect(body.items[0]!.editor).not.toBe('');
    // The old text is still readable — that is the point of superseding rather than editing.
    expect(body.items[1]!.body).toBe('First answer.');
  });

  it('RI-3: staff cannot read or publish the corpus', async () => {
    const staff = await createEmployee({ role: 'staff', team: 'reservations' });
    expect((await get('/api/admin/resortInfo', staff.accessToken)).status).toBe(403);
    expect((await publish({ key: 'faq', title: 'FAQ', body: 'Nope.' }, staff.accessToken)).status).toBe(403);
  });
});
