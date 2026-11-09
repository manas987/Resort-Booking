import { LoadingSkeleton } from './LoadingSkeleton';
import { Link } from 'wouter';
import { ArrowUpRight, ShoppingBag } from 'lucide-react';
import { ImageAccordion, type AccordionRoom } from './bencho/ImageAccordion';
import { RoomQuantityStepper } from './RoomQuantityStepper';
import { apiFetch } from '../lib/api';
import { formatPaise } from '../lib/money';
import { useResource } from '../lib/useResource';
import type { AvailabilityResponse, RoomListing } from '../lib/types';
import { stayLabel, stayNights, type Cart } from '../data/cart';

type Props = { arrival: string; departure: string; cart: Cart; onCart: (cart: Cart) => void };

/** `/book/select` — §8B's multi-room, multi-type selection. Per-room "N left" badges come
 * from `GET /availability` (one number for the whole stay, not per-date — that's the
 * `/rooms/:slug` calendar's job). Just a quantity pill per room type, kept minimal — no
 * occupancy editing on this screen (`RoomQuantityStepper`). */
export function RoomSelection({ arrival, departure, cart, onCart }: Props) {
  const dates = new URLSearchParams({ arrival, departure });
  const nights = stayNights(arrival, departure);
  const { data: rooms, loading: roomsLoading, error: roomsError, refetch: refetchRooms } = useResource<{ rooms: RoomListing[] }>(
    (signal) => apiFetch('/rooms', { signal }),
    [],
  );
  const {
    data: availability,
    error: availabilityError,
    refetch: refetchAvailability,
  } = useResource<AvailabilityResponse>(
    (signal) => (nights ? apiFetch(`/availability?checkIn=${arrival.slice(0, 10)}&checkOut=${departure.slice(0, 10)}&rooms=1`, { signal }) : Promise.resolve(null as unknown as AvailabilityResponse)),
    [arrival, departure, nights],
  );
  const remainingByRoom = new Map((availability?.rooms ?? []).map((r) => [r.roomTypeId, r]));
  const count = cart.length;

  return <div className="booking-page selection-page">
    <header className="booking-header"><Link href="/" className="booking-wordmark">THE QUIET ESTATE</Link><Link href="/">Change dates <ArrowUpRight size={14} /></Link></header>
    <div className="selection-heading"><span className="room-eyebrow">MAKE ROOM FOR QUIET</span><h1>Find your kind of stay.</h1><p>Explore a space. Add your favourites. Make yourself at home.</p><span className="booking-dates">{stayLabel(arrival, departure)}<span>·</span>{nights} nights</span></div>
    {!nights ? <div className="checkout-empty"><p>Choose your stay dates to explore rooms.</p><Link className="booking-primary" href="/">Choose dates <ArrowUpRight size={16} /></Link></div>
      : roomsLoading ? <LoadingSkeleton label="Loading rooms…" variant="cards" />
      : roomsError ? <p role="alert">Couldn't load rooms. <button type="button" className="room-inline-link" onClick={refetchRooms}>Try again</button></p>
      : rooms && <>
        {availabilityError && <p role="alert" className="signin-error">
          We couldn't check availability for these dates just now, so the counts below are
          unavailable. You can still choose rooms — we'll confirm availability before payment.{' '}
          <button type="button" className="room-inline-link" onClick={refetchAvailability}>Check again</button>
        </p>}
        <ImageAccordion
          roomHref={(room) => `/rooms/${room.slug}?${dates}`}
          rooms={rooms.rooms.map((room): AccordionRoom => ({ slug: room.slug, name: room.name, coverPhotoUrl: room.coverPhoto?.variants[room.coverPhoto.variants.length - 1]?.url ?? '' }))}
          renderActions={(accordionRoom) => {
            const room = rooms.rooms.find((r) => r.slug === accordionRoom.slug)!;
            const avail = remainingByRoom.get(room.id);
            const soldOut = avail ? !avail.available : false;
            return <>
              <p className="acc-note">{room.summary}</p>
              <p className="acc-availability" aria-live="polite">
                {availabilityError
                  ? 'Availability not checked'
                  : avail?.reason === 'occupancy'
                    ? 'Not suitable for your party size'
                    : soldOut
                      ? 'Sold out for these dates'
                      : avail
                        ? `${avail.remaining} left for your dates`
                        : ''}
              </p>
              <div className="acc-bottom">
                <span>{formatPaise(room.fromPricePaise)}<small> / night</small></span>
                <div className="acc-actions">
                  <Link href={`/rooms/${room.slug}?${dates}`}>View details <ArrowUpRight size={14} /></Link>
                  <RoomQuantityStepper room={{ roomTypeId: room.id, slug: room.slug, name: room.name, pricePaise: room.fromPricePaise }} cart={cart} onCart={onCart} remaining={!avail ? undefined : avail.reason === 'occupancy' ? 0 : avail.remaining} />
                </div>
              </div>
            </>;
          }}
        />
      </>}
    <div className="selection-footnote"><span>Rooms & villas, at your pace.</span><span aria-live="polite">{count ? `${count} ${count === 1 ? 'room' : 'rooms'} selected` : 'Select a space to begin'}</span></div>
    <Link className="checkout-float" href={`/checkout?${dates}`}><ShoppingBag size={17} />Checkout<span>{count}</span><ArrowUpRight size={16} /></Link>
  </div>;
}
