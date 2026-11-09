import { Select, DateInput } from '../components/FormControls';
import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { CalendarDays, Download, List, ArrowLeft, ArrowRight } from 'lucide-react';
import { useConsole } from './store';
import {
  bookingCSV,
  bookingValue,
  canExport,
  dateText,
  datesBetween,
  money,
  nights,
  now,
  type Booking,
} from './model';
import { Badge, Drawer, Empty, Field, PageHeading, SearchBox, Table } from './ui';
export default function Bookings() {
  const { state, actor, exec, navigate } = useConsole();
  const [path] = useLocation();
  const [view, setView] = useState('List');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [payment, setPayment] = useState('');
  const [room, setRoom] = useState('');
  const [basis, setBasis] = useState('Stay dates');
  const [from, setFrom] = useState('2026-11-01');
  const [to, setTo] = useState('2026-11-30');
  const [exporting, setExporting] = useState(false);
  const [month, setMonth] = useState('2026-11');
  const [calendarView, setCalendarView] = useState('Month');
  const selected = state.bookings.find((b) => b.id === path.split('/')[3]);
  const rows = state.bookings.filter(
    (b) =>
      `${b.id} ${b.guest} ${b.email} ${b.phone}`.toLowerCase().includes(search.toLowerCase()) &&
      (!status || b.status === status) &&
      (!payment || b.payment === payment) &&
      (!room || b.lines.some((l) => l.room === room)) &&
      (basis === 'Stay dates'
        ? b.arrival <= to && b.departure > from
        : b.confirmed.slice(0, 10) >= from && b.confirmed.slice(0, 10) <= to),
  );
  const roomName = (id: string) => state.rooms.find((r) => r.id === id)?.name;
  const [week, setWeek] = useState('2026-11-09');
  const weekEnd = new Date(`${week}T12:00:00Z`);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
  const days =
    calendarView === 'Week'
      ? datesBetween(week, weekEnd.toISOString().slice(0, 10))
      : datesBetween(
          `${month}-01`,
          `${month}-${new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate()}`,
        );
  function shift(by: number) {
    if (calendarView === 'Week') {
      const next = new Date(`${week}T12:00:00Z`);
      next.setUTCDate(next.getUTCDate() + by * 7);
      setWeek(next.toISOString().slice(0, 10));
      return;
    }
    const date = new Date(`${month}-01T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + by);
    setMonth(date.toISOString().slice(0, 7));
  }
  return (
    <>
      <PageHeading
        title="Bookings"
        description="A clear view of your website reservations. Purchased details are read-only."
        actions={
          <>
            <div className="c-view-switch">
              <button aria-pressed={view === 'List'} onClick={() => setView('List')}>
                <List size={16} /> List
              </button>
              <button aria-pressed={view === 'Calendar'} onClick={() => setView('Calendar')}>
                <CalendarDays size={16} /> Calendar
              </button>
            </div>
            {canExport(actor) && (
              <button className="c-primary" onClick={() => setExporting(true)}>
                <Download size={15} /> Download CSV
              </button>
            )}
          </>
        }
      />
      <div className="c-toolbar">
        <SearchBox value={search} onChange={setSearch} placeholder="Reference, guest or contact…" />
        <Select aria-label="Booking status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All booking statuses</option>
          {['Confirmed', 'Pending payment', 'Payment failed', 'Expired'].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </Select>
        <Select aria-label="Payment status" value={payment} onChange={(e) => setPayment(e.target.value)}>
          <option value="">All payment statuses</option>
          {['Succeeded', 'Processing', 'Failed', 'Refunded', 'Refund failed'].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </Select>
        <Select aria-label="Room type" value={room} onChange={(e) => setRoom(e.target.value)}>
          <option value="">All room types</option>
          {state.rooms.map((r) => (
            <option value={r.id} key={r.id}>
              {r.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="c-toolbar c-date-toolbar">
        <Field label="Date basis">
          <Select value={basis} onChange={(e) => setBasis(e.target.value)}>
            <option>Stay dates</option>
            <option>Confirmation date</option>
          </Select>
        </Field>
        <Field label="From">
          <DateInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} required />
        </Field>
        <Field label="To">
          <DateInput type="date" min={from} value={to} onChange={(e) => setTo(e.target.value)} required />
        </Field>
        <button
          className="c-text-button"
          onClick={() => {
            setSearch('');
            setStatus('');
            setPayment('');
            setRoom('');
            setFrom('2026-11-01');
            setTo('2026-11-30');
          }}
        >
          Reset filters
        </button>
        <small>Asia/Kolkata · {rows.length} records</small>
      </div>
      {from > to && (
        <p className="c-error" role="alert">
          The end date must be on or after the start date.
        </p>
      )}
      {view === 'List' ? (
        <Table
          rows={rows}
          id={(b) => b.id}
          onOpen={(b) => navigate(`/console/bookings/${b.id}`)}
          columns={[
            {
              key: 'ref',
              label: 'Reference / guest',
              value: (b) => b.id,
              render: (b) => (
                <>
                  <strong>{b.id}</strong>
                  <small>{b.guest}</small>
                </>
              ),
            },
            { key: 'arrival', label: 'Check-in', value: (b) => b.arrival, render: (b) => dateText(b.arrival) },
            { key: 'departure', label: 'Checkout', value: (b) => b.departure, render: (b) => dateText(b.departure) },
            {
              key: 'rooms',
              label: 'Rooms',
              render: (b) => b.lines.map((l) => `${l.quantity} × ${roomName(l.room)}`).join(', '),
            },
            {
              key: 'total',
              label: 'Purchased total',
              numeric: true,
              value: bookingValue,
              render: (b) => money(bookingValue(b)),
            },
            { key: 'status', label: 'Booking', render: (b) => <Badge>{b.status}</Badge> },
            { key: 'payment', label: 'Payment', render: (b) => <Badge>{b.payment}</Badge> },
          ]}
        />
      ) : (
        <section className="c-panel">
          <header className="c-panel-heading">
            <div className="c-inline-actions">
              <button className="c-icon" aria-label="Previous month" onClick={() => shift(-1)}>
                <ArrowLeft size={16} />
              </button>
              <h2>{calendarView === 'Week' ? `${dateText(week)} · 7 days` : dateText(`${month}-01`).slice(3)}</h2>
              <button className="c-icon" aria-label="Next month" onClick={() => shift(1)}>
                <ArrowRight size={16} />
              </button>
            </div>
            <div className="c-inline-actions">
              <button
                className="c-button"
                onClick={() => {
                  setMonth('2026-11');
                  setWeek('2026-11-09');
                }}
              >
                Today
              </button>
              <Select aria-label="Calendar view" value={calendarView} onChange={(e) => setCalendarView(e.target.value)}>
                <option>Month</option>
                <option>Week</option>
              </Select>
            </div>
          </header>
          <p className="c-muted c-pad-inline">
            Stay dates · checkout exclusive · booking status shown separately from payment
          </p>
          <div className="c-booking-calendar">
            {days.map((d) => (
              <div className={d === '2026-11-09' ? 'today' : ''} key={d}>
                <header>
                  <strong>{Number(d.slice(-2))}</strong>
                  <small>{new Intl.DateTimeFormat('en', { weekday: 'short' }).format(new Date(`${d}T12:00:00`))}</small>
                </header>
                {rows
                  .filter((b) => b.arrival <= d && b.departure > d)
                  .map((b) => (
                    <button
                      key={b.id}
                      className={`c-calendar-booking ${b.status === 'Confirmed' ? '' : 'unconfirmed'}`}
                      onClick={() => navigate(`/console/bookings/${b.id}`)}
                    >
                      <strong>{b.guest}</strong>
                      <small>
                        {b.id} · {b.lines.reduce((n, l) => n + l.quantity, 0)} rooms
                      </small>
                      <span>{b.status}</span>
                    </button>
                  ))}
              </div>
            ))}
          </div>
        </section>
      )}
      {path.split('/')[3] &&
        (selected ? (
          <BookingDetail booking={selected} onClose={() => navigate('/console/bookings')} />
        ) : (
          <Drawer title="Booking unavailable" onClose={() => navigate('/console/bookings')}>
            <Empty text="This reference was not found." />
          </Drawer>
        ))}
      {exporting && (
        <ExportDialog
          onClose={() => setExporting(false)}
          onExport={(from, to) => {
            if (!exec({ type: 'export', from, to })) return;
            const blob = new Blob(['\uFEFF', bookingCSV(state, from, to)], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `quiet-estate-${from}-${to}.csv`;
            a.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
            setExporting(false);
          }}
        />
      )}
    </>
  );
}
function BookingDetail({ booking: b, onClose }: { booking: Booking; onClose: () => void }) {
  const { state } = useConsole();
  const thread = state.threads.find((t) => t.booking === b.id);
  const { actor } = useConsole();
  return (
    <Drawer title={b.id} subtitle="Purchased booking details · read-only" onClose={onClose}>
      <div className="c-stack">
        <div className="c-inline-actions">
          <Badge>{b.status}</Badge>
          <Badge>{b.payment}</Badge>
        </div>
        <section className="c-detail-section">
          <h3>Lead guest</h3>
          <strong>{b.guest}</strong>
          <p>{b.email}</p>
          <p>{b.phone}</p>
        </section>
        <section className="c-detail-section">
          <h3>Stay details</h3>
          <p>
            {dateText(b.arrival)} → {dateText(b.departure)}
          </p>
          <small>{nights(b)} nights · checkout exclusive</small>
          {b.lines.map((l) => (
            <div className="c-purchased-line" key={l.room}>
              <strong>
                {l.quantity} × {state.rooms.find((r) => r.id === l.room)?.name}
              </strong>
              <p>
                {l.adults} adults, {l.children} children per room
              </p>
              <span>
                {money(l.nightly)} per night × {nights(b)} nights × {l.quantity}
              </span>
              <b>{money(l.nightly * nights(b) * l.quantity)}</b>
            </div>
          ))}
        </section>
        <section className="c-detail-section">
          <h3>Purchased amounts</h3>
          <dl className="c-money-list">
            <dt>Room value</dt>
            <dd>{money(bookingValue(b) + b.discount - b.tax)}</dd>
            <dt>Discount</dt>
            <dd>−{money(b.discount)}</dd>
            <dt>Tax snapshot</dt>
            <dd>{money(b.tax)}</dd>
            <dt>Total (including tax)</dt>
            <dd>
              <strong>{money(bookingValue(b))}</strong>
            </dd>
          </dl>
          <p className="c-muted">Purchased amounts are preserved when current rates change.</p>
        </section>
        <section className="c-detail-section">
          <h3>Payment & delivery history</h3>
          <ol className="c-timeline">
            <li>Created · {dateText(b.confirmed)}</li>
            <li>Payment · {b.payment}</li>
            {b.status === 'Confirmed' && <li>Confirmation message recorded</li>}
            {b.holdUntil &&
              (Date.parse(b.holdUntil) > Date.parse(now(state)) ? (
                <li>
                  Hold valid until {timeTextSafe(b.holdUntil)} ·{' '}
                  {Math.ceil((Date.parse(b.holdUntil) - Date.parse(now(state))) / 60000)} min remaining
                </li>
              ) : (
                <li>Hold lapsed at {timeTextSafe(b.holdUntil)} · the room is back in website availability</li>
              ))}
            {b.payment === 'Refunded' && (
              <>
                <li>Late payment after hold expiry · booking not revived</li>
                <li>Automatic refund recorded · no money transferred</li>
                <li>Apology message recorded</li>
              </>
            )}
          </ol>
        </section>
        {thread && (actor.role !== 'staff' || thread.assignee === actor.id) && (
          <Link className="c-button" href={`/console/enquiries/${thread.id}`}>
            Open related enquiry
          </Link>
        )}
      </div>
    </Drawer>
  );
}
function timeTextSafe(value: string) {
  return new Intl.DateTimeFormat('en-IN', { timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(value));
}
function ExportDialog({ onClose, onExport }: { onClose: () => void; onExport: (from: string, to: string) => void }) {
  const { state } = useConsole();
  const [from, setFrom] = useState('2026-11-01');
  const [to, setTo] = useState('2026-11-30');
  const valid = datesBetween(from, to).length > 0;
  return (
    <Drawer title="Export bookings" subtitle="Confirmation date · Asia/Kolkata" onClose={onClose}>
      <form
        className="c-stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onExport(from, to);
        }}
      >
        <Field label="From date">
          <DateInput type="date" required value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To date">
          <DateInput type="date" min={from} required value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <div className="c-callout">
          {valid
            ? state.bookings.filter(
                (b) => b.status === 'Confirmed' && b.confirmed.slice(0, 10) >= from && b.confirmed.slice(0, 10) <= to,
              ).length
            : 0}{' '}
          confirmed bookings in range.
        </div>
        <p>
          One row per booked room type. Booking-level tax, discount and total are labelled as repeated and must not be
          summed across room lines.
        </p>
        <button className="c-primary" disabled={!valid}>
          <Download size={15} /> Download CSV
        </button>
      </form>
    </Drawer>
  );
}
