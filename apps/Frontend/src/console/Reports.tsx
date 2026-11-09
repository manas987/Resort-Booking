import { DateInput } from '../components/FormControls';
import { useState } from 'react';
import { useConsole } from './store';
import { dateText, datesBetween, money } from './model';
import { report } from './reporting';
import { Empty, Field, Metrics, PageHeading, Table } from './ui';
export function ValueChart({ points }: { points: { date: string; value: number }[] }) {
  const [focused, setFocused] = useState<number | null>(null);
  if (!points.length) return <Empty text="Choose a valid reporting range." />;
  const visible =
    points.length > 62
      ? Array.from(new Set(points.map((p) => p.date.slice(0, 7)))).map((month) => ({
          date: `${month}-01`,
          value: points.filter((p) => p.date.startsWith(month)).reduce((sum, p) => sum + p.value, 0),
        }))
      : points;
  const max = Math.max(...visible.map((p) => p.value), 1);
  return (
    <div className="c-chart">
      <div className="c-chart-scale">
        <span>{money(max)}</span>
        <span>{money(max / 2)}</span>
        <span>₹0</span>
      </div>
      <div className="c-chart-plot">
        <svg viewBox="0 0 800 210" role="img" aria-label="Confirmed website booking value by confirmation date">
          <path d="M0 10H800M0 100H800M0 195H800" fill="none" stroke="#e5e7e2" strokeDasharray="4 6" />
          {visible.map((p, i) => (
            <g key={p.date}>
              <rect
                x={(i * 800) / visible.length + 3}
                y={195 - (p.value / max) * 180}
                width={Math.max(2, 800 / visible.length - 7)}
                height={Math.max(2, (p.value / max) * 180)}
                rx="3"
                fill={focused === i ? '#111' : '#91a48b'}
                tabIndex={0}
                role="graphics-symbol"
                aria-label={`${dateText(p.date)}: ${money(p.value)}`}
                onMouseEnter={() => setFocused(i)}
                onFocus={() => setFocused(i)}
                onBlur={() => setFocused(null)}
                onMouseLeave={() => setFocused(null)}
              >
                <title>{`${dateText(p.date)} · ${money(p.value)}`}</title>
              </rect>
            </g>
          ))}
        </svg>
        <div className="c-chart-labels">
          <span>{dateText(points[0].date)}</span>
          <span>
            {focused !== null && visible[focused]
              ? `${dateText(visible[focused].date)} · ${money(visible[focused].value)}`
              : points.length > 62
                ? 'Monthly totals · confirmation date'
                : 'Confirmation date'}
          </span>
          <span>{dateText(points.at(-1)!.date)}</span>
        </div>
      </div>
    </div>
  );
}
export default function Reports() {
  const { state } = useConsole();
  const [from, setFrom] = useState('2026-11-01');
  const [to, setTo] = useState('2026-11-30');
  const [tab, setTab] = useState('Bookings & value');
  const r = report(state, from, to);
  const valid = datesBetween(from, to).length > 0;
  return (
    <>
      <PageHeading
        title="Reports"
        description="Website bookings and enquiry performance. A measured view of the work."
        actions={<span className="c-scope-label">Website data only</span>}
      />
      <div className="c-toolbar">
        <Field label="From date">
          <DateInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To date">
          <DateInput type="date" min={from} value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <small>Reporting period · Asia/Kolkata</small>
      </div>
      <div className="c-tabs">
        {['Bookings & value', 'Enquiry performance', 'Conversion'].map((t) => (
          <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      {!valid ? (
        <Empty title="Check the date range" text="Select a start and end date within a two-year window." />
      ) : tab === 'Bookings & value' ? (
        <>
          <Metrics
            items={[
              {
                label: 'Confirmed booking value',
                value: money(r.value),
                note: 'Including purchased tax · confirmation date',
              },
              { label: 'Website room nights sold', value: r.sold, note: 'Stay dates · confirmed only' },
              {
                label: 'Website allotment utilisation',
                value: r.utilisation === null ? 'N/A' : `${r.utilisation.toFixed(1)}%`,
                note: 'Stay dates · held rooms excluded',
              },
            ]}
          />
          <section className="c-panel">
            <header className="c-panel-heading">
              <div>
                <h2>Booking value over time</h2>
                <p>Purchased totals including tax, by confirmation date</p>
              </div>
              <span className="c-chart-key">
                <i /> Website booking value
              </span>
            </header>
            <ValueChart points={r.series} />
          </section>
          <details className="c-data-details">
            <summary>View chart data and nightly utilisation</summary>
            <Table
              rows={r.series}
              id={(d) => d.date}
              columns={[
                { key: 'date', label: 'Date', render: (d) => dateText(d.date) },
                { key: 'value', label: 'Booking value incl. tax', numeric: true, render: (d) => money(d.value) },
                { key: 'sold', label: 'Sold room nights', numeric: true, render: (d) => d.nights },
                { key: 'allotment', label: 'Website allotment nights', numeric: true, render: (d) => d.allotment },
                {
                  key: 'util',
                  label: 'Utilisation',
                  numeric: true,
                  render: (d) => (d.allotment ? `${((d.nights / d.allotment) * 100).toFixed(1)}%` : 'N/A'),
                },
              ]}
            />
          </details>
          <div className="c-callout">
            Website inventory only, using the current calendar allotment. This report does not measure total resort occupancy or profit.
          </div>
        </>
      ) : tab === 'Enquiry performance' ? (
        <>
          <Metrics
            items={[
              {
                label: 'Median first reply',
                value: r.median === null ? '—' : `${r.median.toFixed(0)} min`,
                note: 'First delivered human reply · calendar minutes',
              },
              {
                label: 'Average resolution',
                value: r.resolution === null ? '—' : `${r.resolution.toFixed(0)} min`,
                note: 'Resolved, never-reopened threads only',
              },
              { label: 'Unanswered', value: r.unanswered, note: 'No delivered staff reply' },
              { label: 'Reopened', value: r.reopened, note: 'Guest replies after resolution' },
            ]}
          />
          <section className="c-panel">
            <header className="c-panel-heading">
              <h2>Response coverage</h2>
              <span>{r.threads.length} enquiries received in range</span>
            </header>
            <div className="c-coverage">
              <div>
                <span style={{ width: `${r.threads.length ? (r.replied / r.threads.length) * 100 : 0}%` }} />
              </div>
              <p>
                {r.replied} with a delivered reply · {r.unanswered} unanswered
              </p>
            </div>
          </section>
          <Table
            rows={state.employees.filter((e) => e.active)}
            id={(e) => e.id}
            columns={[
              { key: 'name', label: 'Employee', render: (e) => e.name },
              { key: 'team', label: 'Team', render: (e) => e.team || e.role.toUpperCase() },
              {
                key: 'open',
                label: 'Open assignments',
                numeric: true,
                render: (e) => r.threads.filter((t) => t.assignee === e.id && t.status !== 'Resolved').length,
              },
              {
                key: 'waiting',
                label: 'Without a delivered reply',
                numeric: true,
                render: (e) =>
                  r.threads.filter(
                    (t) =>
                      t.assignee === e.id && !t.messages.some((m) => m.kind === 'staff' && m.delivery === 'Delivered'),
                  ).length,
              },
            ]}
          />
          <p className="c-muted">
            Calendar minutes, not working-hours SLA. AI drafts, internal notes and failed delivery do not count as
            replies. Unresolved threads are excluded from resolution averages and remain visible in workload.
          </p>
        </>
      ) : (
        <>
          <section className="c-panel">
            <header className="c-panel-heading">
              <div>
                <h2>Website booking funnel</h2>
                <p>Visitor sessions, by visit date</p>
              </div>
            </header>
            <div className="c-funnel">
              {r.funnel.map((step, i) => {
                const previous = i ? r.funnel[i - 1].count : step.count;
                return (
                  <article key={step.label}>
                    <span>
                      0{i + 1} · {step.label}
                    </span>
                    <strong>{step.count}</strong>
                    <div>
                      <i style={{ width: `${r.funnel[0].count ? (step.count / r.funnel[0].count) * 100 : 0}%` }} />
                    </div>
                    <small>
                      {previous ? `${((step.count / previous) * 100).toFixed(1)}%` : 'N/A'} from previous step
                    </small>
                    <small>
                      {r.funnel[0].count
                        ? `${((step.count / r.funnel[0].count) * 100).toFixed(1)}% overall`
                        : 'No visits'}
                    </small>
                    <small>{i ? previous - step.count : 0} drop-off</small>
                  </article>
                );
              })}
            </div>
          </section>
          <section className="c-panel c-enquiry-conversion">
            <div>
              <h2>Visit → website enquiry</h2>
              <p>Separate from the booking funnel</p>
            </div>
            <strong>
              {r.funnel[0].count} → {r.websiteEnquiries}
            </strong>
            <span>{r.funnel[0].count ? `${((r.websiteEnquiries / r.funnel[0].count) * 100).toFixed(1)}%` : 'N/A'}</span>
          </section>
          <p className="c-muted">
            Sessions are counted once per cohort. Enquiry conversions are shown separately from bookings.
          </p>
        </>
      )}
    </>
  );
}
