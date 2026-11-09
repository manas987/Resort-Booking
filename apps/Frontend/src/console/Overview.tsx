import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowUpRight, ArrowRight } from 'lucide-react';
import { adminFetch, AdminApiError, getStaffPrincipal } from './api';
import { dateText, money } from './model';
import { useLiveReport } from './liveReport';
import { Badge, Metrics, PageHeading, Table } from './ui';

/**
 * The landing screen. Every role sees a different cut, and those branches are the permission
 * model rather than decoration — each one asks only for what the server would grant it:
 *
 *   owner → `/reports/*` (requireOwner) and `/audit` (requireOwner)
 *   gm    → `/staff` (requireGm)
 *   all   → `/enquiries`, `/bookings`, `/rooms`, `/bookingCalendar` (requireEmployee)
 *
 * The activity panel is fetched ONLY for an owner. Asking for `/audit` as anyone else would be
 * a guaranteed 403 — hidden UI is not a control (INV-33), but neither is a request you know
 * will be refused.
 */

type EnquiryRow = {
  enquiryId: string;
  publicRef: string;
  status: 'new' | 'in_progress' | 'awaiting_guest' | 'resolved';
  category: string | null;
  assigneeId: string | null;
  contactName: string | null;
  isComplaint: boolean;
  needsReview: boolean;
  createdAt: string;
  lastActivityAt: string;
};
type BookingRow = { bookingId: string; reference: string; status: string; checkIn: string; checkOut: string; guestName: string };
type RoomRow = { id: string; name: string };
type CalendarDay = { roomTypeId: string; stayDate: string; confirmed: number; held: number; remaining: number };
type StaffRow = { id: string; name: string; role: string; team: string | null; isActive: boolean };
type AuditRow = { id: string; action: string; targetKind: string; actorUserId: string | null; createdAt: string };

function tomorrow(date: string): string {
  const at = new Date(`${date}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + 1);
  return at.toISOString().slice(0, 10);
}

const STATUS_LABEL: Record<EnquiryRow['status'], string> = {
  new: 'New',
  in_progress: 'In progress',
  awaiting_guest: 'Awaiting guest',
  resolved: 'Resolved',
};
export default function Overview() {
  const [, navigate] = useLocation();
  const principal = getStaffPrincipal();
  const owner = principal?.role === 'owner';
  const gm = principal?.role === 'gm';
  const actorName = principal?.name ?? 'there';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const monthStart = `${today.slice(0, 7)}-01`;

  const [threads, setThreads] = useState<EnquiryRow[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [todayDays, setTodayDays] = useState<CalendarDay[]>([]);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [recent, setRecent] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Owner-only; `enabled` keeps a non-owner from ever issuing the request.
  const { data: r } = useLiveReport(monthStart, today, owner);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [enquiryBody, counts, bookingBody, roomBody, calendarBody] = await Promise.all([
        adminFetch<{ items: EnquiryRow[] }>('/enquiries?limit=100'),
        adminFetch<{ unread: number }>('/enquiries/counts'),
        adminFetch<{ items: BookingRow[] }>('/bookings?status=confirmed&limit=100'),
        adminFetch<{ rooms: RoomRow[] }>('/rooms'),
        adminFetch<{ days: CalendarDay[] }>(`/bookingCalendar?from=${today}&to=${tomorrow(today)}`),
      ]);
      setThreads(enquiryBody.items);
      setUnreadCount(counts.unread);
      setBookings(bookingBody.items);
      setRooms(roomBody.rooms);
      setTodayDays(calendarBody.days.filter((d) => d.stayDate === today));
    } catch (failure) {
      setError(failure instanceof AdminApiError ? failure.message : 'Could not load the overview.');
    } finally {
      setLoading(false);
    }
  }, [today]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  useEffect(() => {
    if (!gm) return;
    adminFetch<{ staff: StaffRow[] }>('/staff')
      .then((body) => setStaff(body.staff.filter((e) => e.isActive)))
      .catch(() => setStaff([]));
  }, [gm]);

  useEffect(() => {
    if (!owner) return;
    adminFetch<{ items: AuditRow[] }>(`/audit?limit=5`)
      .then((body) => setRecent(body.items))
      .catch(() => setRecent([]));
  }, [owner]);

  const open = threads.filter((t) => t.status !== 'resolved');
  const metrics = owner
    ? [
        { label: 'Website booking value', value: money(r?.value ?? 0), note: 'This month · confirmed · includes tax' },
        { label: 'Room nights sold', value: r?.sold ?? 0, note: 'This month · stay dates' },
        {
          label: 'Website allotment utilisation',
          value: `${r?.utilisation?.toFixed(1) || 0}%`,
          note: 'Website inventory only',
        },
        {
          label: 'Median first reply',
          value: !r || r.median === null ? '—' : `${r.median.toFixed(0)} min`,
          note: 'Delivered human replies · calendar time',
        },
      ]
    : gm
      ? [
          { label: 'Open enquiries', value: open.length, note: 'Across reservations & sales' },
          { label: 'Unassigned', value: open.filter((t) => !t.assigneeId).length, note: 'Needs a named owner' },
          {
            label: 'Needs review',
            value: open.filter((t) => t.needsReview).length,
            note: 'Uncertain or failed AI processing',
          },
          {
            label: 'Complaints',
            value: open.filter((t) => t.isComplaint).length,
            note: 'GM attention required',
          },
        ]
      : [
          { label: 'Your open enquiries', value: open.length, note: 'Assigned to you' },
          {
            label: 'Unread activity',
            value: unreadCount,
            note: 'Across your conversations',
          },
          {
            label: 'Arrivals today',
            value: bookings.filter((b) => b.checkIn === today).length,
            note: 'All website bookings',
          },
          {
            label: 'Departures today',
            value: bookings.filter((b) => b.checkOut === today).length,
            note: 'All website bookings',
          },
        ];
  return (
    <>
      <PageHeading
        title={`Good morning, ${actorName.split(' ')[0]}.`}
        description={`${dateText(today)} · Here’s what needs your attention at the estate.`}
        actions={
          <Link className="c-button" href={owner ? '/console/reports' : '/console/enquiries'}>
            {owner ? 'View full reports' : 'Open enquiries'}
            <ArrowUpRight size={15} />
          </Link>
        }
      />
      {error && (
        <p className="c-error" role="alert">
          {error}{' '}
          <button type="button" className="c-linkish" onClick={() => void load()}>
            Try again
          </button>
        </p>
      )}
      {loading && !error && <p role="status">Loading your overview…</p>}
      <Metrics items={metrics} />
      <div className="c-overview-grid">
        <section className="c-panel">
          <header className="c-panel-heading">
            <div>
              <h2>{owner ? 'Website booking performance' : 'Needs your attention'}</h2>
              <p>{owner ? 'November 2026' : 'Open conversations, with waiting work first'}</p>
            </div>
            <Link href={owner ? '/console/reports' : '/console/enquiries'} className="c-text-button">
              View all <ArrowRight size={14} />
            </Link>
          </header>
          {owner ? (
            <div className="c-overview-bars">
              {(r?.series ?? [])
                .filter((d) => d.value > 0)
                .map((d) => (
                  <div key={d.date}>
                    <span>{dateText(d.date).slice(0, 6)}</span>
                    <div>
                      <i style={{ width: `${(d.value / Math.max(...(r?.series ?? []).map((v) => v.value), 1)) * 100}%` }} />
                    </div>
                    <strong>{money(d.value)}</strong>
                  </div>
                ))}
            </div>
          ) : (
            <Table
              rows={open}
              id={(t) => t.enquiryId}
              onOpen={(t) => navigate(`/console/enquiries/${t.enquiryId}`)}
              columns={[
                {
                  key: 'name',
                  label: 'Guest / enquiry',
                  render: (t) => (
                    <>
                      <strong>{t.contactName ?? 'Unnamed guest'}</strong>
                      <small>{t.publicRef}</small>
                    </>
                  ),
                },
                { key: 'category', label: 'Category', render: (t) => <Badge>{t.category ?? 'Unsorted'}</Badge> },
                {
                  key: 'waiting',
                  label: 'Waiting since',
                  // `new` is "received, awaiting staff response" (§16); anything further along
                  // has had a reply, so the wait is the guest's, not ours.
                  render: (t) =>
                    t.status === 'new'
                      ? `${Math.max(0, Math.round((Date.parse(today) - Date.parse(t.createdAt)) / 60000))} min`
                      : 'Guest response',
                },
                { key: 'status', label: 'Status', render: (t) => <Badge>{STATUS_LABEL[t.status]}</Badge> },
              ]}
            />
          )}
        </section>
        <section className="c-panel">
          <header className="c-panel-heading">
            <div>
              <h2>{owner ? 'Booking conversion' : gm ? 'Team workload' : 'Today at the estate'}</h2>
              <p>
                {owner
                  ? 'Visit → search → checkout → confirmed'
                  : gm
                    ? 'Open assignments by employee'
                    : 'Arrivals & departures · read-only'}
              </p>
            </div>
          </header>
          {owner ? (
            <div className="c-overview-funnel">
              {(r?.funnel ?? []).map((f) => (
                <div key={f.label}>
                  <span>{f.label}</span>
                  <strong>{f.count}</strong>
                </div>
              ))}
              <Link className="c-text-button" href="/console/reports">
                Explore the funnel <ArrowUpRight size={14} />
              </Link>
            </div>
          ) : gm ? (
            <div className="c-workload">
              {staff.map((e) => (
                <div key={e.id}>
                  <span className="c-avatar">{e.name[0]}</span>
                  <span>
                    <strong>{e.name}</strong>
                    <small>{e.team || e.role.toUpperCase()}</small>
                  </span>
                  <b>{open.filter((t) => t.assigneeId === e.id).length}</b>
                </div>
              ))}
            </div>
          ) : (
            <div className="c-today-bookings">
              {bookings
                .filter((b) => b.checkIn === today || b.checkOut === today)
                .map((b) => (
                  <button key={b.bookingId} onClick={() => navigate(`/console/bookings/${b.bookingId}`)}>
                    <span>
                      <strong>{b.guestName}</strong>
                      <small>{b.reference}</small>
                    </span>
                    <Badge>{b.checkIn === today ? 'Arrival' : 'Departure'}</Badge>
                  </button>
                ))}
              {!bookings.some((b) => b.checkIn === today || b.checkOut === today) && (
                <p>No arrivals or departures today.</p>
              )}
            </div>
          )}
        </section>
      </div>
      <div className="c-overview-grid">
        <section className="c-panel">
          <header className="c-panel-heading">
            <h2>Website availability today</h2>
            <Link href="/console/rooms" className="c-text-button">
              View calendar <ArrowUpRight size={14} />
            </Link>
          </header>
          <div className="c-availability-summary">
            {rooms.map((room) => {
              const v = todayDays.find((d) => d.roomTypeId === room.id);
              return (
                <div key={room.id}>
                  <strong>{room.name}</strong>
                  <span>
                    <b>{v?.remaining ?? 0}</b> available
                  </span>
                  <small>
                    {v?.confirmed ?? 0} confirmed · {v?.held ?? 0} held
                  </small>
                </div>
              );
            })}
          </div>
        </section>
        <section className="c-panel">
          <header className="c-panel-heading">
            <h2>{owner ? 'Recent changes' : 'Your recent activity'}</h2>
            {owner && (
              <Link href="/console/activity" className="c-text-button">
                Activity log <ArrowUpRight size={14} />
              </Link>
            )}
          </header>
          <ol className="c-recent-activity">
            {recent.map((a) => (
              <li key={a.id}>
                <strong>{a.action.replace(/[._]/g, ' ')}</strong>
                <small>
                  {a.targetKind} · {dateText(a.createdAt)}
                </small>
              </li>
            ))}
            {recent.length === 0 && <li>Your saved replies and updates will appear here.</li>}
          </ol>
        </section>
      </div>
    </>
  );
}
