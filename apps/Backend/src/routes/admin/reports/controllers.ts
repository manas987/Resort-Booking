import type { NextFunction, Request, Response } from 'express';
import { pool } from '../../../db.ts';
import { badRequest } from '../../../middleware/errors.ts';
import { POLICY } from '../../../core/policy.ts';
import { readAvailability } from '../../../core/inventory.ts';
import { reportWindowQuerySchema } from './schema.ts';

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const WORK_START_HOUR = 9;
const WORK_END_HOUR = 19;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Asia/Kolkata has no DST, ever — a fixed +5:30 offset, so shifting the instant and reading
 *  UTC fields back off it gives correct IST wall-clock values with no Intl overhead. */
function toIstLocal(date: Date): Date {
  return new Date(date.getTime() + IST_OFFSET_MS);
}

/** First-reply time only counts working hours 09:00–19:00 IST — the clock pauses outside
 *  them (RP-3). Walks day by day in IST-local terms, summing each day's overlap with the
 *  working window. */
function workingMinutesElapsed(startUtc: Date, endUtc: Date): number {
  if (endUtc <= startUtc) return 0;
  let cursor = toIstLocal(startUtc);
  const end = toIstLocal(endUtc);
  let total = 0;
  for (;;) {
    const y = cursor.getUTCFullYear();
    const m = cursor.getUTCMonth();
    const d = cursor.getUTCDate();
    const dayStart = new Date(Date.UTC(y, m, d, WORK_START_HOUR, 0, 0));
    const dayEnd = new Date(Date.UTC(y, m, d, WORK_END_HOUR, 0, 0));
    const nextDay = new Date(Date.UTC(y, m, d + 1, 0, 0, 0));
    const segStart = cursor > dayStart ? cursor : dayStart;
    const segEndCandidate = end < nextDay ? end : nextDay;
    const segEnd = segEndCandidate < dayEnd ? segEndCandidate : dayEnd;
    if (segEnd > segStart) total += (segEnd.getTime() - segStart.getTime()) / 60_000;
    if (end < nextDay) break;
    cursor = nextDay;
  }
  return total;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}
function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

const DEFINITIONS = {
  bookingValue: 'Sum of total_paise (tax included) for bookings confirmed within the window, counted by confirmation date, not stay date (INV-55).',
  roomNightsSold: 'Count of booking_nights rows belonging to confirmed bookings with a stay date in the window. A live hold is never counted as a sold night (INV-55).',
  allotmentUtilisation: 'Sold website room-nights divided by the website\'s own effective allotment room-nights over the same window — not against all 76 physical keys (RP-13).',
  firstReply: 'Median minutes from enquiry creation to the first human-sent, successfully-delivered, guest-visible reply, counting only 09:00–19:00 IST (the clock pauses outside working hours). An AI draft is not a reply; a failed delivery is not a reply (INV-54).',
  resolution: 'Average minutes from enquiry creation to its latest resolved_at. A reopened thread measures to its latest resolution, with its reopen count shown alongside (RP-4).',
  caveat: 'Website-channel figures only. No profit figure, no total-resort-occupancy figure, no claim about meeting a direct-booking-share target (INV-56).',
};

export async function readMetricsController(request: Request, response: Response, next: NextFunction): Promise<void> {
  const parsed = reportWindowQuerySchema.safeParse(request.query);
  if (!parsed.success) return next(badRequest(parsed.error));
  const { from, to } = parsed.data;
  const toExclusive = addDays(to, 1);

  try {
    const { rows: bookingValueRows } = await pool.query<{ total: number | null; n: number }>(
      `SELECT sum(total_paise)::bigint AS total, count(*)::int AS n FROM bookings
        WHERE status = 'confirmed' AND (confirmed_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date`,
      [POLICY.timezone, from, to],
    );

    const { rows: nightsRows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM booking_nights bn
         JOIN bookings b ON b.id = bn.booking_id
        WHERE b.status = 'confirmed' AND bn.stay_date BETWEEN $1::date AND $2::date`,
      [from, to],
    );

    const { rows: roomTypeRows } = await pool.query<{ id: string }>(`SELECT id FROM room_types WHERE is_active`);
    const availability = await readAvailability(pool, { stay: { checkIn: from, checkOut: toExclusive }, roomTypeIds: roomTypeRows.map((r) => r.id) });
    const availableNights = availability.reduce((sum, a) => sum + a.allotment, 0);

    const { rows: enquiriesInWindow } = await pool.query<{ created_at: string; first_staff_reply_at: string | null }>(
      `SELECT created_at, first_staff_reply_at FROM enquiries WHERE source = 'website' AND created_at::date BETWEEN $1::date AND $2::date`,
      [from, to],
    );
    const firstReplyMinutes: number[] = [];
    let pendingCount = 0;
    for (const row of enquiriesInWindow) {
      if (row.first_staff_reply_at) {
        firstReplyMinutes.push(workingMinutesElapsed(new Date(row.created_at), new Date(row.first_staff_reply_at)));
      } else {
        pendingCount += 1;
      }
    }

    const { rows: resolvedRows } = await pool.query<{ created_at: string; resolved_at: string; reopened_count: number }>(
      `SELECT created_at, resolved_at, reopened_count FROM enquiries
        WHERE resolved_at IS NOT NULL AND resolved_at::date BETWEEN $1::date AND $2::date`,
      [from, to],
    );
    const resolutionMinutes = resolvedRows.map((r) => (new Date(r.resolved_at).getTime() - new Date(r.created_at).getTime()) / 60_000);

    response.status(200).json({
      from,
      to,
      bookingValue: {
        confirmedPaise: bookingValueRows[0]!.total ?? 0,
        bookingsCounted: bookingValueRows[0]!.n,
        taxIncluded: true,
        definition: DEFINITIONS.bookingValue,
      },
      roomNightsSold: { nights: nightsRows[0]!.n, definition: DEFINITIONS.roomNightsSold },
      allotmentUtilisation: {
        soldNights: nightsRows[0]!.n,
        availableNights,
        ratio: availableNights > 0 ? nightsRows[0]!.n / availableNights : null,
        scope: 'website_allotment',
        definition: DEFINITIONS.allotmentUtilisation,
      },
      firstReply: {
        medianMinutes: median(firstReplyMinutes),
        measuredCount: firstReplyMinutes.length,
        pendingCount,
        workingHours: '09:00-19:00 IST',
        definition: DEFINITIONS.firstReply,
      },
      resolution: {
        averageMinutes: average(resolutionMinutes),
        measuredCount: resolutionMinutes.length,
        reopenedCounts: resolvedRows.map((r) => r.reopened_count),
        definition: DEFINITIONS.resolution,
      },
      caveat: DEFINITIONS.caveat,
    });
  } catch (error) {
    next(error);
  }
}

export async function readFunnelController(request: Request, response: Response, next: NextFunction): Promise<void> {
  const parsed = reportWindowQuerySchema.safeParse(request.query);
  if (!parsed.success) return next(badRequest(parsed.error));
  const { from, to } = parsed.data;

  try {
    const { rows } = await pool.query<{ type: string; n: number }>(
      `SELECT type, count(*)::int AS n FROM analytics_events
        WHERE created_at::date BETWEEN $1::date AND $2::date
        GROUP BY type`,
      [from, to],
    );
    const counts = Object.fromEntries(rows.map((r) => [r.type, r.n])) as Record<string, number>;

    response.status(200).json({
      from,
      to,
      mainFunnel: {
        visit: counts.visit ?? 0,
        search: counts.search ?? 0,
        checkoutStarted: counts.checkout_started ?? 0,
        confirmed: counts.booking_confirmed ?? 0,
        definition: 'visit -> search -> checkout_started -> booking_confirmed, each counted once per deduped analytics event (dedupe_key).',
      },
      enquiryFunnel: {
        visit: counts.visit ?? 0,
        enquirySubmitted: counts.enquiry_submitted ?? 0,
        definition: 'visit -> enquiry_submitted, reported as a separate conversion from the booking funnel (RP-11).',
      },
      caveat: DEFINITIONS.caveat,
    });
  } catch (error) {
    next(error);
  }
}
