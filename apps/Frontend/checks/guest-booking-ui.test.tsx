import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { Router } from 'wouter';
import { Checkout } from '../src/components/Checkout';
import { AvailabilityCalendar } from '../src/components/AvailabilityCalendar';
import { ImageAccordion } from '../src/components/bencho/ImageAccordion';
import { addLine, restoreCart } from '../src/data/cart';
import { clearSession, setSession } from '../src/lib/session';

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

test('checkout groups matching rooms, exposes quantity controls and sends signed-out guests to sign-in', () => {
  clearSession();
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
  setSession({ accessToken: 'test-only', principal: { userId: 'u1', kind: 'guest', role: 'guest', team: null, emailVerified: true, phoneVerified: true } });
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
  expect(checkout).toContain('setQuote(null)');
  expect(checkout).toContain('photo.variants.map');
  expect(source('../src/index.css')).toContain('.room-more-grid img{width:100%;height:auto;aspect-ratio:3/2;');
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
