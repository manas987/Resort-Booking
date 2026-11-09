// A line is one physical room — not a quantity (Docs/14-frontend-api-map.md: `POST /quotes`'
// `QuoteLineItem` has no multiplier). Two Garden Suites are two lines. `slug`/`name`/
// `pricePaise` are carried for display only; the wire shape (`toQuoteLineItems`) strips them.
export type CartLine = {
  lineId: string;
  roomTypeId: string;
  slug: string;
  name: string;
  pricePaise: number;
  adults: number;
  children: number;
};
export type Cart = CartLine[];

// Mirrors apps/Backend/src/core/policy.ts `stay.maxRoomsPerBooking` — a client-side UX guard
// only (disables "add another room" before the guest wastes a round trip). The backend is the
// authority and re-checks this at quote and hold time regardless (INV-59 governs the backend's
// own validators, not a separate package's display copy of the same number).
export const MAX_ROOMS_PER_BOOKING = 4;

/** Only non-personal selection data survives the full-page Google sign-in redirect. */
export function restoreCart(raw: string | null): Cart {
  try {
    const value: unknown = JSON.parse(raw ?? '[]');
    if (!Array.isArray(value) || value.length > MAX_ROOMS_PER_BOOKING) return [];
    const valid = value.every((line) => line && typeof line === 'object'
      && ['lineId', 'roomTypeId', 'slug', 'name'].every((key) => typeof line[key] === 'string')
      && Number.isSafeInteger(line.pricePaise) && line.pricePaise >= 0
      && Number.isSafeInteger(line.adults) && line.adults >= 1
      && Number.isSafeInteger(line.children) && line.children >= 0);
    return valid && new Set(value.map((line) => line.lineId)).size === value.length ? value as Cart : [];
  } catch { return []; }
}

export function addLine(cart: Cart, room: { roomTypeId: string; slug: string; name: string; pricePaise: number }): Cart {
  if (cart.length >= MAX_ROOMS_PER_BOOKING) return cart;
  return [...cart, { lineId: crypto.randomUUID(), roomTypeId: room.roomTypeId, slug: room.slug, name: room.name, pricePaise: room.pricePaise, adults: 1, children: 0 }];
}

export function removeLine(cart: Cart, lineId: string): Cart {
  return cart.filter((line) => line.lineId !== lineId);
}

export function updateOccupancy(cart: Cart, lineId: string, patch: Partial<Pick<CartLine, 'adults' | 'children'>>): Cart {
  return cart.map((line) => {
    if (line.lineId !== lineId) return line;
    const adults = patch.adults ?? line.adults;
    const children = patch.children ?? line.children;
    if (!Number.isSafeInteger(adults) || adults < 1 || !Number.isSafeInteger(children) || children < 0) return line;
    return { ...line, adults, children };
  });
}

export function linesForRoomType(cart: Cart, roomTypeId: string): CartLine[] {
  return cart.filter((line) => line.roomTypeId === roomTypeId);
}

/** The wire shape for `POST /quotes`. */
export function toQuoteLineItems(cart: Cart): Array<{ roomTypeId: string; adults: number; children: number }> {
  return cart.map(({ roomTypeId, adults, children }) => ({ roomTypeId, adults, children }));
}

/** Client-side-only feedback, mirroring `core/pricing.ts`'s per-room occupancy check so the UI
 * can disable an obviously-invalid combination before a round trip — never authoritative; the
 * backend re-validates every line at quote time regardless. */
export function fitsOccupancy(adults: number, children: number, room: { maxAdults: number; maxChildren: number; maxOccupancy: number }): boolean {
  return adults >= 1 && adults <= room.maxAdults && children <= room.maxChildren && adults + children <= room.maxOccupancy;
}

export function stayNights(arrival: string, departure: string) {
  const from = Date.parse(arrival.slice(0, 10));
  const to = Date.parse(departure.slice(0, 10));
  return Number.isFinite(from) && Number.isFinite(to) && to > from ? Math.round((to - from) / 86400000) : 0;
}

export function stayLabel(arrival: string, departure: string) {
  if (!stayNights(arrival, departure)) return 'Choose your dates';
  const fmt = (date: string) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(`${date.slice(0, 10)}T12:00:00+05:30`));
  return `${fmt(arrival)} — ${fmt(departure)}`;
}
