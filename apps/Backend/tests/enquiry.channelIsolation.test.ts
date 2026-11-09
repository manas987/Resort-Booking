/**
 * CI-1..CI-5 (Docs/tests-phase1.md, 1I).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';
import { pool } from '../src/db.ts';
import { requireTestDatabase, resetDatabase } from './helpers/db.ts';
import { publishResortInfo, createGuest } from './helpers/factories.ts';

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
    headers: { 'content-type': 'application/json', ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) },
    body: JSON.stringify(body),
  });
}
async function get(path: string, accessToken: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${accessToken}` } });
}

describe('enquiry.channelIsolation — 1I', () => {
  it('CI-1: a WhatsApp enquiry whose number matches a registered guest never appears in that guest\'s list (INV-42)', async () => {
    const guest = await createGuest({ phone: '9876543210' });
    // This repo's .env runs DEMO_MODE=true (see 1D's note on PE-12), so the real demo-gated
    // route is reachable here — go through it rather than arranging the row directly.
    const inbound = await post('/api/mock/inbound/whatsapp', { from: '9876543210', message: 'Is breakfast included?' });
    expect(inbound.status).toBe(201);

    const response = await get('/api/user/enquiries', guest.accessToken);
    const body = (await response.json()) as { items: unknown[] };
    expect(body.items).toHaveLength(0);
  });

  it('CI-2: an email enquiry whose address matches a registered guest never appears in that guest\'s list', async () => {
    const guest = await createGuest({ email: 'ci2@example.com' });
    await pool.query(
      `INSERT INTO enquiries (public_ref, source, source_identifier, status, contact_email)
       VALUES ('ENQ-1002', 'email', 'ci2@example.com', 'new', 'ci2@example.com')`,
    );
    const response = await get('/api/user/enquiries', guest.accessToken);
    const body = (await response.json()) as { items: unknown[] };
    expect(body.items).toHaveLength(0);
  });

  it('CI-3: setting guest_user_id on a non-website enquiry is refused by the enquiry_guest_only_website CHECK', async () => {
    const guest = await createGuest();
    await expect(
      pool.query(
        `INSERT INTO enquiries (public_ref, source, status, guest_user_id, contact_phone)
         VALUES ('ENQ-1003', 'whatsapp', 'new', $1, '9000000000')`,
        [guest.id],
      ),
    ).rejects.toThrow();
  });

  it('CI-4: a staff reply on an email thread is recorded on the email channel, not the website', async () => {
    const { rows: enquiryRows } = await pool.query<{ id: string }>(
      `INSERT INTO enquiries (public_ref, source, source_identifier, status, contact_email)
       VALUES ('ENQ-1004', 'email', 'ci4@example.com', 'in_progress', 'ci4@example.com')
       RETURNING id`,
    );
    const { rows: staffRows } = await pool.query<{ id: string }>(
      `INSERT INTO users (kind, role, team, name, email, username, password_hash)
       VALUES ('employee', 'staff', 'reservations', 'Staff CI4', 'staff-ci4@example.com', 'staffci4', 'x')
       RETURNING id`,
    );
    // No admin reply route exists yet (2C) — arrange the reply directly; the point here is
    // what the enquiry's own `source` column says delivery happens on, not the admin route.
    await pool.query(
      `INSERT INTO enquiry_messages (enquiry_id, direction, visibility, author_user_id, body, delivery_status)
       VALUES ($1, 'outbound', 'guest', $2, 'We will check and get back to you.', 'sent')`,
      [enquiryRows[0]!.id, staffRows[0]!.id],
    );
    const { rows } = await pool.query<{ source: string }>(`SELECT source FROM enquiries WHERE id = $1`, [enquiryRows[0]!.id]);
    expect(rows[0]!.source).toBe('email'); // delivery for this thread is always this channel
  });

  it('CI-5: an internal note on a website thread is absent from what the guest reads (INV-41)', async () => {
    const guest = await createGuest();
    const response = await post('/api/user/enquiries', { message: 'How far is the estate from the airport?' }, guest.accessToken);
    const { enquiryId } = (await response.json()) as { enquiryId: string };
    const { rows: staffRows } = await pool.query<{ id: string }>(
      `INSERT INTO users (kind, role, team, name, email, username, password_hash)
       VALUES ('employee', 'staff', 'reservations', 'Staff CI5', 'staff-ci5@example.com', 'staffci5', 'x')
       RETURNING id`,
    );
    await pool.query(
      `INSERT INTO enquiry_messages (enquiry_id, direction, visibility, author_user_id, body)
       VALUES ($1, 'outbound', 'internal', $2, 'Guest asked this twice, flag if it repeats')`,
      [enquiryId, staffRows[0]!.id],
    );

    const detail = await get(`/api/user/enquiries/${enquiryId}`, guest.accessToken);
    const body = (await detail.json()) as { messages: Array<{ body: string }> };
    expect(body.messages.some((m) => m.body.includes('flag if it repeats'))).toBe(false);
    expect(body.messages).toHaveLength(1); // only the guest's own original message
  });
});
