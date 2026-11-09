import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  bookingCSV,
  bookingValue,
  csvCell,
  datesBetween,
  inventory,
  now,
  pageAllowed,
  seedState,
  transition,
  visibleThreads,
  type Command,
} from '../src/console/model';
import { report } from '../src/console/reporting';
const time = '2026-11-09T11:00:00+05:30';
const apply = (s: ReturnType<typeof seedState>, command: Command, actor = 'owner') =>
  transition(s, actor, command, time, 'test-event');
describe('console demo permission and conversation rules', () => {
  test('staff only see assigned threads; management is role guarded', () => {
    const s = seedState();
    const res = s.employees.find((e) => e.id === 'res')!;
    expect(visibleThreads(s, res).every((t) => t.assignee === 'res')).toBe(true);
    expect(pageAllowed(res, 'reports')).toBe(false);
    expect(pageAllowed(res, 'rates')).toBe(false);
    expect(() => apply(s, { type: 'thread', id: 'ENQ-4410', status: 'Resolved' }, 'res')).toThrow('access');
    expect(() => apply(s, { type: 'thread', id: 'ENQ-4411', assignee: 'sales' }, 'res')).toThrow('Only GM');
    expect(() => apply(s, { type: 'export', from: '2026-11-01', to: '2026-11-30' }, 'sales')).toThrow('cannot export');
    expect(() => apply(s, { type: 'ai', id: 'ENQ-4410' }, 'old')).toThrow('disabled');
  });
  test('failed delivery does not count as a sent response; retry does', () => {
    const s = seedState();
    const failed = apply(
      s,
      { type: 'reply', id: 'ENQ-4411', text: 'Please confirm the year.', delivery: 'Failed' },
      'res',
    );
    expect(failed.threads[1].status).toBe('In progress');
    expect(s.threads[1].messages).toHaveLength(1);
    const sent = apply(failed, { type: 'retry-delivery', id: 'ENQ-4411', message: 'test-event' }, 'res');
    expect(sent.threads[1].status).toBe('In progress');
    expect(sent.threads[1].messages.at(-1)?.delivery).toBe('Delivered');
    expect(() => apply(sent, { type: 'retry-delivery', id: 'ENQ-4411', message: 'test-event' }, 'res')).toThrow(
      'Only a failed',
    );
  });
  test('AI draft generation never sends a message and complaint correction routes to GM', () => {
    const s = seedState();
    const next = apply(s, { type: 'ai', id: 'ENQ-4411' }, 'res');
    expect(next.threads[1].messages).toEqual(s.threads[1].messages);
    const corrected = apply(s, { type: 'thread', id: 'ENQ-4411', category: 'Complaint' }, 'res');
    expect(corrected.threads[1].assignee).toBe('gm');
    expect(corrected.threads[1].category).toBe('Complaint');
  });
  test('disable unassigns unresolved threads; history stays; reopening disabled assignment stays unassigned', () => {
    const s = seedState();
    const disabled = apply(
      s,
      { type: 'employee', employee: { ...s.employees.find((e) => e.id === 'res')!, active: false } },
      'gm',
    );
    expect(disabled.threads.filter((t) => t.status !== 'Resolved').every((t) => t.assignee !== 'res')).toBe(true);
    expect(disabled.threads.find((t) => t.id === 'ENQ-4416')!.assignee).toBe('res');
    const reopened = apply(disabled, { type: 'guest-reply', id: 'ENQ-4416' });
    expect(reopened.threads.find((t) => t.id === 'ENQ-4416')!.assignee).toBe('');
    expect(reopened.threads.find((t) => t.id === 'ENQ-4416')!.status).toBe('In progress');
    expect(() => apply(s, { type: 'employee', employee: { ...s.employees[0], active: false } })).toThrow('protected');
    expect(() => apply(s, { type: 'employee', employee: { ...s.employees[1], active: false } }, 'gm')).toThrow(
      'cannot manage',
    );
  });
});
/* The rate/allotment/blackout cases that lived here are gone with model.ts's `rate` command:
   the Rates screen now writes through /api/admin/rates|inventory|blackouts, and
   apps/Backend/tests (2F, plus inventory.oversell and booking.atomicity) test those rules
   against a real database with real row locks — which a browser-side copy never could. What
   stays below are the claims still owned by this file: the seeded fixtures are internally
   coherent, and the demo clock is shared. */
describe('fixture coherence and the demo clock', () => {
  test('seed inventory is coherent across every room and date', () => {
    const s = seedState();
    expect(s.rooms.reduce((n, r) => n + r.stock, 0)).toBe(76);
    for (const room of s.rooms)
      for (const d of datesBetween('2026-11-01', '2026-11-30')) {
        const v = inventory(s, room.id, d);
        expect(v.confirmed + v.held).toBeLessThanOrEqual(v.allotment);
      }
  });
  test('the demo clock is shared: a lapsed hold stops withholding a room', () => {
    let s = seedState();
    const held = s.bookings.find((b) => b.status === 'Pending payment')!;
    const probe = () => inventory(s, held.lines[0].room, held.arrival).held;
    expect(probe()).toBe(1);
    for (let i = 0; i < 15; i++)
      s = transition(
        s,
        'gm',
        { type: 'reply', id: 'ENQ-4413', text: `note ${i}`, delivery: 'Received', note: true },
        now(s),
        `n-${i}`,
      );
    expect(Date.parse(now(s))).toBeGreaterThan(Date.parse(held.holdUntil!));
    expect(probe()).toBe(0);
  });
});
describe('exports, information and reports', () => {
  test('CSV neutralises formulas and handles quotes; date bounds and same-day export work', () => {
    expect(csvCell('=HYPERLINK("x")')).toStartWith('"\'=');
    expect(datesBetween('2026-02-30', '2026-03-01')).toEqual([]);
    expect(datesBetween('2026-11-09', '2026-11-09')).toHaveLength(1);
    const s = seedState();
    s.bookings[0].guest = '=CMD()';
    const csv = bookingCSV(s, '2026-11-02', '2026-11-02');
    expect(csv).toContain("'=CMD()");
    expect(csv).not.toContain('QE-260902');
    expect(csv).toContain('do not sum');
  });
  test('facts are versioned and stale edits rejected', () => {
    const s = seedState();
    const next = apply(s, { type: 'fact', id: 'fact-0', text: 'Approved information.', version: 1 });
    expect(next.facts[0].version).toBe(2);
    expect(next.facts[0].history[0].text).toBe(s.facts[0].text);
    expect(() => apply(next, { type: 'fact', id: 'fact-0', text: 'Stale text', version: 1 })).toThrow('newer');
  });
  test('reports reconcile booking values and exclude failed delivery from reply counts', () => {
    const s = seedState();
    const r = report(s, '2026-11-01', '2026-11-30');
    expect(r.value).toBe(s.bookings.filter((b) => b.status === 'Confirmed').reduce((n, b) => n + bookingValue(b), 0));
    expect(r.replied).toBe(2);
    expect(r.unanswered).toBe(6);
    expect(r.sold).toBe(32);
    expect(r.funnel[3].count).toBe(15);
    expect(report(s, '2027-01-01', '2027-01-02').value).toBe(0);
  });
});

describe('enquiry detail request lifecycle', () => {
  const source = readFileSync(new URL('../src/console/EnquiriesLive.tsx', import.meta.url), 'utf8');
  const workspace = source.slice(source.indexOf('function Workspace('), source.indexOf('export default function EnquiriesLive'));
  const loader = workspace.slice(workspace.indexOf('const load = useCallback'), workspace.indexOf('  useEffect('));
  test('detail loading neither marks read nor invokes parent refresh', () => {
    expect(loader).toContain('}, [enquiryId]);');
    expect(loader).not.toContain('onChanged');
    expect(loader).not.toContain('/read');
    expect(source).toContain('onChanged={load}');
    expect(source).not.toContain('onChanged={() => void load()}');
  });
  test('read acknowledgement is isolated from action reloads', () => {
    expect(workspace.match(/\/read`/g)).toHaveLength(1);
    expect(workspace).toContain('await load();\n      onChanged();');
  });
});

describe('the wired Rates screen keeps the backend as the authority', () => {
  const source = readFileSync(new URL('../src/console/RatesLive.tsx', import.meta.url), 'utf8');

  test('every write carries a previewToken', () => {
    // The backend refuses PUT/DELETE on rates, inventory and blackouts without the token its
    // preview call issued — that handshake is what guarantees a GM saw the dates and conflicts
    // they were about to overwrite. A refactor that drops it would still type-check and would
    // fail only at runtime, against a real database.
    for (const method of ["method: 'PUT'", "method: removing ? 'DELETE' : 'PUT'"]) {
      if (!source.includes(method)) continue;
      const at = source.indexOf(method);
      const window = source.slice(at, at + 400);
      expect(window).toContain('previewToken');
    }
    expect(source).toContain('previewToken: current.previewToken');
  });

  test('a stale preview is discarded rather than reused', () => {
    // The token is only valid for the values it was issued for. The screen keys the preview on
    // a signature of those values, so changing any input stops the key matching.
    expect(source).toContain('preview?.signature === signature');
  });

  test('the oversell rule is not re-implemented client-side', () => {
    // assertAvailable rejects an allotment below committed usage inside the write transaction
    // and names the dates. A second copy here could only be weaker, and could disagree.
    expect(source).not.toContain('committed + ');
    expect(source).not.toMatch(/allotment\s*<\s*committed/);
  });

  test('model.ts no longer carries a duplicate rate command', () => {
    const model = readFileSync(new URL('../src/console/model.ts', import.meta.url), 'utf8');
    expect(model).not.toContain("type: 'rate'");
    expect(model).not.toContain('export function supersede');
  });
});

describe('the Enquiries screen keeps both required views (Product.md §9A)', () => {
  const source = readFileSync(new URL('../src/console/EnquiriesLive.tsx', import.meta.url), 'utf8');

  test('a Kanban board exists alongside the list', () => {
    // §9A: "Kanban and list views of the same records". This guard exists because the board WAS
    // lost once: the fixture-backed screen had it, the rewrite against the API did not carry it
    // over, and nothing failed — type-checking, lint and every test stayed green while a
    // required feature quietly disappeared.
    expect(source).toContain('function Board(');
    expect(source).toContain("view === 'Board'");
    expect(source).toContain("view === 'List'");
  });

  test('board columns are the three conversation statuses and nothing else', () => {
    // Latest user request: three activity-driven statuses; review conditions remain filters.
    const board = source.slice(source.indexOf('function Board('), source.indexOf('function Workspace('));
    // Columns are derived from STATUS_LABEL, the three conversation statuses, and from nothing
    // else. The words "Unsorted" and "Unassigned" DO appear on cards — as a category label and
    // a badge — which is correct; what must never happen is LANES becoming a column source.
    expect(board).toContain('Object.entries(STATUS_LABEL)');
    expect(board).not.toContain('LANES');
    expect(board).not.toContain('laneQuery');
  });

  test('both views render the same filtered records', () => {
    // Not two fetches with two filter sets — "the same records" is the requirement.
    expect(source).toContain('<Board items={items}');
  });

  test('cards open conversations without manual status movement', () => {
    const board = source.slice(source.indexOf('function Board('), source.indexOf('function Workspace('));
    expect(board).not.toContain('<select');
    expect(board).not.toContain('draggable');
    expect(board).not.toContain('onDragStart');
    expect(board).not.toContain('onDrop');
    expect(board).not.toContain('onMove');
    expect(board).toContain('onOpen(item.enquiryId)');
    expect(board).toContain('type="button"');
    const labels = source.slice(source.indexOf('const STATUS_LABEL'), source.indexOf('const LANES'));
    expect(labels).not.toContain("awaiting_guest: 'Awaiting guest'");
    expect(source).toContain('className="c-enquiry-toolbar"');
    expect(source).toContain('Mark resolved');
  });
});
