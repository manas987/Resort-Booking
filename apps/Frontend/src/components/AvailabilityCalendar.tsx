import { LoadingSkeleton } from './LoadingSkeleton';
import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { formatPaise } from '../lib/money';
import { useResource } from '../lib/useResource';
import type { AvailabilityCalendarResponse } from '../lib/types';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const HORIZON_DAYS = 365; // mirrors apps/Backend/src/core/policy.ts stay.bookingHorizonDays — a UX guard, not the authority

function resortToday(): Date {
  // Browser-local "today" is a display nicety here, not an authority — the backend's own
  // Asia/Kolkata "today" is what every request is actually checked against server-side.
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

/** Calendar-grid cells for one month, Monday-first, padded with nulls outside the month. */
function monthCells(monthStart: Date): Array<Date | null> {
  const firstWeekday = (monthStart.getDay() + 6) % 7; // 0 = Monday
  const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
  const cells: Array<Date | null> = Array(firstWeekday).fill(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(new Date(monthStart.getFullYear(), monthStart.getMonth(), day));
  return cells;
}

type Props = { slug: string; checkIn: string; checkOut: string };

/** Read-only availability by night; booking dates are chosen in the home-page picker. */
export function AvailabilityCalendar({ slug, checkIn, checkOut }: Props) {
  const today = useMemo(() => resortToday(), []);
  const [monthOffset, setMonthOffset] = useState(0);
  const [retryKey, setRetryKey] = useState(0);
  const viewStart = useMemo(() => addMonths(today, monthOffset), [today, monthOffset]);
  const windowFrom = toIsoDate(viewStart);
  const windowTo = toIsoDate(addDays(addMonths(viewStart, 2), -1));
  const canGoNext = Date.parse(windowTo) < Date.parse(toIsoDate(addDays(today, HORIZON_DAYS)));

  const { data, loading, error } = useResource<AvailabilityCalendarResponse>(
    (signal) => apiFetch(`/availability/calendar?slug=${slug}&from=${windowFrom}&to=${windowTo}`, { signal }),
    [slug, windowFrom, windowTo, retryKey],
  );
  const byDate = useMemo(() => new Map((data?.days ?? []).map((day) => [day.date, day])), [data]);

  function dayState(date: Date) {
    const iso = toIsoDate(date);
    const day = byDate.get(iso);
    const isPast = date < today;
    const unavailable = isPast || !day || day.remaining <= 0 || day.isBlackout;
    return { iso, day, unavailable };
  }

  return <div className="avail-cal">
    <div className="avail-cal-nav">
      <button type="button" aria-label="Previous month" disabled={monthOffset === 0} onClick={() => setMonthOffset((m) => Math.max(0, m - 1))}><ChevronLeft size={18} /></button>
      <button type="button" aria-label="Next month" disabled={!canGoNext} onClick={() => setMonthOffset((m) => m + 1)}><ChevronRight size={18} /></button>
    </div>
    {error && <p role="alert" className="avail-cal-error">Couldn't load availability. <button type="button" className="room-inline-link" onClick={() => setRetryKey((k) => k + 1)}>Try again</button></p>}
    {loading ? <LoadingSkeleton label="Checking availability…" variant="calendar" rows={35} /> : !error && data && <div className="avail-cal-months">
      {[0, 1].map((monthIndex) => {
        const monthStart = addMonths(viewStart, monthIndex);
        return <div className="avail-cal-month" key={monthIndex}>
          <p className="avail-cal-caption">{new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(monthStart)}</p>
          <div className="avail-cal-weekdays" aria-hidden="true">{WEEKDAYS.map((w, i) => <span key={i}>{w}</span>)}</div>
          <div className="avail-cal-grid">
            {monthCells(monthStart).map((date, i) => {
              if (!date) return <span key={i} className="avail-cal-cell avail-cal-cell-empty" />;
              const { iso, day, unavailable } = dayState(date);
              const inRange = !!checkIn && !!checkOut && iso >= checkIn.slice(0, 10) && iso < checkOut.slice(0, 10);
              const label = unavailable
                ? `${date.getDate()} ${monthStart.toLocaleDateString('en-IN', { month: 'long' })}, not available`
                : `${date.getDate()} ${monthStart.toLocaleDateString('en-IN', { month: 'long' })}, ${day!.remaining} room${day!.remaining === 1 ? '' : 's'} left, ${formatPaise(day!.pricePaise)} per night`;
              return <span
                key={i}
                role="img"
                className={`avail-cal-cell ${unavailable ? 'avail-cal-unavailable' : ''} ${inRange ? 'avail-cal-selected' : ''}`}
                aria-label={label}
                title={label}
              >
                <span className="avail-cal-date">{date.getDate()}</span>
                {!unavailable && day && <span className="avail-cal-count">{day.remaining} left</span>}
              </span>;
            })}
          </div>
        </div>;
      })}
    </div>}
    {!loading && !error && data && <p className="avail-cal-help">Rooms left per night. Crossed-out dates are unavailable.</p>}
  </div>;
}
