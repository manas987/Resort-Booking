import { Minus, Plus } from 'lucide-react';
import { addLine, linesForRoomType, removeLine, MAX_ROOMS_PER_BOOKING, type Cart } from '../data/cart';

type Props = {
  room: { roomTypeId: string; slug: string; name: string; pricePaise: number };
  cart: Cart;
  onCart: (cart: Cart) => void;
  remaining?: number; // from GET /availability — undefined when no dates chosen yet
  disabled?: boolean;
};

/** One room type, one "- N +" pill — no occupancy editing here. Every added line defaults to
 * 1 adult / 0 children (`addLine` in `data/cart.ts`); adults/children is decided at checkout,
 * not on the browse/select screens — kept minimal per the user's explicit ask. */
export function RoomQuantityStepper({ room, cart, onCart, remaining, disabled = false }: Props) {
  const count = linesForRoomType(cart, room.roomTypeId).length;
  const atCap = cart.length >= MAX_ROOMS_PER_BOOKING || (remaining !== undefined && count >= remaining);
  return <div className="quantity-control" aria-label={`${room.name} quantity`}>
    <button type="button" aria-label={`Remove one ${room.name}`} disabled={disabled || count === 0} onClick={() => {
      const [last] = linesForRoomType(cart, room.roomTypeId).slice(-1);
      if (last) onCart(removeLine(cart, last.lineId));
    }}><Minus size={14} /></button>
    <output aria-live="polite">{count}</output>
    <button type="button" aria-label={`Add one ${room.name}`} disabled={disabled || atCap} onClick={() => onCart(addLine(cart, room))}><Plus size={14} /></button>
  </div>;
}
