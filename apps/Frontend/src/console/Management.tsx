import { Select, DateInput } from '../components/FormControls';
import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Eye, Plus, Save, Users } from 'lucide-react';
import { adminFetch, AdminApiError, getStaffPrincipal } from './api';
import { dateText, timeText } from './model';
import { Badge, Drawer, Field, PageHeading, SearchBox, Table } from './ui';
import { useUnsaved } from './useUnsaved';

/**
 * Promo codes, the approved-facts corpus and employee accounts — all `requireGm` on the server,
 * matching `pageAllowed`'s `manager(actor)`.
 *
 * Two conversions this screen owns, because the wire format and the human format differ:
 *
 *   `promo.value` is **basis points** when `kind === 'percent'` (10000 = 100%) and **paise**
 *   when `kind === 'fixed'`. Both divide by 100 for display, but they are not the same unit —
 *   10% is 1000, ₹10 is 1000, and confusing them silently changes what a guest pays.
 *
 *   `endsAt` is an ISO instant on the wire and a date in the form.
 *
 * Code and kind are immutable after creation (`updatePromoSchema` accepts neither), so those
 * inputs are disabled when editing rather than left looking editable and silently ignored.
 */

type PromoApi = {
  id: string;
  code: string;
  kind: 'percent' | 'fixed';
  value: number;
  maxUses: number | null;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
  usedCount: number;
};
type StaffApi = {
  id: string;
  username: string;
  email: string;
  name: string;
  role: 'staff' | 'gm' | 'owner';
  team: 'reservations' | 'sales' | null;
  isActive: boolean;
  lastSignInAt: string | null;
};
type FactApi = {
  key: string;
  title: string;
  body: string;
  version: number;
  isCurrent: boolean;
  editor: string | null;
  createdAt: string;
};
type RedemptionApi = { id: string; bookingId: string; state: string; createdAt: string };

/** Wire value -> the number a human types. Percent is basis points, fixed is paise. */
const toHuman = (promo: { kind: string; value: number }) => promo.value / 100;
/** The inverse. Rounded because a form can produce 10.005. */
const toWire = (human: number) => Math.round(human * 100);
/** Who used this code, and whether the usage is still only held. `promo_redemptions` tracks
 *  held/consumed/released separately because capacity is reserved at hold time and released if
 *  the hold lapses — so "used" on the list above is not the same number as bookings that
 *  actually completed, and an admin deciding whether to raise a limit needs to see which. */
function Redemptions({ promoId }: { promoId: string }) {
  const [rows, setRows] = useState<RedemptionApi[]>([]);
  useEffect(() => {
    let live = true;
    adminFetch<{ items: RedemptionApi[] }>(`/promos/${promoId}/redemptions`)
      .then((body) => live && setRows(body.items))
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, [promoId]);
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

type PromoDraft = {
  id: string;
  code: string;
  type: 'Percentage' | 'Fixed INR';
  value: number;
  expiry: string;
  limit: number;
  used: number;
  active: boolean;
};

function PromoForm({ promo, isNew, onSaved, onClose }: { promo: PromoDraft; isNew: boolean; onSaved: () => void; onClose: () => void }) {
  const [value, setValue] = useState(promo);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useUnsaved(dirty);

  async function save() {
    setBusy(true);
    setError('');
    try {
      // Dates are sent as an end-of-day instant: an expiry of the 31st must include the 31st.
      const endsAt = value.expiry ? new Date(`${value.expiry}T23:59:59.000Z`).toISOString() : null;
      if (isNew) {
        await adminFetch('/promos', {
          method: 'POST',
          body: {
            code: value.code,
            kind: value.type === 'Percentage' ? 'percent' : 'fixed',
            value: toWire(value.value),
            maxUses: value.limit,
            endsAt,
          },
        });
      } else {
        // `code` and `kind` are absent from updatePromoSchema on purpose — they are immutable.
        await adminFetch(`/promos/${value.id}`, {
          method: 'PATCH',
          body: { value: toWire(value.value), maxUses: value.limit, endsAt, isActive: value.active },
        });
      }
      setDirty(false);
      onSaved();
      onClose();
    } catch (failure) {
      setError(failure instanceof AdminApiError ? failure.message : 'That promo code could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer title={isNew ? 'Create promo code' : 'Edit promo code'} onClose={onClose} dirty={dirty}>
      <form
        className="c-stack"
        onChange={() => setDirty(true)}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Code">
          <input
            required
            minLength={3}
            maxLength={24}
            pattern="[A-Z0-9_-]+"
            disabled={!isNew}
            value={value.code}
            onChange={(e) => setValue({ ...value, code: e.target.value.toUpperCase() })}
          />
        </Field>
        <Field label="Discount type">
          <Select
            value={value.type}
            disabled={!isNew}
            onChange={(e) => setValue({ ...value, type: e.target.value as PromoDraft['type'] })}
          >
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
        {error && (
          <p className="c-error" role="alert">
            {error}
          </p>
        )}
        <button className="c-primary" disabled={busy}>
          <Save size={15} /> {busy ? 'Saving…' : 'Save promo code'}
        </button>
      </form>
      {!isNew && <Redemptions promoId={promo.id} />}
    </Drawer>
  );
}
type EmployeeDraft = {
  id: string;
  name: string;
  username: string;
  email: string;
  role: 'staff' | 'gm' | 'owner';
  team: 'reservations' | 'sales' | '';
  active: boolean;
  lastLogin: string;
};

function EmployeeForm({
  employee,
  isNew,
  actorRole,
  unresolved,
  onSaved,
  onClose,
}: {
  employee: EmployeeDraft;
  isNew: boolean;
  actorRole: string;
  unresolved: number;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(employee);
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useUnsaved(dirty);

  async function save() {
    setBusy(true);
    setError('');
    try {
      if (isNew) {
        await adminFetch('/staff', {
          method: 'POST',
          body: {
            username: value.username,
            email: value.email,
            name: value.name,
            role: value.role,
            team: value.role === 'staff' ? value.team : undefined,
            password,
          },
        });
      } else {
        await adminFetch(`/staff/${value.id}`, {
          method: 'PATCH',
          body: { name: value.name, email: value.email, role: value.role, team: value.role === 'staff' ? value.team : null },
        });
        // Disabling is its own endpoint: it reassigns the employee's open enquiries in the same
        // transaction, which a field update must not do silently.
        if (employee.active && !value.active) {
          await adminFetch(`/staff/${value.id}/disable`, { method: 'POST' });
        }
      }
      setDirty(false);
      onSaved();
      onClose();
    } catch (failure) {
      setError(failure instanceof AdminApiError ? failure.message : 'That employee could not be saved.');
    } finally {
      setBusy(false);
    }
  }

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
          void save();
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
                role: e.target.value as EmployeeDraft['role'],
                team: e.target.value === 'staff' ? 'reservations' : '',
              })
            }
          >
            <option value="staff">Staff</option>
            {actorRole === 'owner' && <option value="gm">GM</option>}
          </Select>
        </Field>
        {value.role === 'staff' && (
          <Field label="Team">
            <Select
              value={value.team}
              onChange={(e) => setValue({ ...value, team: e.target.value as EmployeeDraft['team'] })}
            >
              <option value="reservations">Reservations</option>
              <option value="sales">Sales</option>
            </Select>
          </Field>
        )}
        {isNew && (
          <Field
            label="Initial password"
            hint="Hand this to the employee directly. It is hashed with argon2id on the server and never stored or logged in plain text."
          >
            <span className="c-password">
              <input
                required
                type={show ? 'text' : 'password'}
                minLength={12}
                name="initial-password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
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
        {error && (
          <p className="c-error" role="alert">
            {error}
          </p>
        )}
        <button className="c-primary" disabled={busy}>
          <Users size={15} />
          {busy ? 'Saving…' : isNew ? 'Create employee' : 'Save employee'}
        </button>
      </form>
    </Drawer>
  );
}
function FactEditor({ fact, history, onSaved }: { fact: FactApi; history: FactApi[]; onSaved: () => void }) {
  const [text, setText] = useState(fact.body);
  const [preview, setPreview] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dirty = editing && text !== fact.body;
  useUnsaved(dirty);

  async function publish() {
    setBusy(true);
    setError('');
    try {
      // PUT publishes a NEW version; it never edits the row in place, so the previous text
      // stays readable in the history below. The AI drafter is grounded in whichever version
      // is current, so saving here changes what the model may state.
      await adminFetch('/resortInfo', { method: 'PUT', body: { key: fact.key, title: fact.title, body: text } });
      setEditing(false);
      onSaved();
    } catch (failure) {
      setError(failure instanceof AdminApiError ? failure.message : 'That version could not be published.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="c-panel c-fact-editor">
      <header className="c-panel-heading">
        <div>
          <h2>{fact.title}</h2>
          <small>
            Version {fact.version} · {fact.editor ?? 'System'} · {dateText(fact.createdAt)}
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
          <p className="c-preserve-lines">{editing ? text : fact.body}</p>
        )}
        <div className="c-callout">
          Used for staff-reviewed enquiry drafts. Rates and availability come from structured room data, not this text.
        </div>
        {editing && (
          <div className="c-inline-actions">
            {error && (
              <p className="c-error" role="alert">
                {error}
              </p>
            )}
            <button
              className="c-button"
              onClick={() => {
                if (!dirty || window.confirm('Discard unsaved changes?')) {
                  setText(fact.body);
                  setEditing(false);
                  setPreview(false);
                }
              }}
            >
              Cancel
            </button>
            <button className="c-primary" disabled={!text.trim() || busy} onClick={() => void publish()}>
              {busy ? 'Publishing…' : 'Save approved version'}
            </button>
          </div>
        )}
        <details className="c-version-history">
          <summary>Version history ({history.length || 1})</summary>
          <div>
            <strong>v{fact.version} · Current approved version</strong>
            <p>{fact.body}</p>
          </div>
          {history
            .filter((h) => !h.isCurrent)
            .map((h) => (
              <div key={h.version}>
                <strong>
                  v{h.version} · {h.editor ?? 'System'} · {dateText(h.createdAt)}
                </strong>
                <p>{h.body}</p>
              </div>
            ))}
        </details>
      </div>
    </article>
  );
}
export default function Management() {
  const principal = getStaffPrincipal();
  const actorRole = principal?.role ?? 'staff';
  const [path] = useLocation();
  const tab = path.split('/')[3] || 'promos';
  const [search, setSearch] = useState('');
  const [promo, setPromo] = useState<PromoDraft | null>(null);
  const [promoIsNew, setPromoIsNew] = useState(false);
  const [employee, setEmployee] = useState<EmployeeDraft | null>(null);
  const [employeeIsNew, setEmployeeIsNew] = useState(false);
  const [factKey, setFactKey] = useState('');
  const [promos, setPromos] = useState<PromoApi[]>([]);
  const [staff, setStaff] = useState<StaffApi[]>([]);
  const [facts, setFacts] = useState<FactApi[]>([]);
  const [factHistory, setFactHistory] = useState<FactApi[]>([]);
  const [openByAssignee, setOpenByAssignee] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [promoBody, staffBody, factBody, enquiryBody] = await Promise.all([
        adminFetch<{ items: PromoApi[] }>('/promos'),
        adminFetch<{ staff: StaffApi[] }>('/staff'),
        adminFetch<{ items: FactApi[] }>('/resortInfo'),
        adminFetch<{ items: Array<{ assigneeId: string | null; status: string }> }>('/enquiries?limit=100'),
      ]);
      setPromos(promoBody.items);
      setStaff(staffBody.staff);
      setFacts(factBody.items);
      const counts: Record<string, number> = {};
      for (const row of enquiryBody.items) {
        if (row.assigneeId && row.status !== 'resolved') counts[row.assigneeId] = (counts[row.assigneeId] ?? 0) + 1;
      }
      setOpenByAssignee(counts);
    } catch (failure) {
      setError(failure instanceof AdminApiError ? failure.message : 'Could not load management data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  const activeFactKey = factKey || facts[0]?.key || '';

  // History is fetched per section, only for the one on screen — the editor shows superseded
  // versions, and loading every key's full history to render one of them would be wasteful.
  useEffect(() => {
    if (!activeFactKey) return;
    let live = true;
    adminFetch<{ items: FactApi[] }>(`/resortInfo?key=${encodeURIComponent(activeFactKey)}&history=true`)
      .then((body) => live && setFactHistory(body.items))
      .catch(() => live && setFactHistory([]));
    return () => {
      live = false;
    };
  }, [activeFactKey, facts]);

  const toDraft = (p: PromoApi): PromoDraft => ({
    id: p.id,
    code: p.code,
    type: p.kind === 'percent' ? 'Percentage' : 'Fixed INR',
    value: toHuman(p),
    expiry: p.endsAt ? p.endsAt.slice(0, 10) : '',
    limit: p.maxUses ?? 0,
    used: p.usedCount,
    active: p.isActive,
  });

  const newPromo = () => {
    setPromoIsNew(true);
    setPromo({ id: '', code: '', type: 'Percentage', value: 10, expiry: '2026-12-31', limit: 100, used: 0, active: true });
  };
  const newEmployee = () => {
    setEmployeeIsNew(true);
    setEmployee({ id: '', name: '', username: '', email: '', role: 'staff', team: 'reservations', active: true, lastLogin: '' });
  };
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
      {error && (
        <p className="c-error" role="alert">
          {error}{' '}
          <button type="button" className="c-linkish" onClick={() => void load()}>
            Try again
          </button>
        </p>
      )}
      {loading && !error && <p role="status">Loading management data…</p>}
      {tab === 'promos' ? (
        <Table
          rows={promos.filter((p) => p.code.toLowerCase().includes(search.toLowerCase())).map(toDraft)}
          id={(p) => p.id}
          onOpen={(p) => {
            setPromoIsNew(false);
            setPromo(p);
          }}
          columns={[
            { key: 'code', label: 'Code', value: (p) => p.code, render: (p) => <strong>{p.code}</strong> },
            {
              key: 'value',
              label: 'Discount',
              render: (p) => (p.type === 'Percentage' ? `${p.value}%` : `₹${p.value}`),
            },
            { key: 'expiry', label: 'Expiry', value: (p) => p.expiry, render: (p) => (p.expiry ? dateText(p.expiry) : 'No expiry') },
            { key: 'usage', label: 'Used / limit', numeric: true, render: (p) => `${p.used} / ${p.limit || '∞'}` },
            { key: 'status', label: 'Status', render: (p) => <Badge>{p.active ? 'Active' : 'Inactive'}</Badge> },
          ]}
        />
      ) : tab === 'team' ? (
        <Table
          rows={staff
            .filter((e) => `${e.name} ${e.username} ${e.email}`.toLowerCase().includes(search.toLowerCase()))
            .map(
              (e): EmployeeDraft => ({
                id: e.id,
                name: e.name,
                username: e.username,
                email: e.email,
                role: e.role,
                team: e.team ?? '',
                active: e.isActive,
                lastLogin: e.lastSignInAt ?? '',
              }),
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
              render: (e) => openByAssignee[e.id] ?? 0,
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
                e.role !== 'owner' && (actorRole === 'owner' || e.role === 'staff') ? (
                  <button
                    className="c-text-button"
                    onClick={() => {
                      setEmployeeIsNew(false);
                      setEmployee(e);
                    }}
                  >
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
            {facts.map((f) => (
              <button key={f.key} className={activeFactKey === f.key ? 'active' : ''} onClick={() => setFactKey(f.key)}>
                {f.title}
              </button>
            ))}
          </nav>
          {facts.map((f) => (
            <div key={f.key} hidden={activeFactKey !== f.key}>
              <FactEditor
                key={`${f.key}-${f.version}`}
                fact={f}
                history={activeFactKey === f.key ? factHistory : []}
                onSaved={() => void load()}
              />
            </div>
          ))}
        </div>
      ) : (
        <p>Choose a management tab above.</p>
      )}
      {promo && (
        <PromoForm promo={promo} isNew={promoIsNew} onSaved={() => void load()} onClose={() => setPromo(null)} />
      )}
      {employee && (
        <EmployeeForm
          employee={employee}
          isNew={employeeIsNew}
          actorRole={actorRole}
          unresolved={openByAssignee[employee.id] ?? 0}
          onSaved={() => void load()}
          onClose={() => setEmployee(null)}
        />
      )}
    </>
  );
}
