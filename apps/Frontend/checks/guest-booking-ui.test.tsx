import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { Router } from 'wouter';
import { Checkout } from '../src/components/Checkout';
import { AvailabilityCalendar } from '../src/components/AvailabilityCalendar';
import { ImageAccordion } from '../src/components/bencho/ImageAccordion';
import { addLine, restoreCart } from '../src/data/cart';
import { clearSession, setSession, finishRestoring } from '../src/lib/session';

const room = { roomTypeId: 'r1', slug: 'garden-suite', name: 'Garden Suite', pricePaise: 720000 };
const cart = addLine(addLine([], room), room);
const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('cart survives an authentication redirect; invalid stored selections are rejected', () => {
  expect(restoreCart(JSON.stringify(cart))).toEqual(cart);
  expect(restoreCart('invalid')).toEqual([]);
  expect(restoreCart(JSON.stringify([{ ...cart[0], adults: 0 }]))).toEqual([]);
  expect(restoreCart(JSON.stringify([{ ...cart[0], pricePaise: -1 }]))).toEqual([]);
  expect(restoreCart(JSON.stringify([cart[0], cart[0]]))).toEqual([]);
  expect(restoreCart(JSON.stringify(Array(5).fill(cart[0])))).toEqual([]);
});

test('the whole accordion image links to details with dates; cart actions are sibling controls', () => {
  const html = renderToStaticMarkup(<Router ssrPath="/book/select"><ImageAccordion
    rooms={[{ ...room, coverPhotoUrl: '/room.jpg' }]}
    roomHref={(item) => `/rooms/${item.slug}?arrival=2026-11-12&departure=2026-11-19`}
    renderActions={() => <button type="button">Add a room</button>}
  /></Router>);
  expect(html).toContain('class="acc-activate"');
  expect(html).toContain('href="/rooms/garden-suite?arrival=2026-11-12&amp;departure=2026-11-19"');
  expect(html).not.toMatch(/<a[^>]*class="acc-activate"[^>]*>[^]*?<button[^]*?<\/a>/);
});

function renderCheckout() {
  return renderToStaticMarkup(<Router ssrPath="/checkout"><Checkout arrival="2026-11-12" departure="2026-11-19" cart={cart} onCart={() => {}} onSignIn={() => {}} /></Router>);
}

const VERIFIED_GUEST = { userId: 'u1', kind: 'guest', role: 'guest', team: null, emailVerified: true, phoneVerified: true } as const;

/** The session store starts in its restoring window — the refresh-cookie bootstrap has not
 *  answered yet. Every test below is about what checkout shows ONCE it has, so they settle it
 *  first. The window itself has its own test. */
test('checkout does not claim a guest is signed out before the session bootstrap answers', () => {
  clearSession();
  const restoringHtml = renderCheckout();
  // The branch that would send an already-signed-in guest back to /signin must not be live yet:
  // that is the bug this guards. The button stays in the markup (no UI change) but is inert.
  expect(restoringHtml).toContain('Checking your sign-in…');
  expect(restoringHtml).not.toContain('Make it your stay.');
  expect(restoringHtml).toContain('disabled');

  // The bootstrap answering is what commits the page to one branch or the other.
  finishRestoring();
  expect(renderCheckout()).toContain('Make it your stay.');

  setSession({ accessToken: 'test-only', principal: VERIFIED_GUEST });
  try {
    expect(renderCheckout()).toContain('id="co-guest-email"');
  } finally { clearSession(); }
});

test('checkout groups matching rooms, exposes quantity controls and sends signed-out guests to sign-in', () => {
  clearSession();
  finishRestoring();
  const html = renderCheckout();
  expect(html.match(/class="checkout-item"/g)).toHaveLength(1);
  expect(html).toContain('2 rooms');
  expect(html).toContain('Remove one Garden Suite');
  expect(html).toContain('Add one Garden Suite');
  expect(html).toContain('checkout-room-photo');
  expect(html).toContain('Sign in to book');
  expect(html).not.toContain('Sign in to continue');
  expect(html).not.toContain('co-guest-email');
  expect(html).not.toContain('checkout-signin');
});

test('verified guests see one guest form and a form-validated payment action', () => {
  setSession({ accessToken: 'test-only', principal: VERIFIED_GUEST });
  finishRestoring();
  try {
    const html = renderCheckout();
    expect(html.match(/id="co-guest-email"/g)).toHaveLength(1);
    expect(html).toContain('form="checkout-guest"');
    expect(html).not.toContain('Sign in to book');
  } finally { clearSession(); }
});

test('quantity changes cannot pay an old quote and related photos have a bounded height', () => {
  const checkout = source('../src/components/Checkout.tsx');
  expect(checkout).toContain('quoteKey === quoteSignature(promoApplied)');
  expect(checkout).toContain('if (request !== quoteRequest.current) return;');
  expect(checkout).toContain('!quoteLoading && verified');
  // The bootstrap itself: without it, only a 401 ever restored a guest, and /checkout provokes
  // none — which is exactly how a signed-in guest came to be shown "Sign in to book" for ever.
  expect(source('../src/App.tsx')).toContain('void restoreGuestSession().finally(finishRestoring)');
  expect(source('../src/lib/api.ts')).toContain('export async function restoreGuestSession()');
  // A Google guest has a verified email and no phone at all, and booking needs both. Sending
  // them through the email round again would verify what is already verified and leave them
  // exactly where they started, so the form collects only the contact that is missing.
  const signin = source('../src/components/CheckoutSignIn.tsx');
  expect(signin).toContain("!principal.phoneVerified && (identity.needsOnboarding || verificationOnly)");
  expect(signin).toContain("setStep('phone')");
  expect(checkout).toContain('setQuote(null)');
  expect(checkout).toContain('photo.variants.map');
  expect(source('../src/index.css')).toContain('.room-more-grid img{width:100%;height:auto;aspect-ratio:3/2;');
});

test('Google guests without a phone can reach Checkout without signing in again', () => {
  finishRestoring();
  setSession({ accessToken: 'test-only', principal: { ...VERIFIED_GUEST, phoneVerified: false } });
  try {
    const html = renderCheckout();
    expect(html).toContain('id="co-guest-email"');
    expect(html).toContain('Checkout');
    expect(html).not.toContain('Sign in to book');
  } finally { clearSession(); }
});

test('nullable audit targets use their kind without slicing null', () => {
  const audit = source('../src/console/Audit.tsx');
  expect(audit).toContain('targetId: string | null');
  expect(audit).toContain("row.targetId ?");
  expect(audit).toContain(': row.targetKind');
});

test('payment confirmation and duplicate-quote recovery link to the booking ID, not its reference', () => {
  const checkout = source('../src/components/Checkout.tsx');
  expect(checkout).toContain('pollBookingStatus(booking.reference, booking.bookingId)');
  expect(checkout).toContain('navigate(`/booking/${bookingId}`)');
  expect(checkout).not.toContain('navigate(`/booking/${reference}`)');
  expect(checkout).toContain('existingBookingId ? `/booking/${existingBookingId}`');
});

test('checkout accepts the reserved reviewer phone and reads existing guest details', () => {
  finishRestoring();
  setSession({ accessToken: 'test-only', principal: VERIFIED_GUEST });
  try {
    const html = renderCheckout();
    expect(html).toContain('pattern="[0-9]{10}"');
    expect(source('../src/components/Checkout.tsx')).toContain("('/auth/me', { signal: controller.signal })");
  } finally { clearSession(); }
});

test('room availability is read-only and does not turn a loading state into sold-out dates', () => {
  const html = renderToStaticMarkup(<AvailabilityCalendar slug="garden-suite" checkIn="2026-11-12" checkOut="2026-11-19" />);
  expect(html).toContain('Checking availability');
  expect(html).not.toContain('avail-cal-unavailable');
  const calendar = source('../src/components/AvailabilityCalendar.tsx');
  expect(calendar).not.toContain('onSelect');
  expect(calendar).not.toContain('Choose your check-in');
  expect(calendar).toContain('!error && data');
  const details = source('../src/components/RoomDetails.tsx');
  expect(details).toContain('<strong>Check availability</strong>');
  expect(details).not.toContain('Add a room to your stay using + above.');
});
