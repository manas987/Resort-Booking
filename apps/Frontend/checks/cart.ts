import { strict as assert } from 'node:assert';
import { addLine, removeLine, updateOccupancy, linesForRoomType, toQuoteLineItems, fitsOccupancy, stayNights, stayLabel, MAX_ROOMS_PER_BOOKING, type Cart } from '../src/data/cart';

const estateRoom = { roomTypeId: 'room-1', slug: 'estate-room', name: 'Estate Room', pricePaise: 580000 };
const gardenSuite = { roomTypeId: 'room-2', slug: 'garden-suite', name: 'Garden Suite', pricePaise: 720000 };

let cart: Cart = [];
cart = addLine(cart, estateRoom);
cart = addLine(cart, gardenSuite);
assert.equal(cart.length, 2);
assert.equal(linesForRoomType(cart, 'room-1').length, 1);

// A line is one physical room, not a quantity — adding the same type again is a second line.
cart = addLine(cart, estateRoom);
assert.equal(linesForRoomType(cart, 'room-1').length, 2);
assert.equal(cart.length, 3);

// Capped at MAX_ROOMS_PER_BOOKING (mirrors apps/Backend/src/core/policy.ts).
assert.equal(MAX_ROOMS_PER_BOOKING, 4);
cart = addLine(cart, gardenSuite);
assert.equal(cart.length, 4);
const atCap = addLine(cart, gardenSuite);
assert.equal(atCap.length, 4); // refused — already at the cap
assert.deepEqual(atCap, cart);

// Occupancy edits, with invalid values rejected rather than silently clamped.
const [firstLine] = linesForRoomType(cart, 'room-1');
cart = updateOccupancy(cart, firstLine!.lineId, { adults: 2, children: 1 });
assert.deepEqual(linesForRoomType(cart, 'room-1')[0], { ...firstLine!, adults: 2, children: 1 });
const unchanged = updateOccupancy(cart, firstLine!.lineId, { adults: 0 }); // below minAdultsPerRoom
assert.deepEqual(unchanged, cart);
assert.equal(fitsOccupancy(2, 1, { maxAdults: 2, maxChildren: 1, maxOccupancy: 3 }), true);
assert.equal(fitsOccupancy(3, 1, { maxAdults: 2, maxChildren: 1, maxOccupancy: 3 }), false); // over maxAdults
assert.equal(fitsOccupancy(2, 2, { maxAdults: 2, maxChildren: 1, maxOccupancy: 3 }), false); // over maxChildren
assert.equal(fitsOccupancy(0, 0, { maxAdults: 2, maxChildren: 1, maxOccupancy: 3 }), false); // below minAdultsPerRoom

// The wire shape for POST /quotes strips lineId/slug/name/pricePaise.
assert.deepEqual(toQuoteLineItems([{ lineId: 'x', roomTypeId: 'r', slug: 's', name: 'n', pricePaise: 1, adults: 2, children: 1 }]), [{ roomTypeId: 'r', adults: 2, children: 1 }]);

cart = removeLine(cart, firstLine!.lineId);
assert.equal(linesForRoomType(cart, 'room-1').length, 1);

assert.equal(stayNights('2026-11-12T10:00:00+05:30', '2026-11-19T22:00:00+05:30'), 7);
assert.equal(stayNights('invalid', 'invalid'), 0);
assert.equal(stayNights('2026-11-19', '2026-11-12'), 0);
assert.equal(stayLabel('', ''), 'Choose your dates');

console.log('Cart line add/remove/cap, occupancy validation and the quote wire-shape mapping pass.');
