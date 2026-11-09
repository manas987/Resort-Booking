import { Select, DateInput } from '../components/FormControls';
import { useState } from 'react';
import { useConsole } from './store';
import { dateText, timeText, type Audit as AuditRecord } from './model';
import { Badge, Drawer, Field, PageHeading, SearchBox, Table } from './ui';
export default function Audit() {
  const { state } = useConsole();
  const [search, setSearch] = useState('');
  const [actor, setActor] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('2026-11-01');
  const [to, setTo] = useState('2026-11-30');
  const [selected, setSelected] = useState<AuditRecord | null>(null);
  const rows = state.audit.filter(
    (a) =>
      (!actor || a.actor === actor) &&
      (!action || a.action === action) &&
      `${a.target} ${a.summary} ${a.id}`.toLowerCase().includes(search.toLowerCase()) &&
      a.time.slice(0, 10) >= from &&
      a.time.slice(0, 10) <= to,
  );
  return (
    <>
      <PageHeading
        title="Activity log"
        description="A read-only record of important actions, including owner changes."
      />
      <div className="c-toolbar">
        <SearchBox value={search} onChange={setSearch} placeholder="Search target, reference or change…" />
        <Select aria-label="Actor" value={actor} onChange={(e) => setActor(e.target.value)}>
          <option value="">All actors</option>
          {state.employees.map((e) => (
            <option key={e.id}>{e.name}</option>
          ))}
        </Select>
        <Select aria-label="Action type" value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">All actions</option>
          {Array.from(new Set(state.audit.map((a) => a.action))).map((a) => (
            <option key={a}>{a}</option>
          ))}
        </Select>
        <Field label="From">
          <DateInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To">
          <DateInput type="date" min={from} value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
      <Table
        rows={rows}
        id={(a) => a.id}
        onOpen={setSelected}
        columns={[
          {
            key: 'time',
            label: 'Timestamp',
            value: (a) => a.time,
            render: (a) => (
              <>
                <strong>{dateText(a.time)}</strong>
                <small>{timeText(a.time)} · Asia/Kolkata</small>
              </>
            ),
          },
          {
            key: 'actor',
            label: 'Actor',
            value: (a) => a.actor,
            render: (a) => (
              <>
                {a.actor}
                <small>{a.role.toUpperCase()}</small>
              </>
            ),
          },
          { key: 'action', label: 'Action', render: (a) => a.action },
          { key: 'target', label: 'Target', render: (a) => a.target },
          { key: 'summary', label: 'Change', render: (a) => a.summary },
          { key: 'outcome', label: 'Outcome', render: () => <Badge>Recorded</Badge> },
        ]}
      />
      {selected && (
        <Drawer title={selected.action} subtitle={selected.target} onClose={() => setSelected(null)}>
          <div className="c-stack">
            <p>{selected.summary}</p>
            <dl className="c-detail-grid">
              <dt>Actor</dt>
              <dd>
                {selected.actor} · {selected.role}
              </dd>
              <dt>Time</dt>
              <dd>
                {dateText(selected.time)} · {timeText(selected.time)}
              </dd>
              <dt>Record ID</dt>
              <dd className="c-wrap">{selected.id}</dd>
            </dl>
            {selected.before && (
              <section className="c-detail-section">
                <h3>Before</h3>
                <pre className="c-audit-code">{selected.before}</pre>
              </section>
            )}
            {selected.after && (
              <section className="c-detail-section">
                <h3>After</h3>
                <pre className="c-audit-code">{selected.after}</pre>
              </section>
            )}
            <p className="c-muted">Activity records are read-only.</p>
          </div>
        </Drawer>
      )}
    </>
  );
}
