import { Select, DateInput } from '../components/FormControls';
import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { CalendarDays, Download, List, ArrowLeft, ArrowRight } from 'lucide-react';
import { adminFetch, AdminApiError, downloadAdminFile, getStaffPrincipal } from './api';
import { canExportRole, dateText, datesBetween, money } from './model';
import { Badge, Drawer, Empty, Field, PageHeading, SearchBox, Table } from './ui';

/**
 * Bookings, read from the database through `GET /admin/bookings`. Read-only by design — dates,
 * rooms, cancellation and refunds are out of scope (§29), so this screen has no mutation.
 *
 * Purchased amounts are the SNAPSHOT the guest paid, never a recomputation at today's rates:
 * every figure here comes from the booking's own columns. That is the property §32 asks a
 * reviewer to confirm after a GM changes a rate.
 *
 * The CSV is `GET /exports/bookings.csv` (`requireExporter` — not sales, INV-37). It used to be
 * assembled in the browser from fixtures, which meant the file a reviewer downloaded was not the
 * file the backend produces, and the spreadsheet-injection guard (INV-51) was never exercised.
 */

type RoomLine = { roomTypeId: string; roomName: string; quantity: number };
type BookingApiRow = {
  bookingId: string;
  reference: string;
  status: 'confirmed' | 'pending_payment' | 'payment_failed' | 'expired';
  checkIn: string;
  checkOut: string;
  guestName: string;
  guestEmail: string;
  guestPhone: string;
  totalPaise: number;
  holdExpiresAt: string | null;
  confirmedAt: string | null;
  createdAt: string;
  paymentStatus: string | null;
  refundStatus: string | null;
  rooms: RoomLine[];
};
type BookingRow = {
  id: string;
  bookingId: string;
  guest: string;
  email: string;
  phone: string;
  arrival: string;
  departure: string;
  lines: RoomLine[];
  status: string;
  payment: string;
  confirmed: string;
  holdUntil: string | null;
  total: number;
};

const STATUS_LABEL: Record<BookingApiRow['status'], string> = {
  confirmed: 'Confirmed',
  pending_payment: 'Pending payment',
  payment_failed: 'Payment failed',
  expired: 'Expired',
};

/** One badge for a booking's money state. A refund supersedes the payment that preceded it —
 *  the late-payment recovery path records a succeeded payment AND a refund, and showing
 *  "Succeeded" there would misdescribe it. */
function paymentLabel(row: BookingApiRow): string {
  // `refunds.status` is one of refund_pending | refunded | refund_failed (001_init.sql), NOT
  // the payments vocabulary — they are different columns with different check constraints.
  if (row.refundStatus === 'refunded') return 'Refunded';
  if (row.refundStatus === 'refund_failed') return 'Refund failed';
  if (row.refundStatus === 'refund_pending') return 'Processing';
  if (row.paymentStatus === 'succeeded') return 'Succeeded';
  if (row.paymentStatus === 'failed') return 'Failed';
  return 'Processing';
}

function toRow(row: BookingApiRow): BookingRow {
  return {
    id: row.reference,
    bookingId: row.bookingId,
    guest: row.guestName,
    email: row.guestEmail,
    phone: row.guestPhone,
    arrival: row.checkIn,
    departure: row.checkOut,
    lines: row.rooms,
    status: STATUS_LABEL[row.status],
    payment: paymentLabel(row),
    confirmed: row.confirmedAt ?? row.createdAt,
    holdUntil: row.holdExpiresAt,
    total: row.totalPaise,
  };
}

function nightsBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
export default function Bookings() {
  const [path, navigate] = useLocation();
  const principal = getStaffPrincipal();
  const actor = { role: principal?.role ?? 'staff', team: principal?.team ?? null };
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
  const [fetched, setFetched] = useState<BookingApiRow[]>([]);
  const [roomTypes, setRoomTypes] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const body = await adminFetch<{ items: BookingApiRow[] }>('/bookings?limit=100');
      setFetched(body.items);
    } catch (failure) {
      setError(failure instanceof AdminApiError ? failure.message : 'Could not load bookings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  useEffect(() => {
    // The filter only needs names, so no window is sent — the endpoint defaults it.
    adminFetch<{ rooms: Array<{ id: string; name: string }> }>('/rooms')
      .then((body) => setRoomTypes(body.rooms.map((r) => ({ id: r.id, name: r.name }))))
      .catch(() => setRoomTypes([]));
  }, []);

  const all = fetched.map(toRow);
  const openReference = path.split('/')[3];
  const selected = all.find((b) => b.bookingId === openReference || b.id === openReference);
  const rows = all.filter(
    (b) =>
      `${b.id} ${b.guest} ${b.email} ${b.phone}`.toLowerCase().includes(search.toLowerCase()) &&
      (!status || b.status === status) &&
      (!payment || b.payment === payment) &&
      (!room || b.lines.some((l) => l.roomTypeId === room)) &&
      (basis === 'Stay dates'
        ? b.arrival <= to && b.departure > from
        : b.confirmed.slice(0, 10) >= from && b.confirmed.slice(0, 10) <= to),
  );
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
            {canExportRole(actor.role, actor.team) && (
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
          {roomTypes.map((r) => (
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
      {error && (
        <p className="c-error" role="alert">
          {error}{' '}
          <button type="button" className="c-linkish" onClick={() => void load()}>
            Try again
          </button>
        </p>
      )}
      {loading && !error && <p role="status">Loading bookings…</p>}
      {view === 'List' ? (
        <Table
          rows={rows}
          id={(b) => b.bookingId}
          onOpen={(b) => navigate(`/console/bookings/${b.bookingId}`)}
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
              render: (b) => b.lines.map((l) => `${l.quantity} × ${l.roomName}`).join(', '),
            },
            {
              key: 'total',
              label: 'Purchased total',
              numeric: true,
              value: (b) => b.total,
              render: (b) => money(b.total),
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
                      onClick={() => navigate(`/console/bookings/${b.bookingId}`)}
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
      {openReference &&
        (selected ? (
          <BookingDetail
            bookingId={selected.bookingId}
            summary={selected}
            actorRole={actor.role}
            actorId={principal?.userId ?? ''}
            onClose={() => navigate('/console/bookings')}
          />
        ) : loading ? null : (
          <Drawer title="Booking unavailable" onClose={() => navigate('/console/bookings')}>
            <Empty text="This reference was not found." />
          </Drawer>
        ))}
      {exporting && (
        <ExportDialog
          onClose={() => setExporting(false)}
          onExport={async (exportFrom, exportTo) => {
            // The server builds the file (INV-51 escaping, one row per booked room, the audited
            // range). The browser only saves what it is handed.
            await downloadAdminFile(
              `/exports/bookings.csv?from=${exportFrom}&to=${exportTo}`,
              `quiet-estate-${exportFrom}-${exportTo}.csv`,
            );
            setExporting(false);
          }}
        />
      )}
    </>
  );
}
type BookingDetailApi = {
  bookingId: string;
  reference: string;
  roomPaise: number;
  discountPaise: number;
  taxPaise: number;
  totalPaise: number;
  holdExpiresAt: string | null;
  confirmedAt: string | null;
  createdAt: string;
  rooms: Array<{
    bookingRoomId: string;
    roomTypeId: string;
    roomName: string;
    adults: number;
    children: number;
    nights: Array<{ stayDate: string; pricePaise: number }>;
  }>;
  payments: Array<{ id: string; status: string; amountPaise: number; createdAt: string }>;
  refunds: Array<{ id: string; status: string; amountPaise: number }>;
};

function BookingDetail({
  bookingId,
  summary,
  actorRole,
  actorId,
  onClose,
}: {
  bookingId: string;
  summary: BookingRow;
  actorRole: string;
  actorId: string;
  onClose: () => void;
}) {
  const b = summary;
  const [detail, setDetail] = useState<BookingDetailApi | null>(null);
  // Captured once per open, so re-rendering the drawer cannot change what the hold countdown
  // says mid-paint (react-hooks/purity). The fixture screen read a frozen demo clock here.
  const [openedAt] = useState(() => Date.now());
  const [thread, setThread] = useState<{ enquiryId: string; assigneeId: string | null } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    adminFetch<BookingDetailApi>(`/bookings/${bookingId}`)
      .then((body) => live && setDetail(body))
      .catch((failure) => live && setError(failure instanceof AdminApiError ? failure.message : 'Could not load this booking.'));
    // A thread raised against this booking, if there is one. Server-scoped (INV-38), so staff
    // are shown only their own — the role check below is presentation, never the control.
    adminFetch<{ items: Array<{ enquiryId: string; assigneeId: string | null }> }>(`/enquiries?bookingId=${bookingId}&limit=1`)
      .then((body) => live && setThread(body.items[0] ?? null))
      .catch(() => live && setThread(null));
    return () => {
      live = false;
    };
  }, [bookingId]);

  // One entry per room TYPE, which is how the stay reads to a human: "2 × Garden Suite".
  const lines = detail
    ? Array.from(
        detail.rooms
          .reduce((grouped, room) => {
            const at = grouped.get(room.roomTypeId);
            if (at) at.quantity += 1;
            else
              grouped.set(room.roomTypeId, {
                roomTypeId: room.roomTypeId,
                roomName: room.roomName,
                quantity: 1,
                adults: room.adults,
                children: room.children,
                nightly: room.nights[0]?.pricePaise ?? 0,
              });
            return grouped;
          }, new Map<string, { roomTypeId: string; roomName: string; quantity: number; adults: number; children: number; nightly: number }>())
          .values(),
      )
    : [];
  const stayNights = nightsBetween(b.arrival, b.departure);

  return (
    <Drawer title={b.id} subtitle="Purchased booking details · read-only" onClose={onClose}>
      <div className="c-stack">
        <div className="c-inline-actions">
          <Badge>{b.status}</Badge>
          <Badge>{b.payment}</Badge>
        </div>
        {error && (
          <p className="c-error" role="alert">
            {error}
          </p>
        )}
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
          <small>{stayNights} nights · checkout exclusive</small>
          {!detail && !error && <p role="status">Loading purchased details…</p>}
          {lines.map((l) => (
            <div className="c-purchased-line" key={l.roomTypeId}>
              <strong>
                {l.quantity} × {l.roomName}
              </strong>
              <p>
                {l.adults} adults, {l.children} children per room
              </p>
              <span>
                {money(l.nightly)} per night × {stayNights} nights × {l.quantity}
              </span>
              <b>{money(l.nightly * stayNights * l.quantity)}</b>
            </div>
          ))}
        </section>
        {detail && (
          <section className="c-detail-section">
            <h3>Purchased amounts</h3>
            <dl className="c-money-list">
              <dt>Room value</dt>
              <dd>{money(detail.roomPaise)}</dd>
              <dt>Discount</dt>
              <dd>−{money(detail.discountPaise)}</dd>
              <dt>Tax snapshot</dt>
              <dd>{money(detail.taxPaise)}</dd>
              <dt>Total (including tax)</dt>
              <dd>
                <strong>{money(detail.totalPaise)}</strong>
              </dd>
            </dl>
            <p className="c-muted">Purchased amounts are preserved when current rates change.</p>
          </section>
        )}
        <section className="c-detail-section">
          <h3>Payment &amp; delivery history</h3>
          <ol className="c-timeline">
            <li>Created · {dateText(b.confirmed)}</li>
            <li>Payment · {b.payment}</li>
            {b.status === 'Confirmed' && <li>Confirmation message recorded</li>}
            {b.holdUntil &&
              (Date.parse(b.holdUntil) > openedAt ? (
                <li>
                  Hold valid until {timeTextSafe(b.holdUntil)} ·{' '}
                  {Math.ceil((Date.parse(b.holdUntil) - openedAt) / 60000)} min remaining
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
        {thread && (actorRole !== 'staff' || thread.assigneeId === actorId) && (
          <Link className="c-button" href={`/console/enquiries/${thread.enquiryId}`}>
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
function ExportDialog({ onClose, onExport }: { onClose: () => void; onExport: (from: string, to: string) => Promise<void> }) {
  const [from, setFrom] = useState('2026-11-01');
  const [to, setTo] = useState('2026-11-30');
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const valid = datesBetween(from, to).length > 0;

  // The same confirmation-date window the export itself uses, so the number shown here and the
  // number of bookings in the downloaded file are the same number.
  useEffect(() => {
    if (!valid) return;
    let live = true;
    adminFetch<{ items: unknown[] }>(`/bookings?status=confirmed&confirmedFrom=${from}&confirmedTo=${to}&limit=100`)
      .then((body) => live && setCount(body.items.length))
      .catch(() => live && setCount(null));
    return () => {
      live = false;
    };
  }, [from, to, valid]);

  return (
    <Drawer title="Export bookings" subtitle="Confirmation date · Asia/Kolkata" onClose={onClose}>
      <form
        className="c-stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid || busy) return;
          setBusy(true);
          setError('');
          onExport(from, to)
            .catch((failure) => setError(failure instanceof AdminApiError ? failure.message : 'The export did not complete.'))
            .finally(() => setBusy(false));
        }}
      >
        <Field label="From date">
          <DateInput type="date" required value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To date">
          <DateInput type="date" min={from} required value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <div className="c-callout">{valid ? (count ?? 0) : 0} confirmed bookings in range.</div>
        <p>
          One row per booked room type. Booking-level tax, discount and total are labelled as repeated and must not be
          summed across room lines.
        </p>
        {error && (
          <p className="c-error" role="alert">
            {error}
          </p>
        )}
        <button className="c-primary" disabled={!valid || busy}>
          <Download size={15} /> {busy ? 'Preparing…' : 'Download CSV'}
        </button>
      </form>
    </Drawer>
  );
}
