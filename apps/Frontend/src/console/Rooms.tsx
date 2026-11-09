import { Select, DateInput } from '../components/FormControls';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'wouter';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { adminFetch, AdminApiError, getStaffPrincipal } from './api';
import { dateText, datesBetween, money } from './model';
import { Badge, Drawer, Field, PageHeading } from './ui';

/**
 * Website inventory, read from the staff API. Visible to every employee (`pageAllowed`), which
 * is why the per-date grid reads `GET /bookingCalendar` (`requireEmployee`) and not `/rates`
 * (`requireGm`) — sourcing rates from the GM route would 403 for reservations staff.
 *
 * This screen only READS. Changing a rate or an allotment is the Rates screen's job, behind the
 * preview-then-apply handshake; the link in the heading goes there and is shown to managers only.
 */

type RoomApi = {
  id: string;
  name: string;
  maxAdults: number;
  maxChildren: number;
  maxOccupancy: number;
  basePricePaise: number;
  physicalStock: number;
  baseAllotment: number;
  isActive: boolean;
};
type RoomDetailApi = RoomApi & { summary: string; amenities: string[] };
type CalendarDay = {
  roomTypeId: string;
  stayDate: string;
  allotment: number;
  confirmed: number;
  held: number;
  remaining: number;
  isBlackout: boolean;
  pricePaise: number;
  hasOverride: boolean;
};

function addDays(date: string, by: number): string {
  const at = new Date(`${date}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + by);
  return at.toISOString().slice(0, 10);
}

export default function Rooms() {
  const principal = getStaffPrincipal();
  const isManager = principal?.role === 'gm' || principal?.role === 'owner';
  const [tab, setTab] = useState('Website availability');
  const [from, setFrom] = useState(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date()));
  const [room, setRoom] = useState('');
  const [selected, setSelected] = useState<{ room: string; date: string } | null>(null);
  const [rooms, setRooms] = useState<RoomApi[]>([]);
  const [details, setDetails] = useState<Record<string, RoomDetailApi>>({});
  const [days, setDays] = useState<CalendarDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const dates = datesBetween(from, addDays(from, 13));
  function shift(by: number) {
    setFrom(addDays(from, by));
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // The grid is checkout-exclusive, so the window reaches one day past the last column.
      const [roomBody, calendarBody] = await Promise.all([
        adminFetch<{ rooms: RoomApi[] }>('/rooms'),
        adminFetch<{ days: CalendarDay[] }>(`/bookingCalendar?from=${from}&to=${addDays(from, 14)}`),
      ]);
      setRooms(roomBody.rooms);
      setDays(calendarBody.days);
    } catch (failure) {
      setError(failure instanceof AdminApiError ? failure.message : 'Could not load website inventory.');
    } finally {
      setLoading(false);
    }
  }, [from]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  // Amenities and the summary line live on the room DETAIL endpoint, not the list, so they are
  // fetched only when the information tab is actually opened.
  useEffect(() => {
    if (tab !== 'Room information' || rooms.length === 0) return;
    let live = true;
    Promise.all(rooms.map((r) => adminFetch<RoomDetailApi>(`/rooms/${r.id}`).catch(() => null))).then((loaded) => {
      if (!live) return;
      const byId: Record<string, RoomDetailApi> = {};
      for (const detail of loaded) if (detail) byId[detail.id] = detail;
      setDetails(byId);
    });
    return () => {
      live = false;
    };
  }, [tab, rooms]);

  const rows = rooms.filter((r) => !room || room === r.id);
  const dayFor = (roomTypeId: string, date: string) => days.find((d) => d.roomTypeId === roomTypeId && d.stayDate === date);
  const value = selected ? dayFor(selected.room, selected.date) : null;
  const selectedRoom = selected ? rooms.find((r) => r.id === selected.room) : undefined;
  return (
    <>
      <PageHeading
        title="Rooms & availability"
        description="Website inventory, separate from the resort’s agency allocations."
        actions={
          isManager ? (
            <Link className="c-primary" href="/console/rates">
              Manage rates & allotment
            </Link>
          ) : undefined
        }
      />
      <div className="c-tabs">
        {['Website availability', 'Room information'].map((t) => (
          <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      <div className="c-toolbar">
        <Field label="Room type">
          <Select value={room} onChange={(e) => setRoom(e.target.value)}>
            <option value="">All room types</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
        {tab === 'Website availability' && (
          <>
            <Field label="Start date · 14-day view">
              <DateInput type="date" required value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <button
              className="c-icon"
              disabled={!dates.length}
              aria-label="Previous 14 days"
              onClick={() => shift(-14)}
            >
              <ArrowLeft size={16} />
            </button>
            <button className="c-icon" disabled={!dates.length} aria-label="Next 14 days" onClick={() => shift(14)}>
              <ArrowRight size={16} />
            </button>
          </>
        )}
      </div>
      {error && (
        <p className="c-error" role="alert">
          {error}{' '}
          <button type="button" className="c-linkish" onClick={() => void load()}>
            Try again
          </button>
        </p>
      )}
      {loading && !error && <p role="status">Loading website inventory…</p>}
      {tab === 'Room information' ? (
        <div className="c-room-grid">
          {rows.map((r) => (
            <article className="c-panel c-room-card" key={r.id}>
              <span className="c-room-illustration">
                {r.name.includes('Villa') ? 'V' : 'R'}
                <small>{r.maxOccupancy} guests</small>
              </span>
              <h2>{r.name}</h2>
              {/* The fixture carried an invented bed configuration; `room_types` has no such
                  column. `summary` is the real, GM-editable line that belongs here. */}
              <p>
                {details[r.id]?.summary ?? `Up to ${r.maxAdults} adults and ${r.maxChildren} children`} · up to{' '}
                {r.maxOccupancy} guests
              </p>
              <div className="c-card-tags">
                {(details[r.id]?.amenities ?? []).map((a) => (
                  <Badge key={a}>{a}</Badge>
                ))}
              </div>
              <dl>
                <dt>Physical stock</dt>
                <dd>{r.physicalStock}</dd>
                <dt>Base website allotment</dt>
                <dd>{r.baseAllotment}</dd>
                <dt>Base room-only rate</dt>
                <dd>{money(r.basePricePaise)} / night</dd>
              </dl>
            </article>
          ))}
        </div>
      ) : (
        <>
          <div className="c-callout">
            Select a date cell for confirmed rooms, holds and remaining website availability. Check-in is inclusive;
            checkout is exclusive.
          </div>
          <div
            className="c-table-panel c-availability-scroll"
            tabIndex={0}
            aria-label="Website availability by room type and date, horizontally scrollable"
          >
            <table className="c-availability">
              <thead>
                <tr>
                  <th>Room type</th>
                  {dates.map((d) => (
                    <th key={d}>{dateText(d).slice(0, 6)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <th>
                      {r.name}
                      <small>
                        {r.physicalStock} physical · {r.baseAllotment} base allotment
                      </small>
                    </th>
                    {dates.map((d) => {
                      const v = dayFor(r.id, d);
                      if (!v) return <td key={d} />;
                      return (
                        <td key={d}>
                          <button
                            className={`${v.isBlackout ? 'blackout' : v.remaining === 0 ? 'sold-out' : ''} ${v.hasOverride ? 'override' : ''}`}
                            onClick={() => setSelected({ room: r.id, date: d })}
                          >
                            <strong>{v.isBlackout ? '—' : v.remaining}</strong>
                            <small>{v.isBlackout ? 'Blackout' : v.remaining ? money(v.pricePaise) : 'Sold out'}</small>
                            {v.held > 0 && <span>{v.held} held</span>}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="c-legend">
            <span>Number = available website rooms</span>
            <span>• Override</span>
            <span>▧ Blackout</span>
            <span>0 Sold out</span>
          </p>
        </>
      )}
      {selected && value && selectedRoom && (
        <Drawer title={selectedRoom.name} subtitle={dateText(selected.date)} onClose={() => setSelected(null)}>
          <dl className="c-detail-grid">
            <dt>Physical stock</dt>
            <dd>{selectedRoom.physicalStock}</dd>
            <dt>Website allotment</dt>
            <dd>{value.allotment}</dd>
            <dt>Confirmed</dt>
            <dd>{value.confirmed}</dd>
            <dt>Active holds</dt>
            <dd>{value.held}</dd>
            <dt>Available for new bookings</dt>
            <dd>
              <strong>{value.remaining}</strong>
            </dd>
            <dt>Nightly rate</dt>
            <dd>{money(value.pricePaise)}</dd>
            <dt>Setting source</dt>
            <dd>{value.hasOverride ? 'Calendar override' : 'Base setting'}</dd>
            <dt>Blackout</dt>
            <dd>{value.isBlackout ? 'Yes · existing commitments honoured' : 'No'}</dd>
          </dl>
        </Drawer>
      )}
    </>
  );
}
