import { strict as assert } from 'node:assert';
import { scrollToBooking } from '../src/lib/scrollToBooking';

let listener: (() => void) | undefined;
let opened = 0;
let behavior = '';
let reduced = false;
const browser = {
  scrollY: 800,
  addEventListener: (_: string, callback: () => void) => { listener = callback; },
  removeEventListener: () => { listener = undefined; },
  matchMedia: () => ({ matches: reduced }),
  scrollTo: (options: ScrollToOptions) => { behavior = options.behavior!; },
};
Object.defineProperty(globalThis, 'window', { value: browser, configurable: true });
scrollToBooking(() => opened++);
assert.equal(behavior, 'smooth');
listener?.();
assert.equal(opened, 0);
browser.scrollY = 0;
listener?.();
assert.equal(opened, 1);
assert.equal(listener, undefined);
scrollToBooking(() => opened++);
assert.equal(opened, 2);
browser.scrollY = 500;
reduced = true;
const cancel = scrollToBooking(() => opened++);
assert.equal(behavior, 'instant');
cancel();
assert.equal(listener, undefined);
assert.equal(opened, 2);
console.log('Calendar opens on arrival, including already-at-top; cleanup and reduced motion pass.');
