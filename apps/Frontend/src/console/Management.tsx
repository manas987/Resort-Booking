import { Select, DateInput } from '../components/FormControls';
import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Eye, Plus, Save, Users } from 'lucide-react';
import { useConsole } from './store';
import { dateText, timeText, type Employee, type Fact, type Promo } from './model';
import { Badge, Drawer, Field, PageHeading, SearchBox, Table } from './ui';
import { useUnsaved } from './useUnsaved';
/** Who used this code, and whether the usage is still only held. `promo_redemptions` tracks
 *  held/consumed/released separately because capacity is reserved at hold time and released if
 *  the hold lapses — so "used" on the list above is not the same number as bookings that
 *  actually completed, and an admin deciding whether to raise a limit needs to see which. */
function Redemptions({ promoId }: { promoId: string }) {
  const { state } = useConsole();
  const rows = state.redemptions.filter((r) => r.promo === promoId);
  if (rows.length === 0) {
    return (
      <div className="c-redemptions">
        <h3>Redemptions</h3>
        <p className="c-muted">This code has not been used yet.</p>
      </div>
    );
  }
  return (
    <div className="c-redemptions">
      <h3>Redemptions</h3>
      <ul>
        {rows.map((r) => (
          <li key={r.id}>
            <span>{r.bookingId}</span>
            <Badge>{r.state}</Badge>
            <small>
              {dateText(r.createdAt)} · {timeText(r.createdAt)}
            </small>
          </li>
        ))}
      </ul>
      <p className="c-muted">
        Held usage is reserved against an unpaid booking and returns to the pool if that hold
        lapses. Only consumed rows are completed bookings.
      </p>
    </div>
  );
}

function PromoForm({ promo, onClose }: { promo: Promo; onClose: () => void }) {
  const { exec } = useConsole();
  const [value, setValue] = useState(promo);
  const [dirty, setDirty] = useState(false);
  useUnsaved(dirty);
  return (
    <Drawer title={promo.code ? 'Edit promo code' : 'Create promo code'} onClose={onClose} dirty={dirty}>
      <form
        className="c-stack"
        onChange={() => setDirty(true)}
        onSubmit={(e) => {
          e.preventDefault();
          if (exec({ type: 'promo', promo: value })) onClose();
        }}
      >
        <Field label="Code">
          <input
            required
            minLength={3}
            maxLength={24}
            pattern="[A-Z0-9_-]+"
            value={value.code}
            onChange={(e) => setValue({ ...value, code: e.target.value.toUpperCase() })}
          />
        </Field>
        <Field label="Discount type">
          <Select value={value.type} onChange={(e) => setValue({ ...value, type: e.target.value as Promo['type'] })}>
            <option>Percentage</option>
            <option>Fixed INR</option>
          </Select>
        </Field>
        <Field label={value.type === 'Percentage' ? 'Discount percentage' : 'Discount · INR'}>
          <input
            required
            type="number"
            min="0.01"
            max={value.type === 'Percentage' ? 100 : undefined}
            step="0.01"
            value={value.value}
            onChange={(e) => setValue({ ...value, value: Number(e.target.value) })}
          />
        </Field>
        <Field label="Expiry · checked at booking time">
          <DateInput
            required
            type="date"
            value={value.expiry}
            onChange={(e) => setValue({ ...value, expiry: e.target.value })}
          />
        </Field>
        <Field label={`Usage limit · ${value.used} already used`}>
          <input
            required
            type="number"
            min={Math.max(1, value.used)}
            step="1"
            value={value.limit}
            onChange={(e) => setValue({ ...value, limit: Number(e.target.value) })}
          />
        </Field>
        <Field label="Status">
          <Select
            value={String(value.active)}
            onChange={(e) => setValue({ ...value, active: e.target.value === 'true' })}
          >
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </Select>
        </Field>
        <p className="c-muted">One code per booking. No stacking. Historical purchased discounts are preserved.</p>
        <button className="c-primary">
          <Save size={15} /> Save promo code
        </button>
      </form>
      <Redemptions promoId={promo.id} />
    </Drawer>
  );
}
function EmployeeForm({ employee, isNew, onClose }: { employee: Employee; isNew: boolean; onClose: () => void }) {
  const { state, actor, exec } = useConsole();
  const [value, setValue] = useState(employee);
  const [show, setShow] = useState(false);
  const [dirty, setDirty] = useState(false);
  useUnsaved(dirty);
  const unresolved = state.threads.filter((t) => t.assignee === employee.id && t.status !== 'Resolved').length;
  return (
    <Drawer title={isNew ? 'Create employee' : 'Edit employee'} onClose={onClose} dirty={dirty}>
      <form
        className="c-stack"
        onChange={() => setDirty(true)}
        onSubmit={(e) => {
          e.preventDefault();
          if (
            employee.active &&
            !value.active &&
            !window.confirm(
              `Disable ${employee.name}? ${unresolved} unresolved enquiries will move to Unassigned. All history is retained.`,
            )
          )
            return;
          if (exec({ type: 'employee', employee: value })) onClose();
        }}
      >
        <Field label="Employee name">
          <input
            required
            maxLength={100}
            value={value.name}
            onChange={(e) => setValue({ ...value, name: e.target.value })}
          />
        </Field>
        <Field label="Username">
          <input
            required
            pattern="[a-zA-Z0-9._-]{3,30}"
            value={value.username}
            onChange={(e) => setValue({ ...value, username: e.target.value })}
          />
        </Field>
        <Field label="Approved email">
          <input
            required
            type="email"
            value={value.email}
            onChange={(e) => setValue({ ...value, email: e.target.value })}
          />
        </Field>
        <Field label="Role">
          <Select
            value={value.role}
            onChange={(e) =>
              setValue({
                ...value,
                role: e.target.value as Employee['role'],
                team: e.target.value === 'staff' ? 'reservations' : '',
              })
            }
          >
            <option value="staff">Staff</option>
            {actor.role === 'owner' && <option value="gm">GM</option>}
          </Select>
        </Field>
        {value.role === 'staff' && (
          <Field label="Team">
            <Select
              value={value.team}
              onChange={(e) => setValue({ ...value, team: e.target.value as Employee['team'] })}
            >
              <option value="reservations">Reservations</option>
              <option value="sales">Sales</option>
            </Select>
          </Field>
        )}
        {isNew && (
          <Field
            label="Initial password"
            hint="Hand this to the employee directly. This tab is not wired to the staff API yet, so no account is created and nothing is stored."
          >
            <span className="c-password">
              <input
                required
                type={show ? 'text' : 'password'}
                minLength={12}
                name="initial-password"
                autoComplete="new-password"
              />
              <button type="button" onClick={() => setShow(!show)}>
                {show ? 'Hide' : 'Show'}
              </button>
            </span>
          </Field>
        )}
        <Field label="Account status">
          <Select
            value={String(value.active)}
            onChange={(e) => setValue({ ...value, active: e.target.value === 'true' })}
          >
            <option value="true">Active</option>
            <option value="false">Disabled</option>
          </Select>
        </Field>
        {!value.active && (
          <div className="c-warning">
            {unresolved} unresolved enquiries will become Unassigned. Messages, resolved history and audit records
            remain.
          </div>
        )}
        <button className="c-primary">
          <Users size={15} />
          {isNew ? 'Create employee' : 'Save employee'}
        </button>
      </form>
    </Drawer>
  );
}
function FactEditor({ fact }: { fact: Fact }) {
  const { exec } = useConsole();
  const [text, setText] = useState(fact.text);
  const [preview, setPreview] = useState(false);
  const [editing, setEditing] = useState(false);
  const [version] = useState(fact.version);
  const dirty = editing && text !== fact.text;
  useUnsaved(dirty);
  return (
    <article className="c-panel c-fact-editor">
      <header className="c-panel-heading">
        <div>
          <h2>{fact.title}</h2>
          <small>
            Version {fact.version} · {fact.editor} · {dateText(fact.updated)}
          </small>
        </div>
        <div className="c-inline-actions">
          {editing ? (
            <button className="c-button" onClick={() => setPreview(!preview)}>
              <Eye size={15} />
              {preview ? 'Editor' : 'Preview'}
            </button>
          ) : (
            <button className="c-primary" onClick={() => setEditing(true)}>
              Edit information
            </button>
          )}
        </div>
      </header>
      <div className="c-fact-body">
        {editing && !preview ? (
          <Field label="Approved resort information">
            <textarea rows={12} value={text} maxLength={10000} onChange={(e) => setText(e.target.value)} />
          </Field>
        ) : (
          <p className="c-preserve-lines">{editing ? text : fact.text}</p>
        )}
        <div className="c-callout">
          Used for staff-reviewed enquiry drafts. Rates and availability come from structured room data, not this text.
        </div>
        {editing && (
          <div className="c-inline-actions">
            <button
              className="c-button"
              onClick={() => {
                if (!dirty || window.confirm('Discard unsaved changes?')) {
                  setText(fact.text);
                  setEditing(false);
                  setPreview(false);
                }
              }}
            >
              Cancel
            </button>
            <button
              className="c-primary"
              disabled={!text.trim()}
              onClick={() => {
                if (exec({ type: 'fact', id: fact.id, text, version })) setEditing(false);
              }}
            >
              Save approved version
            </button>
          </div>
        )}
        <details className="c-version-history">
          <summary>Version history ({fact.history.length + 1})</summary>
          <div>
            <strong>v{fact.version} · Current approved version</strong>
            <p>{fact.text}</p>
          </div>
          {fact.history.map((h) => (
            <div key={h.version}>
              <strong>
                v{h.version} · {h.editor} · {dateText(h.time)}
              </strong>
              <p>{h.text}</p>
            </div>
          ))}
        </details>
      </div>
    </article>
  );
}
export default function Management() {
  const { state, actor } = useConsole();
  const [path] = useLocation();
  const tab = path.split('/')[3] || 'promos';
  const [search, setSearch] = useState('');
  const [promo, setPromo] = useState<Promo | null>(null);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [factId, setFactId] = useState(state.facts[0].id);
  const newPromo = () =>
    setPromo({
      id: crypto.randomUUID(),
      code: '',
      type: 'Percentage',
      value: 10,
      expiry: '2026-12-31',
      limit: 100,
      used: 0,
      active: true,
    });
  const newEmployee = () =>
    setEmployee({
      id: crypto.randomUUID(),
      name: '',
      username: '',
      email: '',
      role: 'staff',
      team: 'reservations',
      active: true,
      lastLogin: '',
    });
  return (
    <>
      <PageHeading
        title="Management"
        description="Keep your offers, approved information and team in order."
        actions={
          tab === 'promos' ? (
            <button className="c-primary" onClick={newPromo}>
              <Plus size={15} /> Create promo code
            </button>
          ) : tab === 'team' ? (
            <button className="c-primary" onClick={newEmployee}>
              <Plus size={15} /> Create employee
            </button>
          ) : undefined
        }
      />
      <div className="c-tabs">
        {[
          ['promos', 'Promo codes'],
          ['information', 'Resort information'],
          ['team', 'Employee accounts'],
        ].map(([id, title]) => (
          <Link key={id} className={tab === id ? 'active' : ''} href={`/console/management/${id}`}>
            {title}
          </Link>
        ))}
      </div>
      {tab !== 'information' && (
        <div className="c-toolbar">
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder={tab === 'team' ? 'Search employees…' : 'Search promo codes…'}
          />
        </div>
      )}
      {tab === 'promos' ? (
        <Table
          rows={state.promos.filter((p) => p.code.toLowerCase().includes(search.toLowerCase()))}
          id={(p) => p.id}
          onOpen={setPromo}
          columns={[
            { key: 'code', label: 'Code', value: (p) => p.code, render: (p) => <strong>{p.code}</strong> },
            {
              key: 'value',
              label: 'Discount',
              render: (p) => (p.type === 'Percentage' ? `${p.value}%` : `₹${p.value}`),
            },
            { key: 'expiry', label: 'Expiry', value: (p) => p.expiry, render: (p) => dateText(p.expiry) },
            { key: 'usage', label: 'Used / limit', numeric: true, render: (p) => `${p.used} / ${p.limit}` },
            { key: 'status', label: 'Status', render: (p) => <Badge>{p.active ? 'Active' : 'Inactive'}</Badge> },
          ]}
        />
      ) : tab === 'team' ? (
        <Table
          rows={state.employees.filter((e) =>
            `${e.name} ${e.username} ${e.email}`.toLowerCase().includes(search.toLowerCase()),
          )}
          id={(e) => e.id}
          columns={[
            {
              key: 'name',
              label: 'Employee',
              value: (e) => e.name,
              render: (e) => (
                <div className="c-person-cell">
                  <span className="c-avatar">{e.name[0]}</span>
                  <span>
                    <strong>{e.name}</strong>
                    <small>{e.username}</small>
                  </span>
                </div>
              ),
            },
            { key: 'email', label: 'Approved email', render: (e) => e.email },
            {
              key: 'role',
              label: 'Role / team',
              render: (e) => (
                <>
                  <Badge>{e.role.toUpperCase()}</Badge>
                  <small>{e.team || 'Management'}</small>
                </>
              ),
            },
            { key: 'status', label: 'Status', render: (e) => <Badge>{e.active ? 'Active' : 'Disabled'}</Badge> },
            {
              key: 'open',
              label: 'Open enquiries',
              numeric: true,
              render: (e) => state.threads.filter((t) => t.assignee === e.id && t.status !== 'Resolved').length,
            },
            {
              key: 'last',
              label: 'Last sign-in',
              render: (e) => (e.lastLogin ? dateText(e.lastLogin) : 'Not yet signed in'),
            },
            {
              key: 'actions',
              label: 'Actions',
              render: (e) =>
                e.role !== 'owner' && (actor.role === 'owner' || e.role === 'staff') ? (
                  <button className="c-text-button" onClick={() => setEmployee(e)}>
                    Edit employee
                  </button>
                ) : (
                  <span className="c-muted">Protected</span>
                ),
            },
          ]}
        />
      ) : tab === 'information' ? (
        <div className="c-information-layout">
          <nav className="c-section-nav" aria-label="Information sections">
            {state.facts.map((f) => (
              <button key={f.id} className={factId === f.id ? 'active' : ''} onClick={() => setFactId(f.id)}>
                {f.title}
              </button>
            ))}
          </nav>
          {state.facts.map((f) => (
            <div key={f.id} hidden={factId !== f.id}>
              <FactEditor key={`${f.id}-${f.version}`} fact={f} />
            </div>
          ))}
        </div>
      ) : (
        <p>Choose a management tab above.</p>
      )}
      {promo && <PromoForm promo={promo} onClose={() => setPromo(null)} />}
      {employee && (
        <EmployeeForm
          employee={employee}
          isNew={!state.employees.some((e) => e.id === employee.id)}
          onClose={() => setEmployee(null)}
        />
      )}
    </>
  );
}
