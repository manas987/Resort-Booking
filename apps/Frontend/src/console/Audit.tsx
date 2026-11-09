import { Select, DateInput } from '../components/FormControls';
import { useCallback, useEffect, useState } from 'react';
import { adminFetch, AdminApiError } from './api';
import { dateText, timeText } from './model';
import { Badge, Drawer, Field, PageHeading, SearchBox, Table } from './ui';

/**
 * The owner's activity log, read from `audit_events` — the append-only table a database trigger
 * protects (INV-14). `GET /audit` is `requireOwner`, matching `pageAllowed`, so this screen is
 * never reachable by someone the server would refuse.
 *
 * The table is rendered exactly as before; only the source changed. Two fields the fixture
 * carried as prose are derived from the real row instead of invented:
 *   `target`  — `target_kind` plus the record's id.
 *   `summary` — the keys that actually differ between `before` and `after`. An audit row stores
 *               the two states, not a sentence, so the sentence is computed from them rather
 *               than written by hand.
 */

type AuditApiRow = {
  id: number;
  actorUserId: string | null;
  actorRole: string | null;
  action: string;
  targetKind: string;
  targetId: string | null;
  // Both are jsonb. Most actions store an object on each side; `rate.update` and
  // `allotment.update` store the affected per-date rows as an ARRAY in `before` and the applied
  // change as an object in `after`, so neither side can be assumed to be a plain record.
  before: unknown;
  after: unknown;
  requestId: string;
  createdAt: string;
};
type AuditRecord = {
  id: string;
  time: string;
  actor: string;
  role: string;
  action: string;
  target: string;
  summary: string;
  before: string;
  after: string;
};
type StaffMember = { id: string; name: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** `pricePaise 1450000 → 1500000` — only the keys that actually moved.
 *
 *  An audit row stores two states, not a sentence, so the sentence is computed. Three shapes to
 *  cover: object→object diffs the keys; a creation (no `before`) lists what was set; and a
 *  calendar write, whose `before` is the array of per-date rows it replaced, reports the applied
 *  change and how many dates it covered. */
function summarise(row: AuditApiRow): string {
  const before = asRecord(row.before);
  const after = asRecord(row.after);
  const replacedRows = Array.isArray(row.before) ? (row.before as unknown[]).length : 0;
  const scope = replacedRows ? ` · ${replacedRows} ${replacedRows === 1 ? 'date' : 'dates'}` : '';

  const keys = Array.from(new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]));
  const changed = keys
    .filter((key) => JSON.stringify((before ?? {})[key]) !== JSON.stringify((after ?? {})[key]))
    // Only three keys are shown; `from`/`to` are the least informative of them (the row already
    // says how many dates it covered), so they go last rather than crowding out the new value.
    .sort((a, b) => Number(a === 'from' || a === 'to') - Number(b === 'from' || b === 'to'));
  if (changed.length === 0) return `${row.action.replace(/[._]/g, ' ')}${scope}`;

  return (
    changed
      .slice(0, 3)
      .map((key) => {
        const now = JSON.stringify((after ?? {})[key]);
        if (!before) return `${key} ${now}`;
        return `${key} ${JSON.stringify(before[key])} → ${now}`;
      })
      .join(' · ') + scope
  );
}

export default function Audit() {
  const [search, setSearch] = useState('');
  const [actor, setActor] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('2026-11-01');
  const [to, setTo] = useState('2026-11-30');
  const [selected, setSelected] = useState<AuditRecord | null>(null);
  const [employees, setEmployees] = useState<StaffMember[]>([]);
  const [fetched, setFetched] = useState<AuditApiRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    adminFetch<{ staff: StaffMember[] }>('/staff')
      .then((body) => setEmployees(body.staff))
      .catch(() => setEmployees([]));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const params = [`from=${from}`, `to=${to}`, actor && `actorUserId=${actor}`, action && `action=${encodeURIComponent(action)}`, 'limit=100']
      .filter(Boolean)
      .join('&');
    try {
      const body = await adminFetch<{ items: AuditApiRow[]; nextCursor: string | null }>(`/audit?${params}`);
      setFetched(body.items);
    } catch (failure) {
      setError(failure instanceof AdminApiError ? failure.message : 'Could not load the activity log.');
    } finally {
      setLoading(false);
    }
  }, [from, to, actor, action]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  const nameFor = (id: string | null) => employees.find((e) => e.id === id)?.name ?? 'System';
  const rows: AuditRecord[] = fetched
    .map((row) => ({
      id: String(row.id),
      time: row.createdAt,
      actor: nameFor(row.actorUserId),
      role: row.actorRole ?? 'system',
      action: row.action,
      target: row.targetId ? `${row.targetKind} · ${row.targetId.slice(0, 8)}` : row.targetKind,
      summary: summarise(row),
      before: row.before ? JSON.stringify(row.before, null, 2) : '',
      after: row.after ? JSON.stringify(row.after, null, 2) : '',
    }))
    .filter((a) => `${a.target} ${a.summary} ${a.id}`.toLowerCase().includes(search.toLowerCase()));
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
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </Select>
        <Select aria-label="Action type" value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">All actions</option>
          {Array.from(new Set(fetched.map((a) => a.action))).map((a) => (
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
      {error && (
        <p className="c-error" role="alert">
          {error}{' '}
          <button type="button" className="c-linkish" onClick={() => void load()}>
            Try again
          </button>
        </p>
      )}
      {loading && !error && <p role="status">Loading the activity log…</p>}
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
