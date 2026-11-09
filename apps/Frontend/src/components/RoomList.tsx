import { LoadingSkeleton } from './LoadingSkeleton';
import { Link } from 'wouter';
import { ArrowUpRight } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { formatPaise } from '../lib/money';
import { useResource } from '../lib/useResource';
import type { RoomListing } from '../lib/types';

/** `/rooms` — §8B's room-and-availability browse, which this app never had before (rooms only
 * existed inside the booking accordion at `/book/select`). Prices shown here are explicitly
 * "from" prices (§8B: never presented as a stay quote) — the real price lives behind dates.
 * Card layout matches `.room-more-grid` on the room-detail page (proven, already shipped),
 * not a new invented card shape. */
export function RoomList() {
  const { data, loading, error, refetch } = useResource<{ rooms: RoomListing[] }>((signal) => apiFetch('/rooms', { signal }), []);

  return <div className="booking-page room-list-page">
    <header className="booking-header"><Link href="/" className="booking-wordmark">THE QUIET ESTATE</Link></header>
    <div className="selection-heading">
      <span className="room-eyebrow">ROOMS &amp; VILLAS</span>
      <h1>Find your kind of stay.</h1>
      <p>Every room and villa on the estate. Prices shown are from a base rate — choose your dates for a final price.</p>
    </div>
    {loading && <LoadingSkeleton label="Loading rooms…" variant="cards" />}
    {error && <p role="alert">Couldn't load the room list. <button type="button" className="room-inline-link" onClick={refetch}>Try again</button></p>}
    {data && <div className="room-list-grid">
      {data.rooms.map((room) => <Link href={`/rooms/${room.slug}`} key={room.id}>
        {room.coverPhoto && <img
          src={room.coverPhoto.variants[room.coverPhoto.variants.length - 1]!.url}
          srcSet={room.coverPhoto.variants.map((v) => `${v.url} ${v.w}w`).join(', ')}
          sizes="(max-width: 760px) 50vw, 33vw"
          width={room.coverPhoto.width}
          height={room.coverPhoto.height}
          alt={room.coverPhoto.alt}
          loading="lazy"
        />}
        <span>{room.name}<ArrowUpRight size={17} /></span>
        <small>From {formatPaise(room.fromPricePaise)} / night</small>
      </Link>)}
    </div>}
  </div>;
}
