import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { Select } from '../components/FormControls';
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import {
  Activity,
  ArrowUpRight,
  Bell,
  Building2,
  CalendarDays,
  ChevronDown,
  CircleHelp,
  Inbox,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeftClose,
  Settings2,
  SlidersHorizontal,
  X,
  ChartNoAxesCombined,
  type LucideIcon,
} from 'lucide-react';
import { ConsoleContext } from './store';
import { dateText, pageAllowedFor, timeText } from './model';
import { Badge, Drawer, Empty, Field } from './ui';
import { adminFetch, AdminApiError, staffLogin, staffLogout, restoreStaffSession, type StaffPrincipal } from './api';
import { reviewerToolsEnabled } from '../lib/reviewerTools';
import './console.css';
const Overview = lazy(() => import('./Overview'));
const Enquiries = lazy(() => import('./EnquiriesLive'));
const Bookings = lazy(() => import('./Bookings'));
const Rooms = lazy(() => import('./Rooms'));
const Rates = lazy(() => import('./RatesLive'));
const Management = lazy(() => import('./Management'));
const Reports = lazy(() => import('./Reports'));
const Audit = lazy(() => import('./Audit'));
// Reviewer messages persist through the API; its DEMO_MODE gate remains authoritative.
function RealInboundInjector() {
  const [channel, setChannel] = useState<'email' | 'whatsapp'>('email');
  const [from, setFrom] = useState('prospect@example.com');
  const [message, setMessage] = useState('Is a villa free 14-16 Nov for 2 adults and a child?');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');

  async function inject() {
    setBusy(true);
    setError('');
    setResult('');
    try {
      const response = await fetch(`/api/mock/inbound/${channel}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from, message, contactName: 'Ishita Kamath' }),
      });
      const body = (await response.json()) as { publicRef?: string; error?: { message?: string } };
      if (!response.ok) {
        setError(body.error?.message ?? `Incoming-message tools are unavailable (${response.status}).`);
        return;
      }
      setResult(body.publicRef ?? 'created');
    } catch {
      setError('Could not connect. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="c-injector">
      <h3>Incoming message</h3>
      <p className="c-muted">
        Add an email or WhatsApp message to the enquiry inbox.
      </p>
      <Field label="Channel">
        <Select value={channel} onChange={(e) => setChannel(e.target.value as 'email' | 'whatsapp')}>
          <option value="email">Email</option>
          <option value="whatsapp">WhatsApp</option>
        </Select>
      </Field>
      <Field label={channel === 'email' ? 'From address' : 'From number'}>
        <input value={from} onChange={(e) => setFrom(e.target.value)} />
      </Field>
      <Field label="Message">
        <textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
      </Field>
      <button className="c-primary" type="button" disabled={busy} onClick={inject}>
        {busy ? 'Adding…' : 'Add to inbox'}
      </button>
      {result && (
        <p className="c-muted" role="status">
          Created <strong>{result}</strong>. Open Enquiries to follow its progress.
        </p>
      )}
      {error && (
        <p className="c-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** The seed's employee password (apps/Backend/seeds/run.ts). Fixture data for a synthetic
 *  database, documented in deployment.md — not a credential for anything real. */
const SEED_PASSWORD = 'ReviewerDemo!2026';

const navigation: { group: string; entries: [string, string, LucideIcon][] }[] = [
  {
    group: 'Workspace',
    entries: [
      ['overview', 'Overview', LayoutDashboard],
      ['enquiries', 'Enquiries', Inbox],
      ['bookings', 'Bookings', CalendarDays],
      ['rooms', 'Rooms & availability', Building2],
    ],
  },
  {
    group: 'Management',
    entries: [
      ['rates', 'Rates & allotment', SlidersHorizontal],
      ['management', 'Management', Settings2],
    ],
  },
  {
    group: 'Reporting',
    entries: [
      ['reports', 'Reports', ChartNoAxesCombined],
      ['activity', 'Activity log', Activity],
    ],
  },
];
/**
 * Real staff authentication: `POST /api/admin/auth/login`, argon2id-verified server-side,
 * rate-limited per account (`POLICY.employeeLogin`). It used to compare the password to the
 * literal string `estate-demo` in the browser, which is not authentication at all.
 *
 * Google is honestly unavailable rather than pretending: `POST /api/admin/auth/google` exists,
 * but employee Google verification needs a configured workspace domain, and claiming it works
 * would be worse than saying it does not.
 *
 * The role shortcuts stay — they are how a reviewer gets in without being handed six usernames
 * — but they now submit real credentials to the real endpoint, so a disabled account is
 * rejected by the server rather than by a local flag. The seed password lives in
 * `deployment.md`, and `DEMO_MODE` has nothing to do with this path.
 */
function Login({ onLogin }: { onLogin: (principal: StaffPrincipal) => void }) {
  const [error, setError] = useState('');
  const [show, setShow] = useState(false);
  const [pending, setPending] = useState(false);

  async function login(username: string, password: string) {
    setError('');
    setPending(true);
    try {
      onLogin(await staffLogin(username, password));
    } catch (failure) {
      // The server gives one generic rejection whether the username is unknown, the password is
      // wrong or the account is disabled — deliberately, so this screen cannot be used to
      // enumerate employees. Pass its message through rather than guessing a better one.
      setError(
        failure instanceof AdminApiError
          ? failure.message
          : 'Could not reach the server. Check that the API is running.',
      );
    } finally {
      setPending(false);
    }
  }

  const demoRoles: Array<[string, string]> = [
    ['owner', 'Owner'],
    ['gm', 'General manager'],
    ['arjun', 'Reservations'],
    ['divya', 'Sales'],
  ];

  return (
    <div className="c-login">
      <div className="c-login-intro">
        <span className="c-monogram">qe</span>
        <span>THE QUIET ESTATE</span>
        <h1>
          A clear view.
          <br />A quieter day.
        </h1>
        <p>One workspace for thoughtful hospitality.</p>
        <Link href="/">
          View the guest website <ArrowUpRight size={16} />
        </Link>
      </div>
      <div className="c-login-form">
        <span className="c-eyebrow">EMPLOYEE CONSOLE</span>
        <h2>Welcome back.</h2>
        <p>Sign in to your workspace.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void login(String(f.get('username')), String(f.get('password')));
          }}
        >
          <Field label="Username" hint="Use your username, not your full name.">
            <input name="username" required autoComplete="username" placeholder="e.g. gm" />
          </Field>
          <Field label="Password">
            <span className="c-password">
              <input name="password" type={show ? 'text' : 'password'} required autoComplete="current-password" />
              <button type="button" onClick={() => setShow(!show)}>
                {show ? 'Hide' : 'Show'}
              </button>
            </span>
          </Field>
          {error && (
            <p className="c-error" role="alert">
              {error}
            </p>
          )}
          <button className="c-primary" disabled={pending}>
            {pending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <button
          className="c-google"
          onClick={() =>
            setError('Google employee verification is not configured on this instance. Sign in with your username.')
          }
        >
          <span>G</span> Continue with Google
        </button>
        {reviewerToolsEnabled && <section className="c-demo-accounts" aria-labelledby="c-demo-heading" aria-busy={pending}>
          <h3 id="c-demo-heading">Quick access</h3>
          <p>Choose a role to continue.</p>
          {demoRoles.map(([username, role]) => (
            <button
              key={username}
              disabled={pending}
              onClick={() => void login(username, SEED_PASSWORD)}
              aria-label={`Sign in as ${role}`}
            >
              <span>
                <strong>{role}</strong>
                <small>
                  Username: <code>{username}</code>
                </small>
              </span>
              <ArrowUpRight size={16} aria-hidden="true" />
            </button>
          ))}
          <div className="c-demo-credentials">
            <span>Password</span>
            <code>{SEED_PASSWORD}</code>
          </div>
        </section>}
      </div>
    </div>
  );
}

/** The five types `notifications.type` may hold (001_init.sql's CHECK constraint). Taken from
 *  the migration rather than guessed — an invented name silently falls through to a generic
 *  label and the alert stops saying what it is. */
const NOTIFICATION_LABEL: Record<string, string> = {
  complaint_alert: 'Complaint needs attention',
  unassigned_enquiry: 'Enquiry needs assignment',
  ai_failure: 'AI processing failed',
  assignment: 'Enquiry assigned to you',
  refund_recorded: 'Refund recorded',
};

type Notification = {
  id: string;
  type: string;
  enquiryId: string | null;
  bookingId: string | null;
  body: string;
  readAt: string | null;
  createdAt: string;
};

export default function Console() {
  const [path, navigate] = useLocation();
  // The server-issued staff identity is now the ONLY actor. There used to be a second, local
  // one — a fixture employee matched by role — because the unwired screens read model.ts. The
  // sidebar and the greeting therefore named the wrong person. Both are gone.
  const [staff, setStaff] = useState<StaffPrincipal | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [panel, setPanel] = useState('');
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const [scenario, setScenario] = useState('Normal');
  const [offline, setOffline] = useState(!navigator.onLine);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const page = path.split('/')[2] || 'overview';
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    restoreStaffSession()
      .then((principal) => {
        if (cancelled || !principal) return;
        setStaff(principal);
      })
      .finally(() => {
        if (!cancelled) setRestoring(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    document.title = `Employee console — The Quiet Estate`;
    document.querySelector('.c-workspace')?.scrollTo(0, 0);
  }, [path]);
  // Real notifications: `complaint` alerts go to every active GM and owner the moment the AI
  // classifies one, and `ai_failure` when the provider could not be reached (§2, INV-18).
  const loadNotifications = useCallback(async () => {
    try {
      const body = await adminFetch<{ items: Notification[] }>('/notifications');
      setNotifications(body.items);
    } catch {
      // A failed badge refresh must never break the workspace.
    }
  }, []);

  useEffect(() => {
    if (!staff) return;
    // Deferred a tick so the first setState is not synchronous inside the effect body
    // (react-hooks/set-state-in-effect) — the pattern every wired screen here uses.
    void Promise.resolve().then(loadNotifications);
  }, [staff, loadNotifications, path]);

  const unread = notifications.filter((n) => !n.readAt);
  function go(to: string) {
    setError('');
    navigate(to);
    setMobile(false);
    setPanel('');
  }
  if (restoring)
    return (
      <div className="console">
        <LoadingSkeleton label="Checking your session…" variant="table" rows={6} />
      </div>
    );
  if (!staff || path === '/console/login')
    return (
      <div className="console">
        <Login
          onLogin={(principal) => {
            setStaff(principal);
            setScenario('Normal');
            navigate('/console/overview');
          }}
        />
      </div>
    );
  const allowed = pageAllowedFor(staff.role, page);
  const pages: Record<string, React.ReactNode> = {
    overview: <Overview />,
    enquiries: <Enquiries />,
    bookings: <Bookings />,
    rooms: <Rooms />,
    rates: <Rates />,
    management: <Management />,
    reports: <Reports />,
    activity: <Audit />,
  };
  return (
    <ConsoleContext.Provider value={{ notify: setToast, navigate: go, error }}>
      <div className={`console c-shell ${collapsed ? 'c-collapsed' : ''} ${mobile ? 'c-mobile-open' : ''}`}>
        {mobile && <button className="c-nav-shade" aria-label="Close navigation" onClick={() => setMobile(false)} />}
        <aside className="c-sidebar">
          <div className="c-sidebar-brand">
            <Link href="/console/overview" className="c-brand-link" aria-label="The Quiet Estate overview" onClick={() => setMobile(false)}>
            <span className="c-monogram">qe</span>
            <span className="c-brand-title">
              <strong>The Quiet Estate</strong>
              <small>Employee console</small>
            </span>
            </Link>
            <button className="c-icon c-sidebar-mobile-close" aria-label="Close navigation" onClick={() => setMobile(false)}><X size={18} /></button>
          </div>
          <div className="c-sidebar-tools"><span>Navigation</span>
            <button
              className="c-icon"
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-expanded={!collapsed}
              onClick={() => setCollapsed(!collapsed)}
            >
              <PanelLeftClose size={17} />
            </button>
          </div>
          <div className="c-nav-groups">
            {navigation.map((group) => {
              const entries = group.entries.filter(([id]) => pageAllowedFor(staff.role, id));
              return entries.length ? (
                <section key={group.group}>
                  <h2>{group.group}</h2>
                  <nav aria-label={group.group}>
                    {entries.map(([id, title, Icon]) => (
                      <Link
                        key={id}
                        href={`/console/${id}`}
                        className={page === id ? 'active' : ''}
                        aria-current={page === id ? 'page' : undefined}
                        title={collapsed ? title : undefined}
                        aria-label={`${title}${id === 'enquiries' && unread.length ? `, ${unread.length} unread` : ''}`}
                        onClick={() => setMobile(false)}
                      >
                        <Icon size={18} />
                        <span>{title}</span>
                        {id === 'enquiries' && unread.length > 0 && <small>{unread.length}</small>}
                      </Link>
                    ))}
                  </nav>
                </section>
              ) : null;
            })}
          </div>
          <div className="c-sidebar-bottom">
            <Link href="/" className="c-website">
              View website <ArrowUpRight size={14} />
            </Link>
            <button className="c-user" onClick={() => setPanel('Profile')}>
              <span className="c-avatar">
                {staff.name
                  .split(' ')
                  .map((n) => n[0])
                  .join('')}
              </span>
              <span>
                <strong>{staff.name}</strong>
                <small>{staff.role === 'staff' ? staff.team : staff.role.toUpperCase()}</small>
              </span>
              <ChevronDown size={14} />
            </button>
          </div>
        </aside>
        <div className="c-main">
          <header className="c-topbar">
            <div>
              <button className="c-icon c-mobile-menu" aria-label="Open navigation" onClick={() => setMobile(true)}>
                <Menu size={20} />
              </button>
              <span className="c-breadcrumb">
                Workspace <span>/</span>{' '}
                {navigation.flatMap((g) => g.entries).find(([id]) => id === page)?.[1] || 'Not found'}
              </span>
            </div>
            <div>
              {reviewerToolsEnabled && staff.role !== 'staff' && (
                <button
                  className="c-icon"
                  title="Workspace tools"
                  aria-label="Workspace tools"
                  onClick={() => setPanel('Workspace tools')}
                >
                  <CircleHelp size={18} />
                </button>
              )}
              <button
                className="c-icon c-bell"
                aria-label={`Notifications, ${unread.length} unread`}
                onClick={() => setPanel('Notifications')}
              >
                <Bell size={19} />
                {unread.length > 0 && <i />}
              </button>
              <button className="c-avatar" aria-label="Open profile" onClick={() => setPanel('Profile')}>
                {staff.name[0]}
              </button>
            </div>
          </header>
          {(offline || scenario === 'Offline') && (
            <div className="c-connection" role="status">
              You’re offline. Data may be out of date. Actions will remain unsubmitted.
            </div>
          )}
          <div className="c-workspace">
            {!allowed ? (
              <Empty
                title="This area is restricted"
                text="Your role does not have access to this page."
                action={
                  <Link href="/console/overview" className="c-primary">
                    Back to overview
                  </Link>
                }
              />
            ) : scenario === 'Loading' ? (
              <div>
                <LoadingSkeleton label="Loading workspace…" variant="table" rows={6} />
                <button onClick={() => setScenario('Normal')}>Continue</button>
              </div>
            ) : scenario === 'Error' ? (
              <Empty
                title="We couldn’t load this view"
                text="Your changes remain in memory. Try again to restore the view."
                action={
                  <button className="c-primary" onClick={() => setScenario('Normal')}>
                    Retry
                  </button>
                }
              />
            ) : (
              <Suspense
                fallback={
                  <LoadingSkeleton label="Loading view…" variant="table" rows={6} />
                }
              >
                {pages[page]}
              </Suspense>
            )}
          </div>
          <footer className="c-workspace-footer">
            Asia/Kolkata
          </footer>
        </div>
        {toast && (
          <div className="c-toast" role="status">
            <span>{toast}</span>
            <button className="c-icon" aria-label="Dismiss notification" onClick={() => setToast('')}>
              <X size={16} />
            </button>
          </div>
        )}
        {panel && (
          <Drawer title={panel} onClose={() => setPanel('')}>
            {panel === 'Profile' ? (
              <div className="c-stack">
                <span className="c-avatar c-avatar-large">{staff.name[0]}</span>
                <h3>{staff.name}</h3>
                <p>{staff.username}</p>
                <Badge>{staff.role === 'staff' ? staff.team : staff.role.toUpperCase()}</Badge>
                <button
                  className="c-button"
                  onClick={() => {
                    void staffLogout();
                    setStaff(null);
                    setPanel('');
                    navigate('/console/login');
                  }}
                >
                  <LogOut size={16} /> Sign out
                </button>
              </div>
            ) : panel === 'Notifications' ? (
              <div className="c-stack">
                {notifications.length ? (
                  notifications.map((n) => (
                    <button
                      className={`c-alert-item ${n.readAt ? '' : 'unread'}`}
                      key={n.id}
                      onClick={() => {
                        void adminFetch(`/notifications/${n.id}/read`, { method: 'POST' }).then(loadNotifications, () => {});
                        if (n.enquiryId) go(`/console/enquiries/${n.enquiryId}`);
                        else if (n.bookingId) go(`/console/bookings/${n.bookingId}`);
                      }}
                    >
                      <strong>{NOTIFICATION_LABEL[n.type] ?? 'New activity'}</strong>
                      <span>{n.body}</span>
                      <small>
                        {dateText(n.createdAt)} · {timeText(n.createdAt)}
                      </small>
                    </button>
                  ))
                ) : (
                  <Empty text="You’re up to date." />
                )}
              </div>
            ) : (
              <div className="c-stack">
                <p>Workspace states and incoming-message tools.</p>
                <Field label="Workspace state">
                  <Select
                    value={scenario}
                    onChange={(e) => {
                      setScenario(e.target.value);
                      if (e.target.value === 'Expired session') {
                        void staffLogout();
                        setStaff(null);
                        navigate('/console/login');
                        setPanel('');
                      }
                    }}
                  >
                    <option>Normal</option>
                    <option>Loading</option>
                    <option>Error</option>
                    <option>Offline</option>
                    <option>Expired session</option>
                  </Select>
                </Field>
                <RealInboundInjector />
              </div>
            )}
          </Drawer>
        )}
      </div>
    </ConsoleContext.Provider>
  );
}
