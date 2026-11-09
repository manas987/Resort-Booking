import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { stops, slideOffset } from '../src/data/tour';

// Room routing (`roomFromHash` against a static catalog) was removed in 3D — rooms now come
// from `GET /rooms/:slug`, and the route itself is wouter's `/rooms/:slug`, verified by the
// SSR smoke check (`scripts/ssr-smoke.tsx`) and the end-to-end click-through, not a pure
// function here.
for (let active = 0; active < stops.length; active++) {
  assert.equal(slideOffset(active, active, stops.length), 0);
  assert.equal(slideOffset((active + 1) % stops.length, active, stops.length), 1);
  assert.equal(slideOffset((active + stops.length - 1) % stops.length, active, stops.length), -1);
}

// The demo sign-in guards this file used to assert are gone with `src/data/signInDemo.ts`:
// /signin ran a hardcoded code and a hardcoded "existing guest" email, and a Google button that
// decoded the credential JWT client-side and trusted it. It now uses the same real OTP flow as
// /checkout, and Google is a full-page navigation to the backend's redirect endpoint.
//
// What replaces them is a regression guard, not a unit test: the demo module must stay deleted
// and the client-side Google decode must not come back. Both are greps, because the thing worth
// preventing is a file reappearing — there is no function left to call.
const signIn = readFileSync(new URL('../src/components/SignIn.tsx', import.meta.url), 'utf8');
assert.ok(
  !/^\s*import[^\n]*signInDemo/m.test(signIn),
  '/signin must not import the deleted demo module',
);
assert.ok(
  !signIn.includes('accounts.google.com/gsi/client'),
  '/signin must not load Google Identity Services — the backend redirect flow is the only Google path',
);
assert.ok(
  !signIn.includes('atob('),
  '/signin must never decode a credential in the browser; the server verifies it',
);
assert.ok(
  !signIn.includes('window.google'),
  '/signin must not reach for the Google Identity Services global',
);
assert.ok(
  signIn.includes('/api/user/auth/google/start'),
  '/signin must send Google sign-in to the backend redirect endpoint',
);
assert.ok(
  signIn.includes('CheckoutSignIn'),
  '/signin must reuse the real OTP flow rather than reimplementing one',
);

// One session source. App.tsx used to keep a local `guest` name string alongside
// lib/session.ts's Principal, so the two disagreed depending on where you signed in.
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
assert.ok(
  !/const \[guest, setGuest\]/.test(app),
  'App.tsx must not keep a second notion of "signed in" beside lib/session.ts',
);
assert.ok(app.includes('usePrincipal'), 'App.tsx must read the session from lib/session.ts');

// Sign-out has to reach the server; clearing a local variable leaves the refresh cookie live.
const session = readFileSync(new URL('../src/lib/session.ts', import.meta.url), 'utf8');
assert.ok(session.includes("'/auth/logout'"), 'signOut() must call POST /auth/logout');

console.log('Carousel wraparound, real-sign-in and single-session guards passed.');
