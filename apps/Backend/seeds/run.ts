/**
 * Synthetic reviewer data (Docs/Product.md §26, Docs/10-phase1-backend-guest.md, 1J).
 * Refuses to run against a non-empty database unless `--force` is passed. Exported as
 * `runSeeds` so `analytics.seeds.test.ts` can exercise it against TEST_DATABASE_URL —
 * `src/db.ts` already points `pool` there whenever NODE_ENV=test, so no separate code path
 * is needed to test this safely.
 */
import { randomUUID } from 'node:crypto';
import { pool, withTransaction } from '../src/db.ts';
import { calculateQuote } from '../src/core/pricing.ts';
import { createBookingHold } from '../src/core/booking.ts';
import { beginPaymentAttempt } from '../src/adapters/mockPayments.ts';
import { expireBookingHold, confirmMockPayment } from '../src/core/booking.ts';
import { processBatch } from '../src/jobs/worker.ts';
import { enqueueJob } from '../src/core/jobs.ts';
import { generateEnquiryRef, reassignOnEmployeeDisable } from '../src/core/enquiry/assignment.ts';
import { SUPPLIED_ENQUIRIES } from './data/enquiries.ts';
import { ROOM_CONTENT, photoVariants } from './data/roomContent.ts';

async function isEmpty(): Promise<boolean> {
  const { rows } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM users`);
  return rows[0]!.n === 0;
}

function futureDate(daysFromToday: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
}
/** The next occurrence of a fixed Dec 20 festival window, always inside the 365-day horizon. */
function nextDecemberRange(fromDay: number, toDay: number): [string, string] {
  const now = new Date();
  let year = now.getUTCFullYear();
  if (now.getUTCMonth() === 11 && now.getUTCDate() > toDay) year += 1;
  const pad = (n: number) => String(n).padStart(2, '0');
  return [`${year}-12-${pad(fromDay)}`, `${year}-12-${pad(toDay)}`];
}

async function createEmployee(input: {
  role: 'staff' | 'gm' | 'owner';
  team?: 'reservations' | 'sales';
  name: string;
  email: string;
  username: string;
}): Promise<{ id: string }> {
  const passwordHash = await Bun.password.hash('ReviewerDemo!2026', { algorithm: 'argon2id' });
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (kind, role, team, name, email, email_verified_at, username, password_hash)
     VALUES ('employee', $1, $2, $3, $4, now(), $5, $6)
     RETURNING id`,
    [input.role, input.team ?? null, input.name, input.email, input.username, passwordHash],
  );
  return rows[0]!;
}

async function createGuest(input: { name: string; email: string; phone: string }): Promise<{ id: string }> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (kind, role, name, email, phone, email_verified_at, phone_verified_at)
     VALUES ('guest', 'guest', $1, $2, $3, now(), now())
     RETURNING id`,
    [input.name, input.email, input.phone],
  );
  return rows[0]!;
}

type RoomType = { id: string; name: string; basePricePaise: number };

async function createRoomType(input: {
  slug: string;
  name: string;
  basePricePaise: number;
  maxAdults: number;
  maxChildren: number;
  maxOccupancy: number;
  physicalStock: number;
  baseAllotment: number;
}): Promise<RoomType> {
  // Curated copy if this slug has it (Docs/14-frontend-api-map.md's four seeded rooms do);
  // falls back to the generic filler for any room type the content map doesn't name.
  const content = ROOM_CONTENT[input.slug];
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO room_types
       (slug, name, summary, description, amenities, inclusions, max_adults, max_children,
        max_occupancy, physical_stock, base_price_paise, base_allotment)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id`,
    [
      input.slug,
      input.name,
      content?.summary ?? `${input.name} — a quiet stay among the coffee estate.`,
      content?.description ?? `${input.name}: a premium room on the estate, with estate views and a private sit-out.`,
      content?.amenities ?? ['Wifi', 'Estate view', 'Private sit-out'],
      content?.inclusions ?? ['Breakfast', 'Estate walk'],
      input.maxAdults,
      input.maxChildren,
      input.maxOccupancy,
      input.physicalStock,
      input.basePricePaise,
      input.baseAllotment,
    ],
  );
  const photos: Array<{ alt: string; unsplashId: string | null }> =
    content?.photos ?? [{ alt: `${input.name} exterior`, unsplashId: null }];
  for (const [index, photo] of photos.entries()) {
    // The row's own width/height must match the LARGEST variant's real file — curated photos
    // are cropped to PHOTO_ASPECT_RATIO server-side now (1600x1067); the picsum placeholder
    // fallback is genuinely requested at 1600x1000, so its row dimensions stay as-is.
    const variants = photo.unsplashId
      ? photoVariants(photo.unsplashId)
      : [{ w: 1600, h: 1000, format: 'avif', url: `https://picsum.photos/seed/${input.slug}/1600/1000` }];
    const { w: rowWidth, h: rowHeight } = variants[variants.length - 1]!;
    await pool.query(
      `INSERT INTO room_photos (room_type_id, alt, width, height, variants, is_cover, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [rows[0]!.id, photo.alt, rowWidth, rowHeight, JSON.stringify(variants), index === 0, index],
    );
  }
  return { id: rows[0]!.id, name: input.name, basePricePaise: input.basePricePaise };
}

async function publishResortInfo(ownerId: string, key: string, title: string, body: string): Promise<void> {
  await pool.query(
    `INSERT INTO resort_info (key, title, body, version, is_current, created_by) VALUES ($1, $2, $3, 1, true, $4)`,
    [key, title, body, ownerId],
  );
}

async function quoteFor(
  checkIn: string,
  checkOut: string,
  rooms: Array<{ roomTypeId: string; adults: number; children: number }>,
  guestUserId: string,
  promoCode?: string,
): Promise<string> {
  const result = await calculateQuote(pool, { stay: { checkIn, checkOut }, rooms, promoCode });
  let promoId: string | null = null;
  if (promoCode) {
    const { rows } = await pool.query<{ id: string }>(`SELECT id FROM promo_codes WHERE upper(code) = upper($1)`, [promoCode]);
    promoId = rows[0]?.id ?? null;
  }
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO quotes
       (guest_user_id, check_in, check_out, lines, pricing, promo_id, room_paise, discount_paise,
        tax_paise, total_paise, tax_config_version, terms_version, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now() + interval '1 hour')
     RETURNING id`,
    [
      guestUserId,
      checkIn,
      checkOut,
      JSON.stringify(rooms),
      JSON.stringify(result),
      promoId,
      result.roomPaise,
      result.discountPaise,
      result.taxPaise,
      result.totalPaise,
      result.taxConfigVersion,
      result.termsVersion,
    ],
  );
  return rows[0]!.id;
}

async function seedUsers() {
  const owner = await createEmployee({ role: 'owner', name: 'Asha Rao', email: 'owner@coffeeestate.test', username: 'owner' });
  const gm = await createEmployee({ role: 'gm', name: 'Vikram Shetty', email: 'gm@coffeeestate.test', username: 'gm' });
  const reservationsStaff1 = await createEmployee({
    role: 'staff', team: 'reservations', name: 'Priya Nair', email: 'priya@coffeeestate.test', username: 'priya',
  });
  const reservationsStaff2 = await createEmployee({
    role: 'staff', team: 'reservations', name: 'Arjun Menon', email: 'arjun@coffeeestate.test', username: 'arjun',
  });
  const salesStaff1 = await createEmployee({
    role: 'staff', team: 'sales', name: 'Divya Kumar', email: 'divya@coffeeestate.test', username: 'divya',
  });
  const salesStaff2 = await createEmployee({
    role: 'staff', team: 'sales', name: 'Rahul Varma', email: 'rahul@coffeeestate.test', username: 'rahul',
  });
  return { owner, gm, reservationsStaff1, reservationsStaff2, salesStaff1, salesStaff2 };
}

async function seedRoomTypes() {
  const estateRoom = await createRoomType({
    slug: 'estate-room', name: 'Estate Room', basePricePaise: 580000,
    maxAdults: 2, maxChildren: 1, maxOccupancy: 3, physicalStock: 24, baseAllotment: 10,
  });
  const gardenSuite = await createRoomType({
    slug: 'garden-suite', name: 'Garden Suite', basePricePaise: 720000,
    maxAdults: 2, maxChildren: 2, maxOccupancy: 4, physicalStock: 16, baseAllotment: 8,
  });
  const plantationCottage = await createRoomType({
    slug: 'plantation-cottage', name: 'Plantation Cottage', basePricePaise: 950000,
    maxAdults: 2, maxChildren: 2, maxOccupancy: 4, physicalStock: 24, baseAllotment: 6,
  });
  const coffeeVilla = await createRoomType({
    slug: 'coffee-villa', name: 'Coffee Villa', basePricePaise: 1450000,
    maxAdults: 4, maxChildren: 2, maxOccupancy: 5, physicalStock: 12, baseAllotment: 5,
  });

  // Festival override 20-31 Dec raises Estate Room and Garden Suite above the GST threshold
  // (Docs/03-decisions.md) — exercises the per-unit-day bracket on real seeded dates.
  const [festivalStart, festivalEnd] = nextDecemberRange(20, 31);
  for (const roomType of [estateRoom, gardenSuite]) {
    let cursor = new Date(`${festivalStart}T00:00:00Z`);
    const end = new Date(`${festivalEnd}T00:00:00Z`);
    while (cursor <= end) {
      const date = cursor.toISOString().slice(0, 10);
      await pool.query(
        `INSERT INTO room_day (room_type_id, stay_date, price_paise) VALUES ($1, $2, $3)
         ON CONFLICT (room_type_id, stay_date) DO UPDATE SET price_paise = EXCLUDED.price_paise`,
        [roomType.id, date, 890000],
      );
      cursor = new Date(cursor.getTime() + 86_400_000);
    }
  }

  // A blackout night and a sold-out night (via a zero allotment override — distinct from a
  // real commitment-driven sell-out, which the mixed-room booking below also produces).
  const blackoutDate = futureDate(40);
  // Relative dates must not collide with the fixed festival booking as the review day changes.
  const blackoutNight = blackoutDate >= festivalStart && blackoutDate <= festivalEnd ? futureDate(60) : blackoutDate;
  await pool.query(
    `INSERT INTO room_day (room_type_id, stay_date, is_blackout) VALUES ($1, $2, true)`,
    [coffeeVilla.id, blackoutNight],
  );
  await pool.query(
    `INSERT INTO room_day (room_type_id, stay_date, allotment) VALUES ($1, $2, 0)`,
    [plantationCottage.id, futureDate(45)],
  );

  return { estateRoom, gardenSuite, plantationCottage, coffeeVilla };
}

/**
 * The approved-content corpus. Two jobs, and both need it to be more than a couple of
 * sentences:
 *   - it is the ONLY grounding the AI drafter is given (core/enquiry/processing.ts's
 *     `loadApprovedResortInfo`), and it is instructed to state nothing outside it — with two
 *     rows, every draft could only say "the team will confirm";
 *   - GET /api/user/content serves it to the guest site (§8A "brief resort information based on
 *     approved content") and the console's Information tab versions it.
 *
 * All of it is SYNTHETIC and labelled as such in Docs/03-decisions.md. Deliberately absent, per
 * Product.md §8A: no street address, no map pin, no awards, no reviews, and no facility the
 * brief does not establish — a conference hall, spa and airport shuttle are all things guests
 * ASK about in the fixtures, and none is confirmed to exist, so nothing here claims one.
 * Keys are stable: the console edits by key, and a rename orphans its history.
 */
export const RESORT_INFO: Array<{ key: string; title: string; body: string }> = [
  {
    key: 'booking_terms',
    title: 'Booking terms',
    // "within the demo build" was removed: the AI quotes this verbatim into guest-facing drafts,
    // where meta-commentary about the build reads as a cancellation policy.
    body: 'Full payment is due at the time of booking. Rates are quoted per room per night and include GST at the rate applicable to the tariff. Once a booking is confirmed its price is fixed and later rate changes do not affect it. Cancellations, date changes and room changes are handled by our reservations team and are not available online.',
  },
  {
    key: 'faq',
    title: 'Frequently asked questions',
    body: 'Check-in is from 2pm and check-out is by 11am. Breakfast is included in every rate. Wi-Fi, air conditioning, tea and coffee and a private bathroom are provided in every room and villa. Children are welcome, and a room\'s occupancy limits are shown on its room page. We are unable to confirm pet policies, early check-in or late check-out in advance — our reservations team will advise.',
  },
  {
    key: 'room_information',
    title: 'Room information',
    body: 'The estate has 76 keys in total: 64 rooms and 12 villas, across four types. Estate Room is an easy escape for two. Garden Suite has a greener outlook. Plantation Cottage adds a separate sitting area and a sofa bed. Coffee Villa has two bedrooms and its own living space. Capacity, amenities, inclusions and the nightly rate for your dates are shown on each room page; guests choose a room type, never a specific room number.',
  },
  {
    key: 'amenities',
    title: 'Amenities and inclusions',
    body: 'Every stay includes breakfast and a guided estate walk. Every room and villa has Wi-Fi, air conditioning, tea and coffee making, a private bathroom and fresh linen. Garden Suite adds a garden outlook, Plantation Cottage a separate sitting area and sofa bed, and Coffee Villa two bedrooms with a living space. Anything not listed here or on a room page has not been confirmed, and our team will check before we promise it.',
  },
  {
    key: 'arrival',
    title: 'Arrival and check-in',
    body: 'We are a coffee estate in the hills of Chikkamagaluru, Karnataka. Check-in is from 2pm and check-out is by 11am. Please bring valid photo identification for every adult guest. Foreign nationals complete Form C at check-in, so passport details are taken on arrival and never collected online. Our reservations team sends directions and the best approach road once your booking is confirmed; hill roads and weather make a planned arrival time worth sharing with us.',
  },
  {
    key: 'weddings',
    title: 'Weddings',
    body: 'Wedding enquiries are coordinated by our sales team rather than booked online. Tell us your preferred dates or month, how flexible they are, your expected guest count, how many rooms you need and for how many nights, and any particular requirements. Event capacity, event spaces and event pricing all require confirmation from our team — we do not publish a package price, hold a venue or take a deposit through the website.',
  },
  {
    key: 'offsites',
    title: 'Corporate offsites',
    body: 'Offsite enquiries are handled by our sales team. Share your group size, preferred dates or month, how many rooms you need, the number of nights and what the group needs to be able to do. Meeting and conference facilities, catering arrangements and group rates are not confirmed on the website — our team will come back to you on what is possible for your dates.',
  },
];

async function seedPromosAndResortInfo(ownerId: string) {
  for (const section of RESORT_INFO) {
    await publishResortInfo(ownerId, section.key, section.title, section.body);
  }

  await pool.query(
    `INSERT INTO promo_codes (code, kind, value, created_by) VALUES ('WELCOME10', 'percent', 1000, $1)`,
    [ownerId],
  );
  // A promo at its usage cap — max_uses reached by two consumed redemptions below.
  await pool.query(
    `INSERT INTO promo_codes (code, kind, value, max_uses, created_by) VALUES ('ESTATE2', 'fixed', 50000, 2, $1)`,
    [ownerId],
  );
}

async function seedBookingsAndPayments(rooms: {
  estateRoom: RoomType;
  gardenSuite: RoomType;
  plantationCottage: RoomType;
  coffeeVilla: RoomType;
}) {
  // The reviewer identity. src/routes/user/auth/otp.ts only reveals an OTP in DEMO_MODE for
  // DEMO_DESTINATIONS = {'demo@resort.test', '+910000000000'}, and its own comment refers to
  // "seeded reviewer rows" — but nothing seeded them, so none of the guests below could be
  // signed into without reading a hashed code out of the database. Product.md §32 requires a
  // reviewer to complete the verification flow unaided, so the row that makes that possible
  // belongs here. Both contacts pre-verified: requireVerifiedGuest needs email AND phone.
  await createGuest({ name: 'Demo Reviewer', email: 'demo@resort.test', phone: '+910000000000' });

  const guestConfirmed = await createGuest({ name: 'Meera Pillai', email: 'meera.guest@example.test', phone: '9810000001' });
  const guestMixed = await createGuest({ name: 'Karthik Iyer', email: 'karthik.guest@example.test', phone: '9810000002' });
  const guestFailed = await createGuest({ name: 'Sneha Reddy', email: 'sneha.guest@example.test', phone: '9810000003' });
  const guestExpired = await createGuest({ name: 'Rohan Das', email: 'rohan.guest@example.test', phone: '9810000004' });
  const guestLateRefund = await createGuest({ name: 'Ananya Joshi', email: 'ananya.guest@example.test', phone: '9810000005' });
  const guestPromoCap1 = await createGuest({ name: 'Farhan Ali', email: 'farhan.guest@example.test', phone: '9810000006' });
  const guestPromoCap2 = await createGuest({ name: 'Ira Chatterjee', email: 'ira.guest@example.test', phone: '9810000007' });

  // 1. A confirmed booking, ordinary dates.
  const confirmedQuote = await quoteFor(
    futureDate(20), futureDate(22),
    [{ roomTypeId: rooms.estateRoom.id, adults: 2, children: 0 }],
    guestConfirmed.id,
  );
  const confirmedHold = await createBookingHold({
    quoteId: confirmedQuote, actorUserId: guestConfirmed.id, idempotencyKey: randomUUID(),
    guestName: 'Meera Pillai', guestEmail: 'meera.guest@example.test', guestPhone: '9810000001',
  });
  await withTransaction((client) =>
    beginPaymentAttempt(client, { bookingId: confirmedHold.bookingId, amountPaise: 1, outcome: 'succeed' }),
  );
  await processBatch('seed-worker');

  // 2. A mixed-room booking (also exercises multi-night price differences via the festival
  // window on the Estate Room leg).
  const [festivalStart] = nextDecemberRange(20, 31);
  const mixedCheckIn = festivalStart < futureDate(0) ? futureDate(0) : festivalStart;
  const mixedEnd = new Date(`${mixedCheckIn}T00:00:00Z`);
  mixedEnd.setUTCDate(mixedEnd.getUTCDate() + 2);
  const mixedCheckOut = mixedEnd.toISOString().slice(0, 10);
  const mixedQuote = await quoteFor(
    mixedCheckIn, mixedCheckOut,
    [
      { roomTypeId: rooms.estateRoom.id, adults: 2, children: 0 },
      { roomTypeId: rooms.coffeeVilla.id, adults: 3, children: 1 },
    ],
    guestMixed.id,
  );
  const mixedHold = await createBookingHold({
    quoteId: mixedQuote, actorUserId: guestMixed.id, idempotencyKey: randomUUID(),
    guestName: 'Karthik Iyer', guestEmail: 'karthik.guest@example.test', guestPhone: '9810000002',
  });
  await withTransaction((client) => beginPaymentAttempt(client, { bookingId: mixedHold.bookingId, amountPaise: 1, outcome: 'succeed' }));
  await processBatch('seed-worker');

  // 3. A failed payment — the hold stays live, the guest could retry.
  const failedQuote = await quoteFor(
    futureDate(25), futureDate(26),
    [{ roomTypeId: rooms.gardenSuite.id, adults: 2, children: 0 }],
    guestFailed.id,
  );
  const failedHold = await createBookingHold({
    quoteId: failedQuote, actorUserId: guestFailed.id, idempotencyKey: randomUUID(),
    guestName: 'Sneha Reddy', guestEmail: 'sneha.guest@example.test', guestPhone: '9810000003',
  });
  await withTransaction((client) => beginPaymentAttempt(client, { bookingId: failedHold.bookingId, amountPaise: 1, outcome: 'decline' }));
  await processBatch('seed-worker');

  // 4. An expired hold — never paid, lapsed, never revived.
  const expiredQuote = await quoteFor(
    futureDate(30), futureDate(31),
    [{ roomTypeId: rooms.plantationCottage.id, adults: 2, children: 0 }],
    guestExpired.id,
  );
  const expiredHold = await createBookingHold({
    quoteId: expiredQuote, actorUserId: guestExpired.id, idempotencyKey: randomUUID(),
    guestName: 'Rohan Das', guestEmail: 'rohan.guest@example.test', guestPhone: '9810000004',
  });
  await pool.query(`UPDATE bookings SET hold_expires_at = now() - interval '1 second' WHERE id = $1`, [expiredHold.bookingId]);
  await pool.query(`UPDATE jobs SET run_after = now() WHERE dedupe_key = $1`, [`expire_holds:${expiredHold.bookingId}`]);
  await processBatch('seed-worker');

  // 5. A late payment with its refund — the hold released, then a success event arrives.
  const lateQuote = await quoteFor(
    futureDate(32), futureDate(33),
    [{ roomTypeId: rooms.estateRoom.id, adults: 1, children: 0 }],
    guestLateRefund.id,
  );
  const lateHold = await createBookingHold({
    quoteId: lateQuote, actorUserId: guestLateRefund.id, idempotencyKey: randomUUID(),
    guestName: 'Ananya Joshi', guestEmail: 'ananya.guest@example.test', guestPhone: '9810000005',
  });
  await expireBookingHold(lateHold.bookingId);
  const { paymentId: latePaymentId, eventKey: lateEventKey } = await withTransaction(async (client) => {
    const { paymentId } = await beginPaymentAttempt(client, { bookingId: lateHold.bookingId, amountPaise: 1 });
    const { rows } = await client.query<{ event_key: string }>(`SELECT event_key FROM payment_events WHERE payment_id = $1`, [paymentId]);
    return { paymentId, eventKey: rows[0]!.event_key };
  });
  await confirmMockPayment({ paymentId: latePaymentId, eventKey: lateEventKey, eventType: 'late_success' });
  await processBatch('seed-worker');
  await processBatch('seed-worker');

  // 6. A promo applied, and the SAME promo at its usage cap (max_uses = 2, both consumed).
  const promoAppliedQuote = await quoteFor(
    futureDate(35), futureDate(36),
    [{ roomTypeId: rooms.gardenSuite.id, adults: 2, children: 0 }],
    guestPromoCap1.id,
    'ESTATE2',
  );
  const promoHold1 = await createBookingHold({
    quoteId: promoAppliedQuote, actorUserId: guestPromoCap1.id, idempotencyKey: randomUUID(),
    guestName: 'Farhan Ali', guestEmail: 'farhan.guest@example.test', guestPhone: '9810000006',
  });
  await withTransaction((client) => beginPaymentAttempt(client, { bookingId: promoHold1.bookingId, amountPaise: 1, outcome: 'succeed' }));
  await processBatch('seed-worker');

  const promoAtCapQuote = await quoteFor(
    futureDate(36), futureDate(37),
    [{ roomTypeId: rooms.gardenSuite.id, adults: 2, children: 0 }],
    guestPromoCap2.id,
    'ESTATE2',
  );
  const promoHold2 = await createBookingHold({
    quoteId: promoAtCapQuote, actorUserId: guestPromoCap2.id, idempotencyKey: randomUUID(),
    guestName: 'Ira Chatterjee', guestEmail: 'ira.guest@example.test', guestPhone: '9810000007',
  });
  await withTransaction((client) => beginPaymentAttempt(client, { bookingId: promoHold2.bookingId, amountPaise: 1, outcome: 'succeed' }));
  await processBatch('seed-worker');
}

/**
 * Every seeded enquiry gets at least one guest message. An enquiry with an empty thread is a
 * state the running system cannot produce — `POST /api/user/enquiries` and the inbound injector
 * both write the message that creates the row — and a reviewer opening one saw a detail page
 * with nothing in it. The text is synthetic and deliberately matches the row it belongs to: the
 * low-confidence row really is ambiguous, the complaint really is a complaint.
 */
const THREAD_OPENERS = {
  unassigned: 'Hi — just browsing for now. Is there anything happening at the estate in late January?',
  lowConfidence: 'maybe 2 or 3 of us, dates not fixed yet, whats the cheapest you have',
  complaint:
    'We checked out this morning. Our room was not ready at check-in and nobody explained why, so we waited in the lobby with a tired child. I would like someone to call me about it.',
  aiFailure: 'Do you have anything free this weekend?',
  reopened: 'Is the Garden Suite available for the first weekend of December, for two adults?',
  reopenedReply:
    'Thank you for writing in. The Garden Suite is available for those dates and I have noted your enquiry — do let us know if you would like us to hold it.',
  reopenedFollowUp: 'Sorry to come back to this — our plans changed and we now need two rooms rather than one. Is that still possible?',
  assigned1: 'Looking at the Garden Suite for two nights in February. Is breakfast included in the rate?',
  assigned2: 'Can we add a third adult to a Plantation Cottage, or does that need the Coffee Villa?',
} as const;

async function addMessage(
  ref: string,
  body: string,
  options: { direction?: 'inbound' | 'outbound'; authorUserId?: string; minutesAgo?: number } = {},
): Promise<void> {
  await pool.query(
    `INSERT INTO enquiry_messages (enquiry_id, direction, visibility, author_user_id, body, created_at)
     SELECT id, $2, 'guest', $3, $4, now() - ($5 || ' minutes')::interval
       FROM enquiries WHERE public_ref = $1`,
    [ref, options.direction ?? 'inbound', options.authorUserId ?? null, body, String(options.minutesAgo ?? 0)],
  );
}

async function seedEnquiries(staff: { reservationsStaff1: { id: string } }) {
  // The three supplied fixtures, verbatim — IDs and message text are fixed by the brief and must
  // not be edited. They arrive unclassified (ai_status='pending') and each gets a real
  // `classify_enquiry` job, exactly as POST /api/user/enquiries and the mock inbound injector
  // do, so a running worker classifies them for real. Previously no job was enqueued, so they
  // sat at 'pending' forever and a reviewer never saw actual AI output (Product.md §32).
  //
  // The job is enqueued, not executed here: seeding must not require a network or an API key,
  // and must not spend tokens. If no worker is running the row simply waits, which is the same
  // state as before but self-healing the moment one starts.
  for (const fixture of SUPPLIED_ENQUIRIES) {
    await pool.query(
      `INSERT INTO enquiries (public_ref, source, source_identifier, status, contact_name, contact_email)
       VALUES ($1, 'email', $2, 'new', 'Prospective Guest', $2)`,
      [fixture.publicRef, `${fixture.publicRef.toLowerCase()}@inbound.test`],
    );
    await pool.query(
      `INSERT INTO enquiry_messages (enquiry_id, direction, visibility, body)
       SELECT id, 'inbound', 'guest', $2 FROM enquiries WHERE public_ref = $1`,
      [fixture.publicRef, fixture.message],
    );
    await withTransaction(async (client) => {
      const { rows } = await client.query<{ id: string }>(`SELECT id FROM enquiries WHERE public_ref = $1`, [fixture.publicRef]);
      await enqueueJob(client, {
        type: 'classify_enquiry',
        payload: { enquiryId: rows[0]!.id },
        dedupeKey: `seed-classify-${fixture.publicRef}`,
      });
    });
  }

  // Unassigned.
  const unassignedRef = generateEnquiryRef();
  await pool.query(
    `INSERT INTO enquiries (public_ref, source, status, contact_name, contact_email)
     VALUES ($1, 'website', 'new', 'Casual Browser', 'browser@example.test')`,
    [unassignedRef],
  );
  await addMessage(unassignedRef, THREAD_OPENERS.unassigned);

  // Low-confidence, needing review.
  const lowConfidenceRef = generateEnquiryRef();
  await pool.query(
    `INSERT INTO enquiries (public_ref, source, status, category, confidence, needs_review, ai_status, contact_name, contact_email)
     VALUES ($1, 'website', 'new', 'room', 0.35, true, 'low_confidence', 'Unsure Guest', 'unsure@example.test')`,
    [lowConfidenceRef],
  );
  await addMessage(lowConfidenceRef, THREAD_OPENERS.lowConfidence);

  // Complaint — GM alert territory regardless of confidence (INV-18).
  const complaintRef = generateEnquiryRef();
  await pool.query(
    `INSERT INTO enquiries (public_ref, source, status, category, is_complaint, confidence, ai_status, contact_name, contact_email)
     VALUES ($1, 'email', 'new', 'complaint', true, 0.5, 'ok', 'Unhappy Guest', 'unhappy@example.test')`,
    [complaintRef],
  );
  await addMessage(complaintRef, THREAD_OPENERS.complaint);

  // AI failure. `markAiFailure` in core/enquiry/processing.ts sets ai_status='failed' AND
  // notifies every active gm/owner so someone knows to retry — it deliberately does not force
  // review (INV-47), so the notification is the ONLY signal a GM gets. Seeding the status
  // without it produced a state the running system cannot produce: a failed AI run nobody was
  // told about.
  const aiFailureRef = generateEnquiryRef();
  await withTransaction(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO enquiries (public_ref, source, status, ai_status, contact_name, contact_email)
       VALUES ($1, 'whatsapp', 'new', 'failed', 'Provider Down Guest', NULL) RETURNING id`,
      [aiFailureRef],
    );
    const enquiryId = rows[0]!.id;
    const { rows: recipients } = await client.query<{ id: string }>(
      `SELECT id FROM users WHERE kind = 'employee' AND role IN ('gm', 'owner') AND is_active`,
    );
    for (const recipient of recipients) {
      await client.query(
        `INSERT INTO notifications (user_id, type, enquiry_id, body) VALUES ($1, 'ai_failure', $2, $3)`,
        [recipient.id, enquiryId, `AI processing failed on ${aiFailureRef}.`],
      );
    }
  });
  await addMessage(aiFailureRef, THREAD_OPENERS.aiFailure);

  // A resolved thread that reopens: raised three days ago, resolved two days ago, reopened
  // since. `created_at` is set explicitly — it defaults to now(), which with a backdated
  // `resolved_at` produced a thread resolved two days BEFORE it was raised, and the owner's
  // average-resolution metric duly reported a negative number of minutes.
  const reopenedRef = generateEnquiryRef();
  await pool.query(
    `INSERT INTO enquiries
       (public_ref, source, status, category, confidence, ai_status, created_at, last_activity_at,
        resolved_at, reopened_count, contact_name, contact_email)
     VALUES ($1, 'website', 'in_progress', 'room', 0.92, 'ok', now() - interval '3 days', now() - interval '1 day',
             now() - interval '2 days', 1, 'Reopened Guest', 'reopened@example.test')`,
    [reopenedRef],
  );
  // Three messages, backdated to match the row's own timeline: raised three days ago, answered,
  // then reopened. `reopened_count = 1` with a single message would not add up.
  await addMessage(reopenedRef, THREAD_OPENERS.reopened, { minutesAgo: 3 * 24 * 60 });
  await addMessage(reopenedRef, THREAD_OPENERS.reopenedReply, { direction: 'outbound', minutesAgo: 2 * 24 * 60 });
  await addMessage(reopenedRef, THREAD_OPENERS.reopenedFollowUp, { minutesAgo: 24 * 60 });

  // Disabled employee with reassigned enquiries — assign two open ones to a reservations
  // staff member, disable them, then reassign.
  const assignedRef1 = generateEnquiryRef();
  const assignedRef2 = generateEnquiryRef();
  for (const ref of [assignedRef1, assignedRef2]) {
    await pool.query(
      `INSERT INTO enquiries (public_ref, source, status, category, confidence, ai_status, assignee_id, contact_name, contact_email)
       VALUES ($1, 'website', 'in_progress', 'room', 0.88, 'ok', $2, 'Assigned Guest', 'assigned@example.test')`,
      [ref, staff.reservationsStaff1.id],
    );
  }
  await addMessage(assignedRef1, THREAD_OPENERS.assigned1);
  await addMessage(assignedRef2, THREAD_OPENERS.assigned2);
  await pool.query(`UPDATE users SET is_active = false, disabled_at = now() WHERE id = $1`, [staff.reservationsStaff1.id]);
  await withTransaction((client) =>
    reassignOnEmployeeDisable(client, { targetUserId: staff.reservationsStaff1.id, actorUserId: staff.reservationsStaff1.id }),
  );
}

async function seedAnalytics() {
  const sessionId = randomUUID();
  const anonId = randomUUID();
  await pool.query(
    `INSERT INTO analytics_events (anon_id, session_id, type, dedupe_key) VALUES ($1, $2, 'visit', $3)`,
    [anonId, sessionId, `visit:${sessionId}`],
  );
  await pool.query(
    `INSERT INTO analytics_events (anon_id, session_id, type, dedupe_key) VALUES ($1, $2, 'search', $3)`,
    [anonId, sessionId, `search:${sessionId}`],
  );
  await pool.query(
    `INSERT INTO analytics_events (anon_id, session_id, type, dedupe_key) VALUES ($1, $2, 'checkout_started', $3)`,
    [anonId, sessionId, `checkout_started:${sessionId}`],
  );
  await pool.query(
    `INSERT INTO analytics_events (anon_id, session_id, type, dedupe_key) VALUES ($1, $2, 'booking_confirmed', $3)`,
    [anonId, sessionId, `booking_confirmed:${sessionId}`],
  );
}

export async function runSeeds(options: { force?: boolean } = {}): Promise<void> {
  if (!(await isEmpty()) && !options.force) {
    throw new Error(
      'Refusing to seed: the database already has data. Pass --force (or { force: true }) only when you mean to seed anyway.',
    );
  }

  const staff = await seedUsers();
  const rooms = await seedRoomTypes();
  await seedPromosAndResortInfo(staff.owner.id);
  await seedBookingsAndPayments(rooms);
  await seedEnquiries(staff);
  await seedAnalytics();
}

if (import.meta.main) {
  const force = process.argv.includes('--force');
  runSeeds({ force })
    .then(() => {
      console.log('seed complete');
      process.exit(0);
    })
    .catch((error) => {
      console.error(`seed failed: ${(error as Error).message}`);
      process.exit(1);
    });
}
