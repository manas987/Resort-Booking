import { Link } from 'wouter';
import { ArrowUpRight, ArrowRight } from 'lucide-react';
import { useConsole } from './store';
import { DEMO_NOW, dateText, inventory, money, visibleThreads } from './model';
import { report } from './reporting';
import { Badge, Metrics, PageHeading, Table } from './ui';
export default function Overview() {
  const { state, actor, navigate } = useConsole();
  const threads = visibleThreads(state, actor);
  const open = threads.filter((t) => t.status !== 'Resolved');
  const r = report(state, '2026-11-01', '2026-11-30');
  const today = DEMO_NOW.slice(0, 10);
  const owner = actor.role === 'owner',
    gm = actor.role === 'gm';
  const metrics = owner
    ? [
        { label: 'Website booking value', value: money(r.value), note: 'November · confirmed · includes tax' },
        { label: 'Room nights sold', value: r.sold, note: 'November stay dates' },
        {
          label: 'Website allotment utilisation',
          value: `${r.utilisation?.toFixed(1) || 0}%`,
          note: 'Website inventory only',
        },
        {
          label: 'Median first reply',
          value: r.median === null ? '—' : `${r.median.toFixed(0)} min`,
          note: 'Delivered human replies · calendar time',
        },
      ]
    : gm
      ? [
          { label: 'Open enquiries', value: open.length, note: 'Across reservations & sales' },
          { label: 'Unassigned', value: open.filter((t) => !t.assignee).length, note: 'Needs a named owner' },
          {
            label: 'Needs review',
            value: open.filter((t) => t.ai === 'Needs review' || t.ai === 'Failed').length,
            note: 'Uncertain or failed AI processing',
          },
          {
            label: 'Complaints',
            value: open.filter((t) => t.category === 'Complaint').length,
            note: 'GM attention required',
          },
        ]
      : [
          { label: 'Your open enquiries', value: open.length, note: 'Assigned to you' },
          {
            label: 'Unread activity',
            value: threads.filter((t) => t.unread).length,
            note: 'Across your conversations',
          },
          {
            label: 'Arrivals today',
            value: state.bookings.filter((b) => b.status === 'Confirmed' && b.arrival === today).length,
            note: 'All website bookings',
          },
          {
            label: 'Departures today',
            value: state.bookings.filter((b) => b.status === 'Confirmed' && b.departure === today).length,
            note: 'All website bookings',
          },
        ];
  return (
    <>
      <PageHeading
        title={`Good morning, ${actor.name.split(' ')[0]}.`}
        description={`${dateText(DEMO_NOW)} · Here’s what needs your attention at the estate.`}
        actions={
          <Link className="c-button" href={owner ? '/console/reports' : '/console/enquiries'}>
            {owner ? 'View full reports' : 'Open enquiries'}
            <ArrowUpRight size={15} />
          </Link>
        }
      />
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
              {r.series
                .filter((d) => d.value > 0)
                .map((d) => (
                  <div key={d.date}>
                    <span>{dateText(d.date).slice(0, 6)}</span>
                    <div>
                      <i style={{ width: `${(d.value / Math.max(...r.series.map((v) => v.value))) * 100}%` }} />
                    </div>
                    <strong>{money(d.value)}</strong>
                  </div>
                ))}
            </div>
          ) : (
            <Table
              rows={open}
              id={(t) => t.id}
              onOpen={(t) => navigate(`/console/enquiries/${t.id}`)}
              columns={[
                {
                  key: 'name',
                  label: 'Guest / enquiry',
                  render: (t) => (
                    <>
                      <strong>{t.name}</strong>
                      <small>{t.subject}</small>
                    </>
                  ),
                },
                { key: 'category', label: 'Category', render: (t) => <Badge>{t.category}</Badge> },
                {
                  key: 'waiting',
                  label: 'Waiting since',
                  render: (t) =>
                    t.messages.some((m) => m.kind === 'staff' && m.delivery === 'Delivered')
                      ? 'Guest response'
                      : `${Math.max(0, Math.round((Date.parse(DEMO_NOW) - Date.parse(t.created)) / 60000))} min`,
                },
                { key: 'status', label: 'Status', render: (t) => <Badge>{t.status}</Badge> },
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
              {r.funnel.map((f) => (
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
              {state.employees
                .filter((e) => e.active)
                .map((e) => (
                  <div key={e.id}>
                    <span className="c-avatar">{e.name[0]}</span>
                    <span>
                      <strong>{e.name}</strong>
                      <small>{e.team || e.role.toUpperCase()}</small>
                    </span>
                    <b>{open.filter((t) => t.assignee === e.id).length}</b>
                  </div>
                ))}
            </div>
          ) : (
            <div className="c-today-bookings">
              {state.bookings
                .filter((b) => b.status === 'Confirmed' && (b.arrival === today || b.departure === today))
                .map((b) => (
                  <button key={b.id} onClick={() => navigate(`/console/bookings/${b.id}`)}>
                    <span>
                      <strong>{b.guest}</strong>
                      <small>{b.id}</small>
                    </span>
                    <Badge>{b.arrival === today ? 'Arrival' : 'Departure'}</Badge>
                  </button>
                ))}
              {!state.bookings.some(
                (b) => b.status === 'Confirmed' && (b.arrival === today || b.departure === today),
              ) && <p>No arrivals or departures today.</p>}
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
            {state.rooms.map((room) => {
              const v = inventory(state, room.id, today);
              return (
                <div key={room.id}>
                  <strong>{room.name}</strong>
                  <span>
                    <b>{v.available}</b> available
                  </span>
                  <small>
                    {v.confirmed} confirmed · {v.held} held
                  </small>
                </div>
              );
            })}
          </div>
        </section>
        <section className="c-panel">
          <header className="c-panel-heading">
            <h2>{actor.role === 'staff' ? 'Your recent activity' : 'Recent changes'}</h2>
            {owner && (
              <Link href="/console/activity" className="c-text-button">
                Activity log <ArrowUpRight size={14} />
              </Link>
            )}
          </header>
          <ol className="c-recent-activity">
            {state.audit
              .filter((a) => actor.role !== 'staff' || a.actor === actor.name)
              .slice(0, 5)
              .map((a) => (
                <li key={a.id}>
                  <strong>{a.summary}</strong>
                  <small>
                    {a.actor} · {dateText(a.time)}
                  </small>
                </li>
              ))}
            {!state.audit.some((a) => actor.role !== 'staff' || a.actor === actor.name) && (
              <li>Your saved replies and updates will appear here.</li>
            )}
          </ol>
        </section>
      </div>
    </>
  );
}
