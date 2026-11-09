/**
 * `GET /api/admin/bookingCalendar` — the staff availability grid.
 *
 * `remaining`/`committed` come from `core/inventory.ts`'s one shared availability expression
 * (INV-1, INV-10) and are never re-derived. The controller only BREAKS DOWN what that already
 * counted, so the headline rule under test here is that `confirmed + held === committed`.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';
import { pool } from '../src/db.ts';
import { requireTestDatabase, resetDatabase } from './helpers/db.ts';
import { createEmployee, createGuest, createRoomType, createQuote, createBooking, futureDate, setRoomDay, publishResortInfo } from './helpers/factories.ts';

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

type Day = {
  roomTypeId: string;
  stayDate: string;
  allotment: number;
  committed: number;
  confirmed: number;
  held: number;
  remaining: number;
  isBlackout: boolean;
  pricePaise: number;
  hasOverride: boolean;
};

async function get(path: string, accessToken: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${accessToken}` } });
}

describe('booking calendar — staff availability grid', () => {
  it('BC-1: confirmed + held always equals committed', async () => {
    const staff = await createEmployee({ role: 'staff', team: 'reservations' });
    const room = await createRoomType({ basePricePaise: 500000, baseAllotment: 5, physicalStock: 5 });
    const checkIn = futureDate(10);
    const checkOut = futureDate(11);
    const guestA = await createGuest();
    const guestB = await createGuest();

    const confirmedQuote = await createQuote({ guestUserId: guestA.id, checkIn, checkOut, rooms: [{ roomTypeId: room.id, adults: 2, children: 0 }] });
    await createBooking({ guestUserId: guestA.id, quoteId: confirmedQuote.id, status: 'confirmed' });
    const heldQuote = await createQuote({ guestUserId: guestB.id, checkIn, checkOut, rooms: [{ roomTypeId: room.id, adults: 2, children: 0 }] });
    await createBooking({ guestUserId: guestB.id, quoteId: heldQuote.id, status: 'pending_payment' });

    const body = (await (await get(`/api/admin/bookingCalendar?from=${checkIn}&to=${checkOut}`, staff.accessToken)).json()) as { days: Day[] };
    const night = body.days.find((d) => d.stayDate === checkIn && d.roomTypeId === room.id)!;
    expect(night.confirmed).toBe(1);
    expect(night.held).toBe(1);
    expect(night.confirmed + night.held).toBe(night.committed);
    expect(night.remaining).toBe(night.allotment - night.committed);
  });

  it('BC-2: an expired hold counts as neither held nor committed', async () => {
    const staff = await createEmployee({ role: 'staff', team: 'reservations' });
    const room = await createRoomType({ basePricePaise: 500000, baseAllotment: 5, physicalStock: 5 });
    const checkIn = futureDate(10);
    const checkOut = futureDate(11);
    const guest = await createGuest();
    const quote = await createQuote({ guestUserId: guest.id, checkIn, checkOut, rooms: [{ roomTypeId: room.id, adults: 2, children: 0 }] });
    const booking = await createBooking({ guestUserId: guest.id, quoteId: quote.id, status: 'pending_payment' });
    await pool.query(`UPDATE bookings SET hold_expires_at = now() - interval '1 minute' WHERE id = $1`, [booking.id]);

    const body = (await (await get(`/api/admin/bookingCalendar?from=${checkIn}&to=${checkOut}`, staff.accessToken)).json()) as { days: Day[] };
    const night = body.days.find((d) => d.stayDate === checkIn && d.roomTypeId === room.id)!;
    expect(night.held).toBe(0);
    expect(night.committed).toBe(0);
    expect(night.remaining).toBe(night.allotment);
  });

  it('BC-3: the nightly rate falls back to base, and an override is flagged', async () => {
    const staff = await createEmployee({ role: 'staff', team: 'reservations' });
    const room = await createRoomType({ basePricePaise: 500000, baseAllotment: 5, physicalStock: 5 });
    const overridden = futureDate(10);
    const plain = futureDate(11);
    await setRoomDay({ roomTypeId: room.id, stayDate: overridden, pricePaise: 777700 });

    // Checkout-exclusive: `to` is not itself a night, so the window must reach past `plain`.
    const body = (await (await get(`/api/admin/bookingCalendar?from=${overridden}&to=${futureDate(12)}`, staff.accessToken)).json()) as { days: Day[] };
    const withOverride = body.days.find((d) => d.stayDate === overridden)!;
    const withoutOverride = body.days.find((d) => d.stayDate === plain)!;
    expect(withOverride.pricePaise).toBe(777700);
    expect(withOverride.hasOverride).toBe(true);
    expect(withoutOverride.pricePaise).toBe(500000);
    expect(withoutOverride.hasOverride).toBe(false);
  });

  it('BC-4: sales may read the calendar — it is employee scope, not GM (§5)', async () => {
    const sales = await createEmployee({ role: 'staff', team: 'sales' });
    await createRoomType({ basePricePaise: 500000, baseAllotment: 5, physicalStock: 5 });
    const response = await get(`/api/admin/bookingCalendar?from=${futureDate(10)}&to=${futureDate(12)}`, sales.accessToken);
    expect(response.status).toBe(200);
  });
});
