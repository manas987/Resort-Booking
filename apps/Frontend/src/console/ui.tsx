import { Select } from '../components/FormControls';
import { useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ConsoleContext } from './store';
import { X, ChevronDown, ChevronUp, ArrowLeft, ArrowRight, Search } from 'lucide-react';
export function Badge({ children }: { children: ReactNode }) {
  const text = String(children);
  const tone = /Failed|Complaint|Disabled|Expired/.test(text)
    ? 'red'
    : /review|Unassigned|Pending|New|Processing|Unknown/.test(text)
      ? 'amber'
      : /Confirmed|Delivered|Succeeded|Resolved|Active|ready/.test(text)
        ? 'green'
        : 'neutral';
  return <span className={`c-badge ${tone}`}>{children}</span>;
}
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="c-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function PageHeading({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="c-page-heading">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="c-page-actions">{actions}</div>
    </div>
  );
}
export function Empty({
  title = 'Nothing here yet',
  text,
  action,
}: {
  title?: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="c-empty">
      <span className="c-empty-mark">—</span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
export function SearchBox({
  value,
  onChange,
  placeholder = 'Search records…',
}: {
  value: string;
  onChange: (s: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="c-search">
      <Search size={16} />
      <span className="c-sr">Search</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} type="search" />
    </label>
  );
}
export function Drawer({
  title,
  subtitle,
  children,
  onClose,
  dirty = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  dirty?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const error = useContext(ConsoleContext)?.error;
  useEffect(() => {
    const el = dialog.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  function close() {
    if (!dirty || window.confirm('Discard your unsaved changes?')) onClose();
  }
  return (
    <dialog
      className="c-drawer"
      ref={dialog}
      aria-labelledby="c-drawer-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === dialog.current) close();
      }}
    >
      <header>
        <div>
          <h2 id="c-drawer-title">{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button className="c-icon" onClick={close} aria-label="Close panel">
          <X size={20} />
        </button>
      </header>
      <div className="c-drawer-body">
        {error && (
          <div className="c-warning" role="alert">
            {error}
          </div>
        )}
        {children}
      </div>
    </dialog>
  );
}
export type Column<T> = {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  value?: (row: T) => string | number;
  numeric?: boolean;
};
export function Table<T>({
  rows,
  columns,
  id,
  onOpen,
  empty = 'No records match these filters.',
}: {
  rows: T[];
  columns: Column<T>[];
  id: (row: T) => string;
  onOpen?: (row: T) => void;
  empty?: string;
}) {
  const [sort, setSort] = useState({ key: '', desc: false });
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(25);
  const column = columns.find((c) => c.key === sort.key);
  const sorted = column?.value
    ? [...rows].sort((a, b) => {
        const av = column.value!(a),
          bv = column.value!(b);
        return (
          (typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv))) *
          (sort.desc ? -1 : 1)
        );
      })
    : rows;
  const current = Math.min(page, Math.max(0, Math.ceil(rows.length / size) - 1));
  return (
    <div className="c-table-panel">
      <div className="c-table-scroll">
        <table className="c-table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={c.numeric ? 'c-number' : ''}
                  aria-sort={sort.key === c.key ? (sort.desc ? 'descending' : 'ascending') : undefined}
                >
                  {c.value ? (
                    <button onClick={() => setSort({ key: c.key, desc: sort.key === c.key && !sort.desc })}>
                      {c.label}
                      {sort.key === c.key ? sort.desc ? <ChevronDown size={12} /> : <ChevronUp size={12} /> : null}
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.slice(current * size, (current + 1) * size).map((row) => (
              <tr key={id(row)}>
                {columns.map((c, i) => (
                  <td key={c.key} className={c.numeric ? 'c-number' : ''}>
                    {i === 0 && onOpen ? (
                      <button className="c-record-link" onClick={() => onOpen(row)}>
                        {c.render(row)}
                      </button>
                    ) : (
                      c.render(row)
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && <Empty title="No records found" text={empty} />}
      <footer className="c-table-footer">
        <span>
          {rows.length
            ? `${current * size + 1}–${Math.min((current + 1) * size, rows.length)} of ${rows.length}`
            : '0 records'}
        </span>
        <label>
          Rows{' '}
          <Select
            value={size}
            onChange={(e) => {
              setSize(Number(e.target.value));
              setPage(0);
            }}
          >
            <option>25</option>
            <option>50</option>
          </Select>
        </label>
        <button className="c-icon" aria-label="Previous page" disabled={!current} onClick={() => setPage(current - 1)}>
          <ArrowLeft size={15} />
        </button>
        <button
          className="c-icon"
          aria-label="Next page"
          disabled={(current + 1) * size >= rows.length}
          onClick={() => setPage(current + 1)}
        >
          <ArrowRight size={15} />
        </button>
      </footer>
    </div>
  );
}
export function Metrics({ items }: { items: { label: string; value: string | number; note: string }[] }) {
  return (
    <div className="c-metrics">
      {items.map((m) => (
        <article key={m.label}>
          <span>{m.label}</span>
          <strong>{m.value}</strong>
          <small>{m.note}</small>
        </article>
      ))}
    </div>
  );
}
