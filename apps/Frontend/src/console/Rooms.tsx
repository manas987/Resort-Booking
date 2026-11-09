import { Select, DateInput } from '../components/FormControls';
import { useState } from 'react';
import { Link } from 'wouter';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useConsole } from './store';
import { dateText, datesBetween, inventory, manager, money } from './model';
import { Badge, Drawer, Field, PageHeading } from './ui';
export default function Rooms() {
  const { state, actor } = useConsole();
  const [tab, setTab] = useState('Website availability');
  const [from, setFrom] = useState('2026-11-09');
  const [room, setRoom] = useState('');
  const [selected, setSelected] = useState<{ room: string; date: string } | null>(null);
  const end = new Date(`${from || '2026-11-09'}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 13);
  const dates = datesBetween(from, Number.isNaN(end.getTime()) ? from : end.toISOString().slice(0, 10));
  function shift(by: number) {
    const next = new Date(`${from}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + by);
    setFrom(next.toISOString().slice(0, 10));
  }
  const rows = state.rooms.filter((r) => !room || room === r.id);
  const value = selected ? inventory(state, selected.room, selected.date) : null;
  return (
    <>
      <PageHeading
        title="Rooms & availability"
        description="Website inventory, separate from the resort’s agency allocations."
        actions={
          manager(actor) ? (
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
            {state.rooms.map((r) => (
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
      {tab === 'Room information' ? (
        <div className="c-room-grid">
          {rows.map((r) => (
            <article className="c-panel c-room-card" key={r.id}>
              <span className="c-room-illustration">
                {r.name === 'Estate Villa' ? 'V' : 'R'}
                <small>{r.capacity} guests</small>
              </span>
              <h2>{r.name}</h2>
              <p>
                {r.beds} · up to {r.capacity} guests
              </p>
              <div className="c-card-tags">
                {r.amenities.map((a) => (
                  <Badge key={a}>{a}</Badge>
                ))}
              </div>
              <dl>
                <dt>Physical stock</dt>
                <dd>{r.stock}</dd>
                <dt>Base website allotment</dt>
                <dd>{r.allotment}</dd>
                <dt>Base room-only rate</dt>
                <dd>{money(r.rate)} / night</dd>
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
                        {r.stock} physical · {r.allotment} base allotment
                      </small>
                    </th>
                    {dates.map((d) => {
                      const v = inventory(state, r.id, d);
                      return (
                        <td key={d}>
                          <button
                            className={`${v.blackout ? 'blackout' : v.available === 0 ? 'sold-out' : ''} ${v.overridden ? 'override' : ''}`}
                            onClick={() => setSelected({ room: r.id, date: d })}
                          >
                            <strong>{v.blackout ? '—' : v.available}</strong>
                            <small>{v.blackout ? 'Blackout' : v.available ? money(v.rate) : 'Sold out'}</small>
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
      {selected && value && (
        <Drawer
          title={state.rooms.find((r) => r.id === selected.room)!.name}
          subtitle={dateText(selected.date)}
          onClose={() => setSelected(null)}
        >
          <dl className="c-detail-grid">
            <dt>Physical stock</dt>
            <dd>{state.rooms.find((r) => r.id === selected.room)!.stock}</dd>
            <dt>Website allotment</dt>
            <dd>{value.allotment}</dd>
            <dt>Confirmed</dt>
            <dd>{value.confirmed}</dd>
            <dt>Active holds</dt>
            <dd>{value.held}</dd>
            <dt>Available for new bookings</dt>
            <dd>
              <strong>{value.available}</strong>
            </dd>
            <dt>Nightly rate</dt>
            <dd>{money(value.rate)}</dd>
            <dt>Setting source</dt>
            <dd>{value.overridden ? 'Calendar override' : 'Base setting'}</dd>
            <dt>Blackout</dt>
            <dd>{value.blackout ? 'Yes · existing commitments honoured' : 'No'}</dd>
          </dl>
        </Drawer>
      )}
    </>
  );
}
