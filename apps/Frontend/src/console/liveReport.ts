import { useCallback, useEffect, useState } from 'react';
import { adminFetch, AdminApiError } from './api';

/**
 * The live replacement for `reporting.ts`'s `report(state, from, to)`.
 *
 * It returns the SAME shape that `Reports.tsx` and `Overview.tsx` already render, so neither
 * screen's markup changes — only where the numbers come from. Everything here is read from the
 * database through the staff API; nothing is computed from a fixture and nothing is invented.
 *
 * Endpoints, and why each one is needed:
 *
 *   GET /reports/metrics?from&to   owner-only. Booking value, room nights, utilisation, first
 *                                  reply, resolution — each with the backend's own `definition`
 *                                  string, which is what makes §32's "correctly labelled owner
 *                                  metrics" true rather than a claim.
 *   GET /reports/funnel?from&to    owner-only. Deduped analytics events.
 *   GET /bookings?confirmedFrom…   the per-day value series. The metrics endpoint returns window
 *                                  TOTALS only, and the chart is explicitly by confirmation
 *                                  date, so the daily breakdown is bucketed here from the list.
 *   GET /bookingCalendar?from&to   per-day allotment and committed nights for the same series.
 *   GET /enquiries                 the workload table and the website-enquiry conversion.
 *
 * Two honest limitations, stated rather than papered over:
 *
 * 1. `allotment`/`nights` in the series come from the calendar as it stands TODAY. Inventory is
 *    not versioned, so a historical day reflects the current configuration — the same caveat the
 *    screen already prints, and the reason `/reports/metrics` carries its own `caveat` string.
 * 2. Per-employee "without a delivered reply" uses `status === 'new'`. The list endpoint returns
 *    no per-thread reply flag, and fetching every thread's messages to colour one column would be
 *    an N+1 over the whole inbox. §16 defines `new` as "received, awaiting staff response" and an
 *    accepted staff reply moves a thread to `in_progress` automatically, so the two agree except
 *    where a status was set by hand. The global, exact figure is `firstReply.pendingCount`, which
 *    is what the headline metric uses.
 */

export type ReportThread = {
  id: string;
  assignee: string | null;
  status: 'new' | 'in_progress' | 'awaiting_guest' | 'resolved';
  source: string;
  awaitingReply: boolean;
};

export type LiveReport = {
  value: number;
  sold: number;
  utilisation: number | null;
  series: { date: string; value: number; nights: number; allotment: number }[];
  median: number | null;
  resolution: number | null;
  unanswered: number;
  replied: number;
  reopened: number;
  threads: ReportThread[];
  funnel: { label: string; count: number }[];
  websiteEnquiries: number;
  definitions: Record<string, string>;
};

type MetricsResponse = {
  bookingValue: { confirmedPaise: number; bookingsCounted: number; definition: string };
  roomNightsSold: { nights: number; definition: string };
  allotmentUtilisation: { soldNights: number; availableNights: number; ratio: number | null; definition: string };
  firstReply: { medianMinutes: number | null; measuredCount: number; pendingCount: number; definition: string };
  resolution: { averageMinutes: number | null; measuredCount: number; reopenedCounts: number[]; definition: string };
  caveat: string;
};
type FunnelResponse = {
  mainFunnel: { visit: number; search: number; checkoutStarted: number; confirmed: number; definition: string };
  enquiryFunnel: { visit: number; enquirySubmitted: number; definition: string };
};
type BookingRow = { bookingId: string; totalPaise: number; confirmedAt: string | null };
type CalendarDay = { stayDate: string; allotment: number; committed: number };
type EnquiryRow = { enquiryId: string; assigneeId: string | null; status: ReportThread['status']; source: string };

/** Walks a cursor-paginated list to the end. Capped: a report window is bounded by
 *  POLICY.pagination.maxRangeDays, so an unbounded loop here would be a bug, not a feature. */
async function fetchAll<T>(path: string, maxPages = 20): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page += 1) {
    const separator = path.includes('?') ? '&' : '?';
    const query: string = cursor ? `${path}${separator}cursor=${encodeURIComponent(cursor)}` : path;
    const body: { items: T[]; nextCursor: string | null } = await adminFetch(query);
    items.push(...body.items);
    if (!body.nextCursor) break;
    cursor = body.nextCursor;
  }
  return items;
}

/** Every date from `from` to `to` inclusive. Mirrors `model.ts`'s `datesBetween` so the series
 *  has a row per day even where nothing happened — an empty bar is information. */
function eachDate(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let at = new Date(`${from}T00:00:00Z`); at <= new Date(`${to}T00:00:00Z`); at.setUTCDate(at.getUTCDate() + 1)) {
    dates.push(at.toISOString().slice(0, 10));
  }
  return dates;
}

function addDay(date: string): string {
  const at = new Date(`${date}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + 1);
  return at.toISOString().slice(0, 10);
}

/** `confirmedAt` is an instant; the chart buckets by its DATE in the resort's timezone, which is
 *  the same basis the backend's window clause and the CSV export use. */
function resortDate(instant: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(instant));
}

export async function loadReport(from: string, to: string): Promise<LiveReport> {
  // `/bookingCalendar` requires `to > from`, while the report window allows a single day. Widen
  // by a day and drop the extra rather than refusing to draw a one-day report.
  const calendarTo = to > from ? to : addDay(to);

  const [metrics, funnel, bookings, calendar, enquiries] = await Promise.all([
    adminFetch<MetricsResponse>(`/reports/metrics?from=${from}&to=${to}`),
    adminFetch<FunnelResponse>(`/reports/funnel?from=${from}&to=${to}`),
    fetchAll<BookingRow>(`/bookings?status=confirmed&confirmedFrom=${from}&confirmedTo=${to}&limit=100`),
    adminFetch<{ days: CalendarDay[] }>(`/bookingCalendar?from=${from}&to=${calendarTo}`),
    fetchAll<EnquiryRow>(`/enquiries?limit=100`),
  ]);

  const valueByDate = new Map<string, number>();
  for (const booking of bookings) {
    if (!booking.confirmedAt) continue;
    const date = resortDate(booking.confirmedAt);
    valueByDate.set(date, (valueByDate.get(date) ?? 0) + booking.totalPaise);
  }

  const nightsByDate = new Map<string, { nights: number; allotment: number }>();
  for (const day of calendar.days) {
    const at = nightsByDate.get(day.stayDate) ?? { nights: 0, allotment: 0 };
    at.nights += day.committed;
    at.allotment += day.allotment;
    nightsByDate.set(day.stayDate, at);
  }

  const series = eachDate(from, to).map((date) => ({
    date,
    value: valueByDate.get(date) ?? 0,
    nights: nightsByDate.get(date)?.nights ?? 0,
    allotment: nightsByDate.get(date)?.allotment ?? 0,
  }));

  const threads: ReportThread[] = enquiries.map((e) => ({
    id: e.enquiryId,
    assignee: e.assigneeId,
    status: e.status,
    source: e.source,
    awaitingReply: e.status === 'new',
  }));

  return {
    value: metrics.bookingValue.confirmedPaise,
    sold: metrics.roomNightsSold.nights,
    utilisation: metrics.allotmentUtilisation.ratio === null ? null : metrics.allotmentUtilisation.ratio * 100,
    series,
    median: metrics.firstReply.medianMinutes,
    resolution: metrics.resolution.averageMinutes,
    unanswered: metrics.firstReply.pendingCount,
    replied: metrics.firstReply.measuredCount,
    reopened: metrics.resolution.reopenedCounts.reduce((sum, n) => sum + n, 0),
    threads,
    funnel: [
      { label: 'Visit', count: funnel.mainFunnel.visit },
      { label: 'Search', count: funnel.mainFunnel.search },
      { label: 'Checkout', count: funnel.mainFunnel.checkoutStarted },
      { label: 'Confirmed', count: funnel.mainFunnel.confirmed },
    ],
    websiteEnquiries: funnel.enquiryFunnel.enquirySubmitted,
    definitions: {
      bookingValue: metrics.bookingValue.definition,
      roomNightsSold: metrics.roomNightsSold.definition,
      allotmentUtilisation: metrics.allotmentUtilisation.definition,
      firstReply: metrics.firstReply.definition,
      resolution: metrics.resolution.definition,
      caveat: metrics.caveat,
    },
  };
}

export function useLiveReport(from: string, to: string, enabled = true) {
  const [data, setData] = useState<LiveReport | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(enabled);

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError('');
    try {
      setData(await loadReport(from, to));
    } catch (failure) {
      setError(failure instanceof AdminApiError ? failure.message : 'Could not load this report.');
    } finally {
      setLoading(false);
    }
  }, [from, to, enabled]);

  // Deferred a tick so the first setState is not synchronous inside the effect body
  // (react-hooks/set-state-in-effect) — the same pattern EnquiriesLive and RatesLive use.
  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  return { data, error, loading, refetch: load };
}
