import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { Select } from '../components/FormControls';
import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowLeft, Columns3, Inbox, List, RefreshCw, Sparkles } from 'lucide-react';
import { adminFetch, AdminApiError, getStaffPrincipal } from './api';
import { useConsole } from './store';
import { dateText, timeText } from './model';
import { Badge, Empty, Field, PageHeading, SearchBox } from './ui';

/**
 * The enquiry inbox, against the real staff API — the second of the brief's four core-build
 * bullets, and the one that carries the AI requirement.
 *
 * Endpoints:
 *   GET   /enquiries ?status&category&source&assignee&complaint&needsReview&unassigned&search&sort
 *   GET   /enquiries/counts                       the lane badges
 *   GET   /enquiries/:id                          messages + history + pendingDraft
 *   POST  /enquiries/:id/read
 *   PATCH /enquiries/:id/category | /status
 *   POST  /enquiryAssignment/:id/assign | /claim   · GET /enquiryAssignment/assignable
 *   POST  /enquiryDrafts/:id | /:id/retry          REAL Gemini, not a canned string
 *   POST  /enquiryMessages/:id | /:id/notes
 *
 * Three things this screen must not do, each enforced by the backend and respected here rather
 * than re-implemented:
 *
 * 1. **Never send automatically.** A draft is generated, shown in an editable box, and only
 *    leaves when a human presses send — `POST /enquiryMessages/:id` is a separate call from
 *    `POST /enquiryDrafts/:id`. Product.md §2: "Drafts are never sent automatically."
 * 2. **Never present an internal note as a guest reply.** `visibility` comes back on every
 *    message; internal ones are labelled and visually separated. The guest's own
 *    `GET /api/user/enquiries/:id` excludes them server-side, so the separation here is for
 *    the staff member's benefit, not the guest's protection.
 * 3. **Never decide who may act.** Staff see only their assigned enquiries and only GM/owner
 *    may reassign — both enforced per route. A 403 or 404 from the server is the answer, and
 *    this screen shows it.
 *
 * "Unsorted" is the `needsReview` lane: low confidence, no category, or a malformed/invalid AI
 * response. "Unassigned" is a separate condition, not a status.
 */

type InboxStatus = 'new' | 'in_progress' | 'resolved';
type Summary = {
  enquiryId: string;
  publicRef: string;
  source: 'website' | 'email' | 'whatsapp';
  status: InboxStatus | 'awaiting_guest'; // Legacy records remain visible as In progress.
  category: 'room' | 'wedding' | 'offsite' | 'complaint' | null;
  assigneeId: string | null;
  contactName: string | null;
  isComplaint: boolean;
  needsReview: boolean;
  lastActivityAt: string;
  createdAt: string;
};
type Message = {
  id: string;
  direction: 'inbound' | 'outbound';
  visibility: 'guest' | 'internal';
  body: string;
  deliveryStatus: string;
  createdAt: string;
};
type HistoryEvent = { type: string; createdAt: string; actorKind?: string };
type Detail = Summary & {
  messages: { items: Message[]; nextCursor: string | null };
  history: HistoryEvent[];
  pendingDraft: { id: string; body: string; flags: string[] } | null;
};
type Counts = {
  byStatus: Record<string, number>;
  unsorted: number;
  unassigned: number;
  complaint: number;
  unread: number;
};
type Assignable = { id: string; name: string; role: string; team: string | null };

const STATUS_LABEL: Record<InboxStatus, string> = {
  new: 'New',
  in_progress: 'In progress',
  resolved: 'Resolved',
};
const statusOf = (status: Summary['status']): InboxStatus => status === 'awaiting_guest' ? 'in_progress' : status;
const LANES = ['All', 'Unsorted', 'Unassigned', 'Complaints'] as const;

function laneQuery(lane: (typeof LANES)[number]) {
  if (lane === 'Unsorted') return 'needsReview=true';
  if (lane === 'Unassigned') return 'unassigned=true';
  if (lane === 'Complaints') return 'complaint=true';
  return '';
}

const VIEW_KEY = 'estate-console-enquiry-view';

function readView(): 'List' | 'Board' {
  // A view preference, which is exactly the kind of non-sensitive state
  // apps/Frontend/CLAUDE.md allows in storage. Same key the fixture-backed screen used, so an
  // existing preference carries over. Wrapped because storage throws in private mode.
  try {
    return sessionStorage.getItem(VIEW_KEY) === 'Board' ? 'Board' : 'List';
  } catch {
    return 'List';
  }
}

/** The board reflects conversation activity; cards open threads and never change status. */
function Board({ items, onOpen }: { items: Summary[]; onOpen: (id: string) => void }) {
  const columns = Object.entries(STATUS_LABEL) as Array<[InboxStatus, string]>;
  return <div className="c-board">
    {columns.map(([status, label]) => {
      const cards = items.filter((item) => statusOf(item.status) === status);
      return <section key={status} className="c-board-column" aria-labelledby={`c-col-${status}`}>
        <h3 id={`c-col-${status}`}>{label} <span>{cards.length}</span></h3>
        {cards.length === 0 ? <p className="c-board-empty">Nothing here.</p> : <ul>
          {cards.map((item) => <li key={item.enquiryId} className="c-card">
            <button type="button" className="c-card-open" onClick={() => onOpen(item.enquiryId)}>
              <strong>{item.publicRef}</strong><span>{item.contactName ?? 'Unnamed guest'}</span>
            </button>
            <p className="c-card-meta">{item.source} · {item.category ?? 'Unsorted'}</p>
            <div className="c-card-badges">
              {item.isComplaint && <Badge>Complaint</Badge>}
              {item.needsReview && <Badge>Needs review</Badge>}
              {!item.assigneeId && <Badge>Unassigned</Badge>}
            </div>
          </li>)}
        </ul>}
      </section>;
    })}
  </div>;
}

function Workspace({ enquiryId, onBack, onChanged }: { enquiryId: string; onBack: () => void; onChanged: () => void }) {
  const { notify } = useConsole();
  const principal = getStaffPrincipal();
  const isManager = principal?.role === 'gm' || principal?.role === 'owner';

  const [detail, setDetail] = useState<Detail | null>(null);
  const [assignable, setAssignable] = useState<Assignable[]>([]);
  const [draftBody, setDraftBody] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const body = await adminFetch<Detail>(`/enquiries/${enquiryId}`);
      setDetail(body);
      setDraftBody(body.pendingDraft?.body ?? '');
    } catch (failure) {
      setError(failure instanceof AdminApiError ? failure.message : 'Could not load this enquiry.');
    } finally {
      setLoading(false);
    }
  }, [enquiryId]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  useEffect(() => {
    // Read once per thread open, not on every action refresh. Never let badge updates drive detail loading.
    void adminFetch(`/enquiries/${enquiryId}/read`, { method: 'POST' }).then(onChanged, () => {});
  }, [enquiryId, onChanged]);

  useEffect(() => {
    if (!isManager) return;
    adminFetch<{ items: Assignable[] }>('/enquiryAssignment/assignable')
      .then((body) => setAssignable(body.items))
      .catch(() => setAssignable([]));
  }, [isManager]);

  async function act(label: string, run: () => Promise<unknown>, message: string) {
    setBusy(label);
    setError('');
    try {
      await run();
      notify(message);
      await load();
      onChanged();
    } catch (failure) {
      setError(failure instanceof AdminApiError ? failure.message : 'That action did not complete.');
    } finally {
      setBusy('');
    }
  }

  if (loading) return <LoadingSkeleton label="Loading the conversation…" variant="detail" />;
  if (error && !detail)
    return (
      <Empty
        title="Enquiry unavailable"
        text={error}
        action={
          <button className="c-primary" type="button" onClick={onBack}>
            Back to the inbox
          </button>
        }
      />
    );
  if (!detail) return null;

  const guestMessages = detail.messages.items.filter((m) => m.visibility === 'guest');
  const internalNotes = detail.messages.items.filter((m) => m.visibility === 'internal');

  return (
    <div className="c-thread">
      <button type="button" className="c-linkish" onClick={onBack}>
        <ArrowLeft size={15} /> All enquiries
      </button>

      <div className="c-thread-head">
        <div>
          <h2>{detail.publicRef}</h2>
          <p className="c-muted">
            {detail.contactName ?? 'Unnamed guest'} · via {detail.source} · {STATUS_LABEL[statusOf(detail.status)]}
          </p>
        </div>
        <div className="c-thread-badges">
          {detail.isComplaint && <Badge>Complaint</Badge>}
          {detail.needsReview && <Badge>Needs review</Badge>}
          <Badge>{detail.category ?? 'Unsorted'}</Badge>
        </div>
      </div>

      {error && (
        <p className="c-error" role="alert">
          {error}
        </p>
      )}

      <div className="c-thread-grid">
        <div>
          <h3>Conversation</h3>
          <ol className="c-messages">
            {[...guestMessages].reverse().map((message) => (
              <li key={message.id} className={`c-message c-message-${message.direction}`}>
                <span className="c-message-who">{message.direction === 'inbound' ? 'Guest' : 'Our team'}</span>
                <p>{message.body}</p>
                <small>
                  {dateText(message.createdAt)} · {timeText(message.createdAt)}
                  {message.direction === 'outbound' && ` · ${message.deliveryStatus}`}
                </small>
              </li>
            ))}
          </ol>

          <h3>
            <Sparkles size={15} /> AI draft
          </h3>
          {detail.pendingDraft ? (
            <>
              <p className="c-muted">
                Generated by the AI for you to review. Nothing is sent until you press send.
                {draftBody.trim() !== detail.pendingDraft.body.trim() &&
                  ' You have edited it, so it will be recorded as your reply rather than the AI’s.'}
                {detail.pendingDraft.flags.length > 0 && ` Flags: ${detail.pendingDraft.flags.join(', ')}.`}
              </p>
              <textarea rows={6} value={draftBody} onChange={(e) => setDraftBody(e.target.value)} />
              <div className="c-row">
                <button
                  className="c-primary"
                  type="button"
                  disabled={busy !== '' || !draftBody.trim()}
                  onClick={() =>
                    void act(
                      'send',
                      () =>
                        adminFetch(`/enquiryMessages/${enquiryId}`, {
                          method: 'POST',
                          body: {
                            body: draftBody.trim(),
                            // `draftId` is sent ONLY when the body is the draft verbatim. The
                            // backend then marks that draft `sent` and links the message to its
                            // ai_run_id, so AI attribution is recorded honestly. Once a staff
                            // member edits the text it is their reply, not the model's, and
                            // claiming otherwise would corrupt the attribution the ai_runs
                            // table exists to provide.
                            ...(detail.pendingDraft && draftBody.trim() === detail.pendingDraft.body.trim()
                              ? { draftId: detail.pendingDraft.id }
                              : {}),
                          },
                        }),
                      'Reply queued.',
                    )
                  }
                >
                  {busy === 'send' ? 'Sending…' : 'Send this reply'}
                </button>
                <button
                  className="c-button"
                  type="button"
                  disabled={busy !== ''}
                  onClick={() =>
                    void act('retry', () => adminFetch(`/enquiryDrafts/${enquiryId}/retry`, { method: 'POST' }), 'A new draft was generated.')
                  }
                >
                  <RefreshCw size={14} /> Regenerate
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="c-muted">
                No draft is waiting. Generating one calls the AI with this thread and the approved
                resort facts — it never invents a price or a facility.
              </p>
              <button
                className="c-button"
                type="button"
                disabled={busy !== ''}
                onClick={() =>
                  void act('draft', () => adminFetch(`/enquiryDrafts/${enquiryId}`, { method: 'POST' }), 'Draft generated.')
                }
              >
                {busy === 'draft' ? 'Asking the AI…' : 'Generate a draft'}
              </button>
            </>
          )}

          <h3>Internal notes</h3>
          <p className="c-muted">Staff only. These are never shown to the guest.</p>
          {internalNotes.length > 0 && (
            <ul className="c-notes">
              {[...internalNotes].reverse().map((message) => (
                <li key={message.id}>
                  <p>{message.body}</p>
                  <small>{dateText(message.createdAt)}</small>
                </li>
              ))}
            </ul>
          )}
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note for the team…" />
          <button
            className="c-button"
            type="button"
            disabled={busy !== '' || !note.trim()}
            onClick={() =>
              void act(
                'note',
                async () => {
                  await adminFetch(`/enquiryMessages/${enquiryId}/notes`, { method: 'POST', body: { body: note.trim() } });
                  setNote('');
                },
                'Note added.',
              )
            }
          >
            Add note
          </button>
        </div>

        <aside className="c-thread-rail">
          <h3>Triage</h3>
          <Field label="Classification" hint="Correcting this reroutes the enquiry to the right team.">
            <Select
              value={detail.category ?? ''}
              disabled={busy !== ''}
              onChange={(e) =>
                void act(
                  'category',
                  () => adminFetch(`/enquiries/${enquiryId}/category`, { method: 'PATCH', body: { category: e.target.value } }),
                  'Classification corrected and rerouted.',
                )
              }
            >
              <option value="" disabled>
                Unsorted
              </option>
              <option value="room">Room</option>
              <option value="wedding">Wedding</option>
              <option value="offsite">Offsite</option>
              <option value="complaint">Complaint</option>
            </Select>
          </Field>

          <div className="c-thread-status">
            <span className="c-muted">Status</span><strong>{STATUS_LABEL[statusOf(detail.status)]}</strong>
            <button type="button" className={detail.status === 'resolved' ? 'c-button' : 'c-primary'} disabled={busy !== ''}
              onClick={() => void act('status', () => adminFetch(`/enquiries/${enquiryId}/status`, {
                method: 'PATCH', body: { status: detail.status === 'resolved' ? 'in_progress' : 'resolved' },
              }), detail.status === 'resolved' ? 'Enquiry reopened.' : 'Enquiry resolved.')}>
              {detail.status === 'resolved' ? 'Reopen enquiry' : 'Mark resolved'}
            </button>
          </div>

          {isManager ? (
            <Field label="Assigned to">
              <Select
                value={detail.assigneeId ?? ''}
                disabled={busy !== ''}
                onChange={(e) =>
                  void act(
                    'assign',
                    () =>
                      adminFetch(`/enquiryAssignment/${enquiryId}/assign`, {
                        method: 'POST',
                        body: { assigneeId: e.target.value },
                      }),
                    'Enquiry reassigned.',
                  )
                }
              >
                <option value="" disabled>
                  Unassigned
                </option>
                {assignable.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name} · {person.team ?? person.role}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            !detail.assigneeId && (
              <button
                className="c-button"
                type="button"
                disabled={busy !== ''}
                onClick={() =>
                  void act('claim', () => adminFetch(`/enquiryAssignment/${enquiryId}/claim`, { method: 'POST' }), 'You picked this up.')
                }
              >
                Pick this up
              </button>
            )
          )}

          <h3>Activity</h3>
          <ul className="c-history">
            {detail.history.slice(0, 12).map((event, index) => (
              <li key={`${event.createdAt}-${index}`}>
                <strong>{event.type}</strong>
                <span>
                  {dateText(event.createdAt)} · {timeText(event.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}

export default function EnquiriesLive() {
  const [path, navigate] = useLocation();
  const openId = path.split('/')[3] ?? '';

  const [lane, setLane] = useState<(typeof LANES)[number]>('All');
  const [view, setView] = useState<'List' | 'Board'>(readView);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [source, setSource] = useState('');
  const [items, setItems] = useState<Summary[]>([]);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const params = [laneQuery(lane), status && `status=${status}`, source && `source=${source}`, search.trim() && `search=${encodeURIComponent(search.trim())}`, 'limit=50']
      .filter(Boolean)
      .join('&');
    try {
      const [list, countBody] = await Promise.all([
        adminFetch<{ items: Summary[]; nextCursor: string | null }>(`/enquiries?${params}`),
        adminFetch<Counts>('/enquiries/counts'),
      ]);
      setItems(list.items);
      setCounts(countBody);
    } catch (failure) {
      setError(failure instanceof AdminApiError ? failure.message : 'Could not load the inbox.');
    } finally {
      setLoading(false);
    }
  }, [lane, status, source, search]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  function chooseView(next: 'List' | 'Board') {
    setView(next);
    try {
      sessionStorage.setItem(VIEW_KEY, next);
    } catch {
      // A lost preference is not worth failing over.
    }
  }

  if (openId)
    return <Workspace key={openId} enquiryId={openId} onBack={() => navigate('/console/enquiries')} onChanged={load} />;

  return (
    <>
      <PageHeading
        title="Enquiries"
        description="Website, email and WhatsApp enquiries, together in one inbox."
        actions={
          counts && (
            <span className="c-muted">
              {counts.unsorted} unsorted · {counts.unassigned} unassigned · {counts.complaint} complaint
            </span>
          )
        }
      />

      <div className="c-tabs" role="tablist" aria-label="Enquiry lanes">
        {LANES.map((value) => (
          <button key={value} role="tab" aria-selected={lane === value} onClick={() => setLane(value)}>
            {value}
            {value === 'Unsorted' && counts ? ` (${counts.unsorted})` : ''}
            {value === 'Unassigned' && counts ? ` (${counts.unassigned})` : ''}
            {value === 'Complaints' && counts ? ` (${counts.complaint})` : ''}
          </button>
        ))}
      </div>

      <div className="c-enquiry-toolbar">
        <SearchBox value={search} onChange={setSearch} placeholder="Reference, name or message…" />
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any status</option>
            {Object.entries(STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Source">
          <Select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">Any source</option>
            <option value="website">Website</option>
            <option value="email">Email</option>
            <option value="whatsapp">WhatsApp</option>
          </Select>
        </Field>
        <div className="c-viewswitch" role="group" aria-label="View">
          {(['List', 'Board'] as const).map((value) => (
            <button key={value} type="button" aria-pressed={view === value} onClick={() => chooseView(value)}>
              {value === 'List' ? <List size={14} /> : <Columns3 size={14} />} {value}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="c-error" role="alert">
          {error}{' '}
          <button type="button" className="c-linkish" onClick={() => void load()}>
            Try again
          </button>
        </p>
      )}
      {loading && !error && <LoadingSkeleton label="Loading the inbox…" variant={view === 'Board' ? 'cards' : 'table'} rows={5} />}

      {!loading && !error && items.length === 0 && (
        <Empty
          title="Nothing in this lane"
          text="New enquiries from the website, email and WhatsApp arrive here automatically."
          action={
            <Link className="c-primary" href="/console/overview">
              <Inbox size={15} /> Back to overview
            </Link>
          }
        />
      )}

      {!loading && !error && items.length > 0 && view === 'Board' && (
        <Board items={items} onOpen={(id) => navigate(`/console/enquiries/${id}`)} />
      )}

      {!loading && !error && items.length > 0 && view === 'List' && (
        <table className="c-table">
          <thead>
            <tr>
              <th scope="col">Reference</th>
              <th scope="col">Guest</th>
              <th scope="col">Source</th>
              <th scope="col">Classification</th>
              <th scope="col">Status</th>
              <th scope="col">Last activity</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.enquiryId} onClick={() => navigate(`/console/enquiries/${item.enquiryId}`)} className="c-rowlink">
                <th scope="row">
                  <Link href={`/console/enquiries/${item.enquiryId}`}>{item.publicRef}</Link>
                  {item.isComplaint && <Badge>Complaint</Badge>}
                  {item.needsReview && <Badge>Needs review</Badge>}
                </th>
                <td>{item.contactName ?? '—'}</td>
                <td>{item.source}</td>
                <td>{item.category ?? 'Unsorted'}</td>
                <td>{STATUS_LABEL[statusOf(item.status)]}</td>
                <td>
                  {dateText(item.lastActivityAt)} · {timeText(item.lastActivityAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
