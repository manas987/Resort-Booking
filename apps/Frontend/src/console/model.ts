/**
 * Employee-console demo domain model — SCAFFOLDING, not the source of truth.
 *
 * This file re-implements staff business rules in the browser so the console
 * renders and demos without a backend. `apps/Backend/src/routes/admin/` already
 * serves ~45 working endpoints for the same rules, and Phase 4 replaces what is
 * here with calls to them. Treat every limit below as a placeholder.
 *
 * Known divergences to resolve when wiring (root CLAUDE.md: business limits live
 * in `apps/Backend/src/core/policy.ts` only — INV-59):
 *
 *   this file                      backend
 *   ---------------------------------------------------------------------------
 *   date range cap 731 days        POLICY.pagination.maxRangeDays = 366
 *   reply max 5,000 chars          admin/enquiryMessages/schema.ts max 4,000
 *   promo code /^[A-Z0-9_-]{3,24}$/  admin/promos/schema.ts: max 50, no charset
 *   promo usage limit required     admin/promos: maxUses optional
 *   no preview token               admin/rates applyRateSchema requires previewToken
 *   Override[] date ranges         room_day rows, PRIMARY KEY (room_type_id, stay_date)
 *
 * Already aligned deliberately: the 10-minute hold matches
 * POLICY.expiry.paymentHoldMinutes, and `supersede` below mirrors room_day's
 * ON CONFLICT DO UPDATE so the Rates screen survives the switch unchanged.
 *
 * Fixture stock (24/24/16/12) sums to the brief's 76 keys but is not the seeded
 * distribution — see apps/Backend/seeds/data/roomContent.ts.
 */
export type Role = 'staff' | 'gm' | 'owner';
export type Team = 'reservations' | 'sales';
export type Employee = {
  id: string;
  name: string;
  username: string;
  email: string;
  role: Role;
  team: Team | '';
  active: boolean;
  lastLogin: string;
};
export type Status = 'New' | 'In progress' | 'Resolved';
export type Category = 'Room' | 'Wedding' | 'Offsite' | 'Complaint' | 'Unclassified';
export type Message = {
  id: string;
  sender: string;
  text: string;
  time: string;
  kind: 'guest' | 'staff' | 'note';
  delivery: 'Received' | 'Delivered' | 'Failed' | 'Unknown';
};
export type Thread = {
  id: string;
  name: string;
  email: string;
  phone: string;
  subject: string;
  category: Category;
  channel: 'Website' | 'Email' | 'WhatsApp';
  status: Status;
  assignee: string;
  ai: 'Processing' | 'Draft ready' | 'Needs review' | 'Failed';
  draft: string;
  unread: boolean;
  created: string;
  messages: Message[];
  history: string[];
  dates: string;
  guests: string;
  budget: string;
  booking?: string;
  reopened: number;
  resolvedAt?: string;
};
export type Room = {
  id: string;
  name: string;
  stock: number;
  allotment: number;
  rate: number;
  capacity: number;
  beds: string;
  amenities: string[];
  revision: number;
};
export type Booking = {
  id: string;
  guest: string;
  email: string;
  phone: string;
  arrival: string;
  departure: string;
  confirmed: string;
  status: 'Confirmed' | 'Pending payment' | 'Payment failed' | 'Expired';
  payment: 'Succeeded' | 'Processing' | 'Failed' | 'Refunded' | 'Refund failed';
  lines: { room: string; quantity: number; adults: number; children: number; nightly: number }[];
  discount: number;
  tax: number;
  holdUntil?: string;
};
/** Read-only now. The Rates screen writes real `room_day` rows through the staff API
 *  (`RatesLive.tsx`); these fixtures only still feed the unwired Rooms availability matrix, and
 *  go when that screen is wired too. */
export type Override = {
  id: string;
  room: string;
  from: string;
  to: string;
  rate?: number;
  allotment?: number;
  blackout?: boolean;
};
export type Audit = {
  id: string;
  time: string;
  actor: string;
  role: Role;
  action: string;
  target: string;
  summary: string;
  before?: string;
  after?: string;
};
/** Shaped to match `GET /api/admin/promos/:promoId/redemptions`, which returns
 *  `{items:[{id, bookingId, state, createdAt}]}` from `promo_redemptions`. Held locally like
 *  the rest of this file until the console is wired; keeping the field names identical means
 *  the screen below does not change when it is. */
export type Redemption = { id: string; promo: string; bookingId: string; state: 'held' | 'consumed' | 'released'; createdAt: string };

export type Promo = {
  id: string;
  code: string;
  type: 'Percentage' | 'Fixed INR';
  value: number;
  expiry: string;
  limit: number;
  used: number;
  active: boolean;
};
export type Fact = {
  id: string;
  title: string;
  text: string;
  version: number;
  editor: string;
  updated: string;
  history: { version: number; text: string; editor: string; time: string }[];
};
export type State = {
  employees: Employee[];
  redemptions: Redemption[];
  threads: Thread[];
  rooms: Room[];
  bookings: Booking[];
  overrides: Override[];
  promos: Promo[];
  facts: Fact[];
  audit: Audit[];
  readAlerts: string[];
  revision: number;
};
export const DEMO_NOW = '2026-11-09T10:30:00+05:30';
export const statuses: Status[] = ['New', 'In progress', 'Resolved'];
export const categories: Category[] = ['Room', 'Wedding', 'Offsite', 'Complaint', 'Unclassified'];
export const money = (paise: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: paise % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(paise / 100);
export const day = (value: string) => value.slice(0, 10);

/**
 * The demo clock: starts at DEMO_NOW and advances one minute per saved action.
 * Every "what time is it" question goes through here, so elapsed-reply times and
 * hold expiry can never disagree about the current moment.
 */
export const now = (s: State) => new Date(Date.parse(DEMO_NOW) + s.revision * 60000).toISOString();
export const dateText = (value: string) =>
  value
    ? new Intl.DateTimeFormat('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'Asia/Kolkata',
      }).format(new Date(value.length === 10 ? `${value}T12:00:00+05:30` : value))
    : '—';
export const timeText = (value: string) =>
  new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(
    new Date(value),
  );
export function datesBetween(from: string, to: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return [];
  const start = Date.parse(from),
    end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || (end - start) / 86400000 > 730) return [];
  if (new Date(start).toISOString().slice(0, 10) !== from || new Date(end).toISOString().slice(0, 10) !== to) return [];
  const dates: string[] = [];
  for (let at = start; at <= end; at += 86400000) dates.push(new Date(at).toISOString().slice(0, 10));
  return dates;
}
export const nights = (b: Booking) => Math.round((Date.parse(b.departure) - Date.parse(b.arrival)) / 86400000);
export const bookingValue = (b: Booking) =>
  b.lines.reduce((sum, line) => sum + line.nightly * line.quantity * nights(b), 0) - b.discount + b.tax;
export const manager = (e: Employee) => e.role !== 'staff';
export const canExport = (e: Employee) => manager(e) || e.team === 'reservations';
export const visibleThreads = (s: State, e: Employee) => s.threads.filter((t) => manager(e) || t.assignee === e.id);
export function waitingMinutes(s: State, t: Thread) {
  const guest = t.messages.findLast((m) => m.kind === 'guest');
  const reply = t.messages.findLast((m) => m.kind === 'staff' && m.delivery === 'Delivered');
  if (t.status === 'Resolved' || !guest || (reply && Date.parse(reply.time) >= Date.parse(guest.time))) return null;
  return Math.max(0, Math.round((Date.parse(now(s)) - Date.parse(guest.time)) / 60000));
}
export function pageAllowed(e: Employee, page: string) {
  if (['overview', 'enquiries', 'bookings', 'rooms'].includes(page)) return true;
  if (['rates', 'management'].includes(page)) return manager(e);
  return ['reports', 'activity'].includes(page) && e.role === 'owner';
}
export function inventory(s: State, roomId: string, date: string) {
  const at = now(s);
  const room = s.rooms.find((r) => r.id === roomId);
  if (!room) throw new Error(`Unknown room type: ${roomId}`);
  let rate = room.rate,
    allotment = room.allotment,
    blackout = false,
    overridden = false;
  for (const o of s.overrides.filter((o) => o.room === roomId && o.from <= date && o.to >= date)) {
    if (o.rate !== undefined) rate = o.rate;
    if (o.allotment !== undefined) allotment = o.allotment;
    if (o.blackout !== undefined) blackout = o.blackout;
    overridden = true;
  }
  let confirmed = 0,
    held = 0;
  for (const b of s.bookings.filter((b) => b.arrival <= date && b.departure > date)) {
    const count = b.lines.filter((l) => l.room === roomId).reduce((sum, l) => sum + l.quantity, 0);
    if (b.status === 'Confirmed') confirmed += count;
    if (b.status === 'Pending payment' && b.holdUntil && Date.parse(b.holdUntil) > Date.parse(at)) held += count;
  }
  return {
    rate,
    allotment,
    blackout,
    confirmed,
    held,
    available: blackout ? 0 : Math.max(0, allotment - confirmed - held),
    overridden,
  };
}
export const initialEmployees: Employee[] = [
  {
    id: 'owner',
    name: 'Meera Rao',
    username: 'meera',
    email: 'meera@quietestate.example',
    role: 'owner',
    team: '',
    active: true,
    lastLogin: DEMO_NOW,
  },
  {
    id: 'gm',
    name: 'Arjun Hegde',
    username: 'arjun',
    email: 'arjun@quietestate.example',
    role: 'gm',
    team: '',
    active: true,
    lastLogin: DEMO_NOW,
  },
  {
    id: 'res',
    name: 'Kavya Shetty',
    username: 'kavya',
    email: 'kavya@quietestate.example',
    role: 'staff',
    team: 'reservations',
    active: true,
    lastLogin: DEMO_NOW,
  },
  {
    id: 'sales',
    name: 'Rohan Dev',
    username: 'rohan',
    email: 'rohan@quietestate.example',
    role: 'staff',
    team: 'sales',
    active: true,
    lastLogin: DEMO_NOW,
  },
  {
    id: 'old',
    name: 'Nisha Prabhu',
    username: 'nisha',
    email: 'nisha@quietestate.example',
    role: 'staff',
    team: 'sales',
    active: false,
    lastLogin: '2026-11-02T09:00:00+05:30',
  },
];
function thread(
  id: string,
  name: string,
  text: string,
  category: Category,
  channel: Thread['channel'],
  assignee: string,
  status: Status = 'New',
): Thread {
  const created = `2026-11-09T${id === 'ENQ-4411' ? '09:40' : '09:10'}:00+05:30`;
  return {
    id,
    name,
    email: `${name.toLowerCase().replaceAll(' ', '.')}@example.com`,
    phone: '+91 00000 00000',
    subject: text,
    category,
    channel,
    assignee,
    status,
    ai: 'Draft ready',
    draft:
      'Thank you for getting in touch with The Quiet Estate. Could you confirm your preferred dates and the number of adults and children? Our team will help you explore the options.',
    unread: true,
    created,
    messages: [{ id: `${id}-1`, sender: name, text, time: created, kind: 'guest', delivery: 'Received' }],
    history: [
      `Received via ${channel}`,
      assignee ? 'Automatically routed to the configured team owner' : 'Awaiting assignment',
    ],
    dates:
      category === 'Wedding'
        ? 'Feb 2027 · exact dates not provided'
        : category === 'Room'
          ? '14–16 Nov · year needs confirmation'
          : 'January · year needs confirmation',
    guests:
      category === 'Wedding'
        ? 'About 250 guests (requested)'
        : category === 'Offsite'
          ? '45 guests (requested)'
          : '2 adults, 1 child',
    budget: 'Not provided',
    reopened: 0,
  };
}
export function seedState(): State {
  const threads = [
    thread(
      'ENQ-4410',
      'Ananya Bhat',
      "Venue for my sister's wedding in Feb 2027, about 250 guests, 2 nights",
      'Wedding',
      'Email',
      'sales',
    ),
    thread('ENQ-4411', 'Priya Menon', 'Is a villa free 14-16 Nov for 2 adults and a child?', 'Room', 'WhatsApp', 'res'),
    thread(
      'ENQ-4412',
      'Vikram Shah',
      'Team of 45 wants a January offsite with a conference hall',
      'Offsite',
      'Website',
      'sales',
      'In progress',
    ),
    thread(
      'ENQ-4413',
      'Sahana Pai',
      'I have been waiting for a response about my booking. Please help.',
      'Complaint',
      'Website',
      'gm',
      'In progress',
    ),
    thread(
      'ENQ-4414',
      'Devika Rao',
      'Could you help with next weekend? We may be a large group.',
      'Unclassified',
      'Email',
      '',
    ),
    thread(
      'ENQ-4415',
      'Aditya Kulkarni',
      'Could you confirm directions for our stay?',
      'Room',
      'Website',
      'res',
      'In progress',
    ),
    thread('ENQ-4416', 'Tara Nair', 'Thank you, that answers everything.', 'Room', 'Website', 'res', 'Resolved'),
    thread('ENQ-4417', 'Amit Desai', 'Do you have accessible rooms?', 'Room', 'Email', ''),
  ];
  threads[3].booking = 'QE-260901';
  threads[4].ai = 'Needs review';
  threads[4].draft = '';
  threads[7].ai = 'Failed';
  threads[7].draft = '';
  threads[5].messages.push({
    id: 'reply-1',
    sender: 'Kavya Shetty',
    text: 'Please share your expected arrival time so we can help with directions.',
    time: '2026-11-09T09:35:00+05:30',
    kind: 'staff',
    delivery: 'Failed',
  });
  threads[5].status = 'In progress';
  threads[2].messages.push({
    id: 'reply-2',
    sender: 'Rohan Dev',
    text: 'Could you confirm the January dates and whether accommodation is required?',
    time: '2026-11-09T09:30:00+05:30',
    kind: 'staff',
    delivery: 'Delivered',
  });
  threads[6].messages.push({
    id: 'reply-3',
    sender: 'Kavya Shetty',
    text: 'You are welcome. We look forward to hearing from you.',
    time: '2026-11-09T09:45:00+05:30',
    kind: 'staff',
    delivery: 'Delivered',
  });
  threads[6].resolvedAt = '2026-11-09T09:50:00+05:30';
  return {
    employees: structuredClone(initialEmployees),
    threads,
    rooms: [
      {
        id: 'estate',
        name: 'Estate Room',
        stock: 24,
        allotment: 8,
        rate: 850000,
        capacity: 2,
        beds: 'One king bed',
        amenities: ['Wi-Fi', 'Private bathroom', 'Tea & coffee'],
        revision: 1,
      },
      {
        id: 'garden',
        name: 'Garden Room',
        stock: 24,
        allotment: 6,
        rate: 950000,
        capacity: 2,
        beds: 'One king bed',
        amenities: ['Garden outlook', 'Wi-Fi', 'Private bathroom'],
        revision: 1,
      },
      {
        id: 'suite',
        name: 'Estate Suite',
        stock: 16,
        allotment: 4,
        rate: 1250000,
        capacity: 3,
        beds: 'King bed & sofa bed',
        amenities: ['Sitting area', 'Wi-Fi', 'Private bathroom'],
        revision: 1,
      },
      {
        id: 'villa',
        name: 'Estate Villa',
        stock: 12,
        allotment: 3,
        rate: 1850000,
        capacity: 4,
        beds: 'Two king beds',
        amenities: ['Two bedrooms', 'Living space', 'Wi-Fi'],
        revision: 1,
      },
    ],
    bookings: Array.from({ length: 18 }, (_, i): Booking => {
      const arrival = `2026-11-${String(9 + (i % 9)).padStart(2, '0')}`;
      const departure = `2026-11-${String(11 + (i % 9)).padStart(2, '0')}`;
      return {
        id: `QE-2609${String(i + 1).padStart(2, '0')}`,
        guest: ['Sahana Pai', 'Priya Menon', 'Amit Desai', 'Neha Kamath', 'Varun Bhat', 'Diya Rao'][i % 6],
        email: 'guest@example.com',
        phone: '+91 00000 00000',
        arrival,
        departure,
        confirmed: `2026-11-${String(2 + (i % 8)).padStart(2, '0')}T09:00:00+05:30`,
        status: i === 15 ? 'Pending payment' : i === 16 ? 'Payment failed' : i === 17 ? 'Expired' : 'Confirmed',
        payment: i === 15 ? 'Processing' : i === 16 ? 'Failed' : i === 17 ? 'Refunded' : 'Succeeded',
        lines: [
          {
            room: ['estate', 'garden', 'suite', 'villa'][i % 4],
            quantity: 1,
            adults: 2,
            children: 0,
            nightly: [800000, 900000, 1200000, 1800000][i % 4],
          },
          ...(i === 0 ? [{ room: 'garden', quantity: 1, adults: 2, children: 0, nightly: 900000 }] : []),
        ],
        discount: i === 0 ? 100000 : 0,
        tax: 240000,
        ...(i === 15 ? { holdUntil: '2026-11-09T10:40:00+05:30' } : {}),
      };
    }),
    overrides: [
      { id: 'festival', room: 'villa', from: '2026-11-13', to: '2026-11-16', rate: 2200000 },
      { id: 'blackout', room: 'suite', from: '2026-11-20', to: '2026-11-21', blackout: true },
      { id: 'sold', room: 'villa', from: '2026-11-12', to: '2026-11-12', allotment: 2 },
    ],
    redemptions: [
      { id: 'r1', promo: 'p1', bookingId: 'QE-260901', state: 'consumed', createdAt: '2026-11-02T09:00:00+05:30' },
      { id: 'r2', promo: 'p1', bookingId: 'QE-260916', state: 'held', createdAt: '2026-11-09T10:12:00+05:30' },
      { id: 'r3', promo: 'p1', bookingId: 'QE-260918', state: 'released', createdAt: '2026-11-08T18:40:00+05:30' },
    ],
    promos: [
      {
        id: 'p1',
        code: 'QUIET10',
        type: 'Percentage',
        value: 10,
        expiry: '2026-12-31',
        limit: 100,
        used: 18,
        active: true,
      },
    ],
    facts: [
      'Room information',
      'Amenities',
      'Arrival & check-in',
      'House policies',
      'Weddings',
      'Offsites',
      'Directions & contact',
    ].map((title, i) => ({
      id: `fact-${i}`,
      title,
      text:
        i === 4
          ? 'Wedding enquiries are coordinated by our sales team. Capacity and event pricing require staff confirmation.'
          : i === 5
            ? 'Share your group size, dates and accommodation requirements. Conference-hall availability requires confirmation.'
            : i === 6
              ? 'The estate is in Chikkamagaluru, Karnataka. Exact directions are provided by reservations.'
              : 'Contact reservations for confirmed details. Room information is available in the room catalogue.',
      version: 1,
      editor: 'Arjun Hegde',
      updated: DEMO_NOW,
      history: [],
    })),
    audit: [
      {
        id: 'seed-1',
        time: DEMO_NOW,
        actor: 'Meera Rao',
        role: 'owner',
        action: 'Rates updated',
        target: 'villa',
        summary: 'Festival nightly rate saved',
        before: '₹18,500 base',
        after: '₹22,000 · 13–16 Nov',
      },
    ],
    readAlerts: [],
    revision: 1,
  };
}

export type Command =
  | { type: 'thread'; id: string; status?: Status; category?: Category; assignee?: string }
  | { type: 'reply'; id: string; text: string; delivery: Message['delivery']; note?: boolean }
  | { type: 'retry-delivery'; id: string; message: string }
  | { type: 'ai'; id: string; fail?: boolean }
  | { type: 'incoming'; scenario: string; id: string }
  | { type: 'guest-reply'; id: string }
  | { type: 'promo'; promo: Promo }
  | { type: 'employee'; employee: Employee }
  | { type: 'fact'; id: string; text: string; version: number }
  | { type: 'export'; from: string; to: string }
  | { type: 'read'; id: string };
export function transition(state: State, actorId: string, cmd: Command, time: string, id: string): State {
  const actor = state.employees.find((e) => e.id === actorId);
  if (!actor?.active) throw new Error('This employee account is disabled.');
  if (['promo', 'employee', 'fact', 'incoming'].includes(cmd.type) && !manager(actor))
    throw new Error('You do not have permission for this action.');
  const s = structuredClone(state);
  let target = '',
    summary = '',
    before = '',
    after = '';
  if (['thread', 'reply', 'retry-delivery', 'ai', 'guest-reply'].includes(cmd.type) && 'id' in cmd) {
    const t = s.threads.find((t) => t.id === cmd.id);
    if (!t || (!manager(actor) && t.assignee !== actor.id)) throw new Error('You cannot access this enquiry.');
    target = t.id;
    before = `${t.status} · ${t.category} · ${t.assignee || 'Unassigned'}`;
    if (cmd.type === 'thread') {
      if (cmd.status && !statuses.includes(cmd.status)) throw new Error('Choose a valid status.');
      if (cmd.category && !categories.includes(cmd.category)) throw new Error('Choose a valid category.');
      if (cmd.assignee !== undefined && !manager(actor))
        throw new Error('Only GM/owner can directly assign enquiries. Use category correction to reroute.');
      if (cmd.assignee && !s.employees.some((e) => e.id === cmd.assignee && e.active))
        throw new Error('Choose an active employee.');
      if (cmd.status) {
        t.status = cmd.status;
        if (cmd.status === 'Resolved') t.resolvedAt = time;
        else delete t.resolvedAt;
      }
      if (cmd.category) {
        t.category = cmd.category;
        t.ai = 'Needs review';
        t.draft = '';
        const team = cmd.category === 'Room' ? 'reservations' : 'sales';
        t.assignee =
          cmd.category === 'Complaint'
            ? s.employees.find((e) => e.role === 'gm' && e.active)?.id || ''
            : cmd.category === 'Unclassified'
              ? ''
              : s.employees.find((e) => e.team === team && e.active)?.id || '';
      }
      if (cmd.assignee !== undefined) t.assignee = cmd.assignee;
      after = `${t.status} · ${t.category} · ${t.assignee || 'Unassigned'}`;
      summary = 'Status, classification or assignment updated';
    } else if (cmd.type === 'reply') {
      if (!cmd.text.trim() || cmd.text.length > 5000) throw new Error('Enter a reply between 1 and 5,000 characters.');
      t.messages.push({
        id,
        sender: actor.name,
        text: cmd.text.trim(),
        time,
        kind: cmd.note ? 'note' : 'staff',
        delivery: cmd.delivery,
      });
      if (!cmd.note) {
        t.status = 'In progress';
        t.unread = false;
      }
      summary = cmd.note ? 'Internal note added' : `Staff-approved reply · ${cmd.delivery}`;
    } else if (cmd.type === 'retry-delivery') {
      const message = t.messages.find((m) => m.id === cmd.message);
      if (!message || message.kind !== 'staff' || message.delivery !== 'Failed')
        throw new Error('Only a failed message can be retried.');
      message.delivery = 'Delivered';
      message.time = time;
      t.status = 'In progress';
      summary = 'Message delivered on retry';
    } else if (cmd.type === 'ai') {
      t.ai = cmd.fail ? 'Failed' : t.category === 'Unclassified' ? 'Needs review' : 'Draft ready';
      t.draft = cmd.fail
        ? ''
        : `Thank you for contacting The Quiet Estate. ${t.category === 'Complaint' ? 'Our GM has been alerted and will review your concern.' : t.category === 'Wedding' || t.category === 'Offsite' ? 'Our sales team can help with your event. Facilities, capacity and event prices require confirmation.' : 'Our reservations team can help with room options.'} Could you confirm your exact dates and guest count?`;
      summary = `AI processing · ${t.ai}`;
    } else if (cmd.type === 'guest-reply') {
      t.messages.push({
        id,
        sender: t.name,
        text: 'Thank you. Could you also help with the next steps?',
        time,
        kind: 'guest',
        delivery: 'Received',
      });
      if (t.status === 'Resolved') t.reopened++;
      t.status = 'In progress';
      t.unread = true;
      delete t.resolvedAt;
      if (!s.employees.some((e) => e.id === t.assignee && e.active)) t.assignee = '';
      summary = 'Guest replied · conversation reopened';
    }
    t.history.push(`${time} · ${actor.name} · ${summary}`);
  } else if (cmd.type === 'promo') {
    const p = cmd.promo;
    if (
      !/^[A-Z0-9_-]{3,24}$/.test(p.code) ||
      !Number.isFinite(p.value) ||
      p.value <= 0 ||
      (p.type === 'Percentage' && p.value > 100) ||
      !Number.isInteger(p.limit) ||
      p.limit < p.used ||
      p.limit < 1 ||
      !datesBetween(p.expiry, p.expiry).length
    )
      throw new Error('Check code, discount, expiry and usage limit.');
    if (s.promos.some((x) => x.id !== p.id && x.code === p.code)) throw new Error('This promo code already exists.');
    const at = s.promos.findIndex((x) => x.id === p.id);
    if (at >= 0) s.promos[at] = p;
    else s.promos.push(p);
    target = p.code;
    summary = 'Promo code saved';
  } else if (cmd.type === 'employee') {
    const e = cmd.employee,
      old = s.employees.find((x) => x.id === e.id);
    if (
      e.role === 'owner' ||
      old?.role === 'owner' ||
      (actor.role === 'gm' && (e.role !== 'staff' || (old && old.role !== 'staff')))
    )
      throw new Error('You cannot manage this role. Owner accounts are protected.');
    if (
      !e.name.trim() ||
      !/^[a-z0-9._-]{3,30}$/i.test(e.username) ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.email) ||
      (e.role === 'staff' && !['sales', 'reservations'].includes(e.team))
    )
      throw new Error('Enter a name, username, approved email and staff team.');
    if (
      s.employees.some(
        (x) =>
          x.id !== e.id &&
          (x.username.toLowerCase() === e.username.toLowerCase() || x.email.toLowerCase() === e.email.toLowerCase()),
      )
    )
      throw new Error('Username or email already exists.');
    if (old) s.employees[s.employees.indexOf(old)] = e;
    else s.employees.push(e);
    if (!e.active)
      s.threads
        .filter((t) => t.assignee === e.id && t.status !== 'Resolved')
        .forEach((t) => {
          t.assignee = '';
          t.history.push(`${time} · Employee disabled; moved to Unassigned`);
        });
    target = e.username;
    before = old ? `${old.role} · ${old.team} · ${old.active ? 'Active' : 'Disabled'}` : '';
    after = `${e.role} · ${e.team} · ${e.active ? 'Active' : 'Disabled'}`;
    summary = 'Employee account saved';
  } else if (cmd.type === 'fact') {
    const f = s.facts.find((f) => f.id === cmd.id);
    if (!f) throw new Error('Information section not found.');
    if (f.version !== cmd.version) throw new Error('A newer version exists. Reload before saving.');
    if (!cmd.text.trim() || cmd.text.length > 10000)
      throw new Error('Enter approved information, up to 10,000 characters.');
    f.history.unshift({ version: f.version, text: f.text, editor: f.editor, time: f.updated });
    before = f.text;
    f.text = cmd.text.trim();
    f.version++;
    f.editor = actor.name;
    f.updated = time;
    target = f.title;
    summary = `Approved information v${f.version} saved`;
    after = f.text;
  } else if (cmd.type === 'export') {
    if (!canExport(actor)) throw new Error('Sales staff cannot export booking records.');
    if (!datesBetween(cmd.from, cmd.to).length) throw new Error('Select a valid export range.');
    target = 'Booking CSV';
    summary = `Confirmation dates ${cmd.from} to ${cmd.to}`;
  } else if (cmd.type === 'incoming') {
    const complaint = cmd.scenario === 'Complaint';
    const t = thread(
      cmd.id,
      'Ishita Kamath',
      complaint ? 'I need to raise a concern about my stay.' : 'Could you help plan a stay for our family?',
      complaint ? 'Complaint' : cmd.scenario === 'Low confidence' ? 'Unclassified' : 'Room',
      cmd.scenario === 'WhatsApp' ? 'WhatsApp' : cmd.scenario === 'Email' ? 'Email' : 'Website',
      complaint
        ? s.employees.find((e) => e.role === 'gm' && e.active)?.id || ''
        : cmd.scenario === 'Low confidence' || cmd.scenario === 'AI failure'
          ? ''
          : s.employees.find((e) => e.team === 'reservations' && e.active)?.id || '',
    );
    t.created = time;
    t.messages[0].time = time;
    if (cmd.scenario === 'AI failure') {
      t.ai = 'Failed';
      t.draft = '';
    }
    if (cmd.scenario === 'Low confidence') {
      t.ai = 'Needs review';
      t.draft = '';
    }
    s.threads.unshift(t);
    target = t.id;
    summary = `${cmd.scenario} enquiry received`;
  } else if (cmd.type === 'read') {
    const t = s.threads.find((t) => t.id === cmd.id);
    if (!t || (!manager(actor) && t.assignee !== actor.id)) throw new Error('You cannot access this enquiry.');
    if (!s.readAlerts.includes(cmd.id)) s.readAlerts.push(cmd.id);
    t.unread = false;
    return s;
  }
  s.revision++;
  s.audit.unshift({
    id,
    time,
    actor: actor.name,
    role: actor.role,
    action:
      cmd.type === 'export'
          ? 'Bookings exported'
          : cmd.type === 'employee'
            ? 'Employee updated'
            : cmd.type === 'fact'
              ? 'Information updated'
              : cmd.type === 'promo'
                ? 'Promo updated'
                : 'Enquiry updated',
    target,
    summary,
    before,
    after,
  });
  return s;
}
export const csvCell = (value: unknown) =>
  `"${String(value)
    .replace(/^[=+@\-\t\r]/, (c) => `'${c}`)
    .replaceAll('"', '""')}"`;
export function bookingCSV(s: State, from: string, to: string) {
  const header = [
    'Reference',
    'Confirmed at (Asia/Kolkata)',
    'Guest',
    'Email',
    'Phone',
    'Check-in',
    'Checkout',
    'Room type',
    'Quantity',
    'Adults per room',
    'Children per room',
    'Room-line value INR',
    'Booking discount INR (repeated)',
    'Booking tax INR (repeated)',
    'Booking total INR (repeated; do not sum)',
    'Booking status',
    'Payment status',
  ];
  return [
    header,
    ...s.bookings
      .filter((b) => b.status === 'Confirmed' && day(b.confirmed) >= from && day(b.confirmed) <= to)
      .flatMap((b) =>
        b.lines.map((l) => [
          b.id,
          b.confirmed,
          b.guest,
          b.email,
          b.phone,
          b.arrival,
          b.departure,
          s.rooms.find((r) => r.id === l.room)?.name,
          l.quantity,
          l.adults,
          l.children,
          (l.nightly * l.quantity * nights(b)) / 100,
          b.discount / 100,
          b.tax / 100,
          bookingValue(b) / 100,
          b.status,
          b.payment,
        ]),
      ),
  ]
    .map((row) => row.map(csvCell).join(','))
    .join('\r\n');
}
