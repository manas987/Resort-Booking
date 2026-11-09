/**
 * quote -> atomic hold (Docs/04-contracts.md, 1G — the graded hard part). Owns its own
 * transaction via `withTransaction`. No Express types here.
 */
import { randomInt } from 'node:crypto';
import { withTransaction, withSavepoint, pool, PG, isPgError } from '../db.ts';
import type { Tx } from '../db.ts';
import { AppError } from '../middleware/errors.ts';
import { POLICY } from './policy.ts';
import { calculateQuote } from './pricing.ts';
import type { RoomSelection, QuoteResult, NightRef } from './pricing.ts';
import { lockRoomDays, assertAvailable, nightKey } from './inventory.ts';
import { enqueueJob } from './jobs.ts';
import { recordAuditEvent } from './audit.ts';

export type HoldResult = { bookingId: string; reference: string; holdExpiresAt: string };

/** `BK-` + 8 chars from an alphabet with no 0/O, 1/I/L, U/V confusion — unambiguous read aloud
 *  over a phone. Random, NOT sequential, so one guest cannot guess another's (GI-2). */
const REFERENCE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export function generateReference(): string {
  let reference = 'BK-';
  for (let i = 0; i < 8; i += 1) {
    reference += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  }
  return reference;
}

type QuoteRow = {
  id: string;
  guest_user_id: string | null;
  check_in: string;
  check_out: string;
  lines: RoomSelection[];
  pricing: QuoteResult;
  promo_id: string | null;
  room_paise: number;
  discount_paise: number;
  tax_paise: number;
  total_paise: number;
  tax_config_version: number;
  terms_version: number;
  expires_at: string;
};

/** Thrown out of the hold transaction so the rollback happens FIRST, then the fresh quote is
 *  written (INV-60) on its own connection. Writing it inside the transaction meant it was
 *  rolled back with everything else, and the 422 handed the guest a `quoteId` that did not exist —
 *  `GET /quotes/:id` answered 404 and the §8D "confirm the new total" step was a dead end.
 *  Docs/10-phase1-backend-guest.md: "422 price_changed returns a fresh quote for
 *  acknowledgement." */
class PriceChanged extends Error {
  constructor(readonly quote: QuoteRow, readonly recomputed: QuoteResult) {
    super('price_changed');
  }
}

async function persistFreshQuote(client: Tx, quote: QuoteRow, result: QuoteResult): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO quotes
       (guest_user_id, check_in, check_out, lines, pricing, promo_id, room_paise,
        discount_paise, tax_paise, total_paise, tax_config_version, terms_version, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now() + interval '1 minute' * $13)
     RETURNING id`,
    [
      quote.guest_user_id,
      quote.check_in,
      quote.check_out,
      JSON.stringify(quote.lines),
      JSON.stringify(result),
      quote.promo_id,
      result.roomPaise,
      result.discountPaise,
      result.taxPaise,
      result.totalPaise,
      result.taxConfigVersion,
      result.termsVersion,
      POLICY.expiry.quoteMinutes,
    ],
  );
  return rows[0]!.id;
}

/** quote -> atomic hold. Sequence (INV-1, INV-7):
 *  validate quote (exists, unexpired, same guest, amounts unchanged)
 *  -> lockRoomDays -> assertAvailable -> lock promo row + reserve capacity (INV-8)
 *  -> insert bookings + booking_rooms + booking_nights + promo_redemption
 *  -> enqueue expire_holds job -> COMMIT.
 *  Throws availability_conflict / quote_expired / promo_exhausted / price_changed. */
export async function createBookingHold(input: {
  quoteId: string;
  actorUserId: string;
  idempotencyKey: string;
  guestName: string;
  guestEmail: string;
  guestPhone: string;
}): Promise<HoldResult> {
  try {
    return await holdInTransaction(input);
  } catch (error) {
    if (!(error instanceof PriceChanged)) throw error;
    // The transaction has already rolled back, so this write survives (pool, not client).
    const freshQuoteId = await persistFreshQuote(pool, error.quote, error.recomputed);
    throw new AppError(
      'price_changed',
      'Prices have changed since this quote was created. Please review and confirm the new total.',
      { quoteId: freshQuoteId, ...error.recomputed },
    );
  }
}

async function holdInTransaction(input: {
  quoteId: string;
  actorUserId: string;
  idempotencyKey: string;
  guestName: string;
  guestEmail: string;
  guestPhone: string;
}): Promise<HoldResult> {
  return withTransaction(async (client) => {
    // 1. Validate the quote — exists, unexpired, same guest, amounts unchanged.
    // FOR UPDATE: the row lock is what makes the single-use check below race-free. Two
    // requests presenting the same quote serialise here, so the second one sees the first
    // one's booking instead of both reading "no booking yet" and each creating one.
    const { rows: quoteRows } = await client.query<QuoteRow>(
      `SELECT id, guest_user_id, check_in, check_out, lines, pricing, promo_id, room_paise,
              discount_paise, tax_paise, total_paise, tax_config_version, terms_version, expires_at
         FROM quotes WHERE id = $1 FOR UPDATE`,
      [input.quoteId],
    );
    const quote = quoteRows[0];
    // A quote id is not a capability (INV-34) — another guest's quote is 404, never 403.
    if (!quote || (quote.guest_user_id !== null && quote.guest_user_id !== input.actorUserId)) {
      throw new AppError('not_found', 'Quote not found.');
    }
    if (new Date(quote.expires_at).getTime() <= Date.now()) {
      throw new AppError('quote_expired', 'This quote has expired. Please get a new quote.');
    }

    // A quote is spent by the booking it produced (INV-60). Without this, one quote
    // converted to a hold N times — a double-click that regenerates its Idempotency-Key is a *different*
    // request to `middleware/idempotency.ts`, so the key cannot catch it — and the guest
    // ended up holding the same stay twice, paying twice, against one intent (Goal 7 of
    // Docs/10-phase1-backend-guest.md: no duplicate booking). "Live" is the same predicate
    // committed inventory uses (INV-10): once the first hold has lapsed it blocks nothing,
    // and nor should it block a retry.
    const { rows: existingRows } = await client.query<{ reference: string }>(
      `SELECT reference FROM bookings
         WHERE quote_id = $1
           AND (status = 'confirmed'
                OR (status = 'pending_payment' AND hold_expires_at > now()))
         LIMIT 1`,
      [quote.id],
    );
    const alreadyBooked = existingRows[0];
    if (alreadyBooked) {
      throw new AppError(
        'quote_already_booked',
        'This quote has already been booked. Open the booking, or get a new quote to book again.',
        { reference: alreadyBooked.reference },
      );
    }

    let promoCode: string | null = null;
    if (quote.promo_id) {
      const { rows } = await client.query<{ code: string }>(
        `SELECT code FROM promo_codes WHERE id = $1`,
        [quote.promo_id],
      );
      promoCode = rows[0]?.code ?? null;
    }
    const recomputed = await calculateQuote(client, {
      stay: { checkIn: quote.check_in, checkOut: quote.check_out },
      rooms: quote.lines,
      promoCode: promoCode ?? undefined,
    });
    if (recomputed.totalPaise !== quote.total_paise) {
      throw new PriceChanged(quote, recomputed);
    }

    // 2+3. Materialise room_day rows and lock them, fixed order (INV-3).
    const nights: NightRef[] = [];
    const seen = new Set<string>();
    for (const night of recomputed.nights) {
      const key = nightKey(night.roomTypeId, night.stayDate);
      if (!seen.has(key)) {
        seen.add(key);
        nights.push({ roomTypeId: night.roomTypeId, stayDate: night.stayDate });
      }
    }
    await lockRoomDays(client, nights);

    // 4. Recheck every room-night under lock; 409 names every conflicting night (INV-1).
    const requestedPerNight = new Map<string, number>();
    for (const room of quote.lines) {
      for (const night of nights.filter((n) => n.roomTypeId === room.roomTypeId)) {
        const key = nightKey(night.roomTypeId, night.stayDate);
        requestedPerNight.set(key, (requestedPerNight.get(key) ?? 0) + 1);
      }
    }
    await assertAvailable(client, { nights, requestedPerNight });

    // 5. Lock the promo row and reserve capacity, if a promo was applied (INV-8).
    let promoId: string | null = null;
    if (quote.promo_id) {
      const { rows: promoRows } = await client.query<{ id: string; max_uses: number | null }>(
        `SELECT id, max_uses FROM promo_codes WHERE id = $1 FOR UPDATE`,
        [quote.promo_id],
      );
      const promo = promoRows[0];
      if (!promo) throw new AppError('promo_exhausted', 'This promo code is no longer valid.');
      if (promo.max_uses !== null) {
        const { rows: countRows } = await client.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM promo_redemptions
             WHERE promo_id = $1 AND state <> 'released'`,
          [promo.id],
        );
        if (countRows[0]!.n >= promo.max_uses) {
          throw new AppError('promo_exhausted', 'This promo code has reached its usage limit.');
        }
      }
      promoId = promo.id;
    }

    // 6. Insert booking, booking_rooms, booking_nights, promo_redemption; stamp the hold.
    let bookingId: string | undefined;
    let reference: string | undefined;
    for (let attempt = 0; attempt < 5 && !bookingId; attempt += 1) {
      const candidate = generateReference();
      try {
        // A unique violation here must not abort the whole hold transaction (db.ts's
        // withSavepoint) — otherwise the retry below can never succeed.
        const { rows } = await withSavepoint(client, () => client.query<{ id: string }>(
          `INSERT INTO bookings
             (reference, guest_user_id, status, check_in, check_out, hold_expires_at, quote_id,
              promo_id, room_paise, discount_paise, tax_paise, total_paise, tax_config_version,
              terms_version, guest_name, guest_email, guest_phone)
           VALUES ($1, $2, 'pending_payment', $3, $4, now() + interval '1 minute' * $5, $6, $7,
                   $8, $9, $10, $11, $12, $13, $14, $15, $16)
           RETURNING id`,
          [
            candidate,
            input.actorUserId,
            quote.check_in,
            quote.check_out,
            POLICY.expiry.paymentHoldMinutes,
            quote.id,
            promoId,
            recomputed.roomPaise,
            recomputed.discountPaise,
            recomputed.taxPaise,
            recomputed.totalPaise,
            recomputed.taxConfigVersion,
            recomputed.termsVersion,
            input.guestName,
            input.guestEmail,
            input.guestPhone,
          ],
        ));
        bookingId = rows[0]!.id;
        reference = candidate;
      } catch (error) {
        if (!isPgError(error, PG.UNIQUE_VIOLATION)) throw error;
      }
    }
    if (!bookingId || !reference) {
      throw new AppError('internal_error', 'Could not generate a unique booking reference.');
    }

    const nightsPerRoom = recomputed.nights.length / quote.lines.length;
    for (let lineIndex = 0; lineIndex < quote.lines.length; lineIndex += 1) {
      const room = quote.lines[lineIndex]!;
      const { rows: roomTypeRows } = await client.query<{ name: string }>(
        `SELECT name FROM room_types WHERE id = $1`,
        [room.roomTypeId],
      );
      const { rows: roomRows } = await client.query<{ id: string }>(
        `INSERT INTO booking_rooms (booking_id, room_type_id, room_name_snapshot, adults, children)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [bookingId, room.roomTypeId, roomTypeRows[0]!.name, room.adults, room.children],
      );
      const bookingRoomId = roomRows[0]!.id;
      const ownNights = recomputed.nights.slice(lineIndex * nightsPerRoom, (lineIndex + 1) * nightsPerRoom);
      for (const night of ownNights) {
        await client.query(
          `INSERT INTO booking_nights
             (booking_id, booking_room_id, room_type_id, stay_date, price_paise, discount_paise,
              taxable_paise, tax_rate_bps, tax_paise)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            bookingId,
            bookingRoomId,
            night.roomTypeId,
            night.stayDate,
            night.pricePaise,
            night.discountPaise,
            night.taxablePaise,
            night.taxRateBps,
            night.taxPaise,
          ],
        );
      }
    }

    if (promoId) {
      await client.query(
        `INSERT INTO promo_redemptions (promo_id, booking_id, state) VALUES ($1, $2, 'held')`,
        [promoId, bookingId],
      );
    }

    const { rows: expiryRows } = await client.query<{ hold_expires_at: string }>(
      `SELECT hold_expires_at FROM bookings WHERE id = $1`,
      [bookingId],
    );
    const holdExpiresAt = expiryRows[0]!.hold_expires_at;

    // enqueue the expiry job INSIDE this transaction — it must not exist without the booking,
    // and must not be visible before the booking commits (INV-23).
    await enqueueJob(client, {
      type: 'expire_holds',
      payload: { bookingId },
      runAfter: holdExpiresAt,
      dedupeKey: `expire_holds:${bookingId}`,
    });

    // Booking/payment/refund transitions are audited regardless of actor — a guest action is
    // no exception (00-conventions.md's audit list, AU-4).
    await recordAuditEvent(client, {
      actorUserId: input.actorUserId, actorRole: 'guest', action: 'booking.create', targetKind: 'booking', targetId: bookingId,
      after: { reference, status: 'pending_payment', totalPaise: recomputed.totalPaise },
    });

    return { bookingId, reference, holdExpiresAt };
  });
}

/** pending_payment + lapsed hold -> expired. Releases promo capacity. Idempotent: safe to run
 *  twice, and inventory was already free the moment the hold lapsed (INV-10) — this only
 *  catches the booking's own status column up to what `readAvailability`/`assertAvailable`
 *  already treat as true. */
export async function expireBookingHold(bookingId: string): Promise<void> {
  await withTransaction(async (client) => {
    const { rows } = await client.query<{ status: string; hold_expires_at: string | null }>(
      `SELECT status, hold_expires_at FROM bookings WHERE id = $1 FOR UPDATE`,
      [bookingId],
    );
    const booking = rows[0];
    if (!booking || booking.status !== 'pending_payment') return; // already settled — no-op

    await client.query(
      `UPDATE bookings SET status = 'expired', expired_at = now() WHERE id = $1`,
      [bookingId],
    );
    await client.query(
      `UPDATE promo_redemptions SET state = 'released', updated_at = now()
         WHERE booking_id = $1 AND state = 'held'`,
      [bookingId],
    );
    await recordAuditEvent(client, {
      actorUserId: null, actorRole: 'system', action: 'booking.expired', targetKind: 'booking', targetId: bookingId,
      before: { status: booking.status }, after: { status: 'expired' },
    });
  });
}

type BookingLockRow = { status: string; hold_expires_at: string | null };

/** Processes one ledger event. Keyed on payment_events.event_key — a redelivered event is a
 *  no-op, never a second confirmation (INV-11).
 *  Live hold + success -> confirmed. Released booking + success -> stays expired and enqueues
 *  refundLatePayment. Never revives or rebooks (INV-12). */
export async function confirmMockPayment(input: {
  paymentId: string;
  eventKey: string;
  eventType: 'succeeded' | 'failed' | 'late_success';
}): Promise<void> {
  await withTransaction(async (client) => {
    const { rows: eventRows } = await client.query<{ processed_at: string | null }>(
      `SELECT processed_at FROM payment_events WHERE event_key = $1 FOR UPDATE`,
      [input.eventKey],
    );
    const event = eventRows[0];
    if (!event || event.processed_at) return; // redelivered or unknown — no-op (INV-11)

    const { rows: paymentRows } = await client.query<{ booking_id: string }>(
      `SELECT booking_id FROM payments WHERE id = $1 FOR UPDATE`,
      [input.paymentId],
    );
    const payment = paymentRows[0];
    if (!payment) throw new AppError('internal_error', 'Payment not found for this event.');

    const { rows: bookingRows } = await client.query<BookingLockRow>(
      `SELECT status, hold_expires_at FROM bookings WHERE id = $1 FOR UPDATE`,
      [payment.booking_id],
    );
    const booking = bookingRows[0]!;

    await client.query(`UPDATE payment_events SET processed_at = now(), outcome = $2 WHERE event_key = $1`, [
      input.eventKey,
      input.eventType === 'failed' ? 'failed' : 'succeeded',
    ]);

    if (input.eventType === 'failed') {
      await client.query(
        `UPDATE payments SET status = 'failed', failure_reason = 'Payment declined' WHERE id = $1`,
        [input.paymentId],
      );
      await recordAuditEvent(client, {
        actorUserId: null, actorRole: 'system', action: 'payment.failed', targetKind: 'payment', targetId: input.paymentId,
        after: { bookingId: payment.booking_id },
      });
      return; // the hold itself is untouched — the guest can retry while it is still live
    }

    await client.query(`UPDATE payments SET status = 'succeeded' WHERE id = $1`, [input.paymentId]);

    const holdLive =
      booking.status === 'pending_payment' &&
      booking.hold_expires_at !== null &&
      new Date(booking.hold_expires_at).getTime() > Date.now();

    if (holdLive) {
      await client.query(`UPDATE bookings SET status = 'confirmed', confirmed_at = now() WHERE id = $1`, [
        payment.booking_id,
      ]);
      await client.query(
        `UPDATE promo_redemptions SET state = 'consumed', updated_at = now()
           WHERE booking_id = $1 AND state = 'held'`,
        [payment.booking_id],
      );
      await recordAuditEvent(client, {
        actorUserId: null, actorRole: 'system', action: 'booking.confirmed', targetKind: 'booking', targetId: payment.booking_id,
        after: { status: 'confirmed', paymentId: input.paymentId },
      });
      return;
    }

    // Released booking + success — never revive or rebook (INV-12). The expire_holds job
    // (already enqueued at hold time) settles the booking's own status column; this only
    // owns getting the guest their money back.
    await recordAuditEvent(client, {
      actorUserId: null, actorRole: 'system', action: 'payment.succeeded_late', targetKind: 'payment', targetId: input.paymentId,
      after: { bookingId: payment.booking_id },
    });
    await enqueueJob(client, {
      type: 'refund_late_payment',
      payload: { paymentId: input.paymentId },
      dedupeKey: `refund_late_payment:${input.paymentId}`,
    });
  });
}

/** One refund and one apology per payment, ever. dedupe_key = paymentId, backed by
 *  UNIQUE (payment_id, reason) (INV-13). The "apology simulated" is an at-most-once
 *  `send_message` job row (Docs/03-decisions.md, "Payment apology delivery (1H)") — there is
 *  no enquiry thread to attach a real `enquiry_messages` row to for a payment notification;
 *  `adapters/messaging.ts`/`deliverMessage` stays reserved for real enquiry threads (1I). */
export async function refundLatePayment(paymentId: string): Promise<void> {
  await withTransaction(async (client) => {
    const { rows: paymentRows } = await client.query<{ booking_id: string; amount_paise: number }>(
      `SELECT booking_id, amount_paise FROM payments WHERE id = $1 FOR UPDATE`,
      [paymentId],
    );
    const payment = paymentRows[0];
    if (!payment) throw new AppError('internal_error', 'Payment not found for refund.');

    const { rows: refundRows } = await client.query<{ id: string }>(
      `INSERT INTO refunds (payment_id, booking_id, reason, amount_paise, status)
       VALUES ($1, $2, 'late_payment_inventory_released', $3, 'refund_pending')
       ON CONFLICT (payment_id, reason) DO NOTHING
       RETURNING id`,
      [paymentId, payment.booking_id, payment.amount_paise],
    );
    const refund = refundRows[0];
    if (!refund) return; // already refunded for this payment — idempotent (LR-2)

    // The mock refund path always succeeds — there is no failure trigger documented for it
    // (unlike the payment attempt's `outcome` field), so LR-4/LR-5 arrange a failed outcome
    // directly in the database, the same way other sub-phases simulate an external actor.
    await client.query(`UPDATE refunds SET status = 'refunded', updated_at = now() WHERE id = $1`, [refund.id]);
    await recordAuditEvent(client, {
      actorUserId: null, actorRole: 'system', action: 'refund.recorded', targetKind: 'refund', targetId: refund.id,
      after: { paymentId, bookingId: payment.booking_id, amountPaise: payment.amount_paise },
    });

    // One in-app alert per active GM/owner — oversight-worthy, same tier as a complaint
    // alert (01-data-model.md lists 'refund_recorded' alongside them).
    await client.query(
      `INSERT INTO notifications (user_id, type, booking_id, body)
       SELECT id, 'refund_recorded', $1, 'A payment succeeded after its hold had already released and was refunded.'
         FROM users WHERE kind = 'employee' AND role IN ('gm', 'owner') AND is_active`,
      [payment.booking_id],
    );

    await enqueueJob(client, {
      type: 'send_message',
      payload: { kind: 'late_refund_apology', paymentId, bookingId: payment.booking_id },
      dedupeKey: `apology:${paymentId}`,
    });
  });
}
