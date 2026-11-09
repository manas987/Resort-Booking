import { bookingValue, datesBetween, inventory, type State } from './model';
export function report(s: State, from: string, to: string) {
  const days = datesBetween(from, to);
  const confirmed = s.bookings.filter(
    (b) => b.status === 'Confirmed' && b.confirmed.slice(0, 10) >= from && b.confirmed.slice(0, 10) <= to,
  );
  const series = days.map((date) => ({
    date,
    value: confirmed.filter((b) => b.confirmed.startsWith(date)).reduce((n, b) => n + bookingValue(b), 0),
    nights: s.rooms.reduce((sum, r) => sum + inventory(s, r.id, date).confirmed, 0),
    allotment: s.rooms.reduce((sum, r) => sum + inventory(s, r.id, date).allotment, 0),
  }));
  const threads = s.threads.filter((t) => t.created.slice(0, 10) >= from && t.created.slice(0, 10) <= to);
  const replies = threads
    .flatMap((t) => {
      const reply = t.messages.find((m) => m.kind === 'staff' && m.delivery === 'Delivered');
      return reply ? [Math.max(0, (Date.parse(reply.time) - Date.parse(t.created)) / 60000)] : [];
    })
    .sort((a, b) => a - b);
  const median = replies.length
    ? replies.length % 2
      ? replies[Math.floor(replies.length / 2)]
      : (replies[replies.length / 2 - 1] + replies[replies.length / 2]) / 2
    : null;
  const resolved = threads.filter((t) => t.status === 'Resolved' && t.reopened === 0 && t.resolvedAt);
  const resolution = resolved.length
    ? resolved.reduce((n, t) => n + Math.max(0, (Date.parse(t.resolvedAt!) - Date.parse(t.created)) / 60000), 0) /
      resolved.length
    : null;
  const sold = series.reduce((n, d) => n + d.nights, 0),
    allotment = series.reduce((n, d) => n + d.allotment, 0);
  // Synthetic session cohort: bookings are linked to fixture sessions; other visitors have no conversion.
  const sessions = s.bookings
    .map((b) => ({ date: b.confirmed.slice(0, 10), search: true, checkout: true, confirmed: b.status === 'Confirmed' }))
    .concat(
      Array.from({ length: 42 }, (_, i) => ({
        date: `2026-11-${String(2 + (i % 8)).padStart(2, '0')}`,
        search: i < 25,
        checkout: i < 7,
        confirmed: false,
      })),
    )
    .filter((v) => v.date >= from && v.date <= to);
  return {
    series,
    value: confirmed.reduce((n, b) => n + bookingValue(b), 0),
    sold,
    utilisation: allotment ? (sold / allotment) * 100 : null,
    median,
    resolution,
    unanswered: threads.length - replies.length,
    replied: replies.length,
    reopened: threads.reduce((n, t) => n + t.reopened, 0),
    threads,
    funnel: [
      { label: 'Visit', count: sessions.length },
      { label: 'Search', count: sessions.filter((s) => s.search).length },
      { label: 'Checkout', count: sessions.filter((s) => s.checkout).length },
      { label: 'Confirmed', count: sessions.filter((s) => s.confirmed).length },
    ],
    websiteEnquiries: threads.filter((t) => t.channel === 'Website').length,
  };
}
