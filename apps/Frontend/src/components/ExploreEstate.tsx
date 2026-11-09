import { LoadingSkeleton } from './LoadingSkeleton';
import { useRef, useState } from 'react';
import { Link } from 'wouter';
import { BedDouble, House, Flower2, Users, ArrowUpRight, X } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useResource } from '../lib/useResource';
import type { RoomListing } from '../lib/types';
import { photoUrl, photoSrcSet } from '../lib/photoUrl';

const categories = [
  { name: 'Rooms', icon: BedDouble, title: 'A room to make your own.', description: 'Find your place to pause at the coffee estate.', action: 'Plan your stay', photos: ['photo-1611892440504-42a792e24d32', 'photo-1618773928121-c32242e63f39', 'photo-1449158743715-0a90ebb6d2d8'], captions: ['Settle in', 'Slow mornings', 'Close to nature'] },
  { name: 'Villas', icon: House, title: 'A little space of your own.', description: 'Discover the villas at our Chikkamagaluru estate.', action: 'Plan your stay', photos: ['photo-1510798831971-661eb04b3739', 'photo-1449844908441-8829872d2607', 'photo-1441974231531-c6227db76b6e'], captions: ['Your own retreat', 'Stay a while', 'Surrounded by green'] },
  { name: 'Weddings', icon: Flower2, title: 'Together, somewhere special.', description: 'Bring your wedding plans to the estate lawns. Tell us your dates and guest count to begin.', action: 'Enquire about a wedding', photos: ['photo-1519741497674-611481863552', 'photo-1519225421980-715cb0215aed', 'photo-1511795409834-ef04bbd61622'], captions: ['The celebration', 'The details', 'Time together'] },
  { name: 'Offsites', icon: Users, title: 'A fresh setting for your team.', description: 'Take the next team gathering to the hills. Share your dates and group size with us.', action: 'Enquire about an offsite', photos: ['photo-1522071820081-009f0129c71c', 'photo-1517048676732-d65bc937f952', 'photo-1500530855697-b586d89ba3ee'], captions: ['Come together', 'Fresh conversations', 'A change of scenery'] },
];

export function ExploreEstate({ onChoose }: { onChoose: (category: string) => void }) {
  const [active, setActive] = useState(0);
  const [photo, setPhoto] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const category = categories[active];
  // Rooms/Villas tabs show the seeded catalogue (4 room types, sort_order ordered) — the first
  // 3 as "Rooms", the last as "Villas", matching the original static split by position.
  const { data, loading, error, refetch } = useResource<{ rooms: RoomListing[] }>(
    (signal) => apiFetch('/rooms', { signal }),
    [],
  );
  const rooms = data?.rooms ?? [];
  // The Rooms/Villas tabs are API-driven, so they need all three states. Discarding `loading`
  // and `error` rendered an empty grid on failure, which is the blank screen
  // Docs/13-frontend-structure.md rules out — EstateMap.tsx's placeholder → ready → fallback is
  // the pattern being followed here.
  const catalogueTab = category.name === 'Rooms' || category.name === 'Villas';

  return (
    <section className="explore-estate" aria-labelledby="explore-title">
      <span className="welcome-label">YOUR KIND OF ESCAPE</span>
      <h2 id="explore-title">Space to stay.<br />Room to celebrate.</h2>
      <div className="estate-tabs" role="tablist" aria-label="Explore the estate">
        {categories.map(({ name, icon: Icon }, index) => <button key={name} type="button" role="tab" id={`estate-tab-${index}`} aria-selected={active === index} aria-controls="estate-panel" tabIndex={active === index ? 0 : -1} onClick={() => setActive(index)} onKeyDown={(event) => {
          let next: number;
          if (event.key === 'ArrowRight') next = (index + 1) % categories.length;
          else if (event.key === 'ArrowLeft') next = (index + categories.length - 1) % categories.length;
          else if (event.key === 'Home') next = 0;
          else if (event.key === 'End') next = categories.length - 1;
          else return;
          event.preventDefault(); setActive(next); document.getElementById(`estate-tab-${next}`)?.focus();
        }}><span className="estate-tab-icon"><Icon size={23} strokeWidth={1.3} aria-hidden="true" /></span><span>{name}</span></button>)}
      </div>
      <div id="estate-panel" role="tabpanel" aria-labelledby={`estate-tab-${active}`}>
        <div className="estate-photos" key={category.name}>
          {catalogueTab && loading
            ? <LoadingSkeleton label="Loading rooms…" variant="cards" />
            : catalogueTab && error
            ? <p role="alert" className="estate-photos-status">
                Couldn't load the room list.{' '}
                <button type="button" className="room-inline-link" onClick={refetch}>Try again</button>
              </p>
            : catalogueTab && rooms.length === 0
            ? <p className="estate-photos-status">No rooms are published right now.</p>
            : catalogueTab
            ? (category.name === 'Rooms' ? rooms.slice(0, 3) : rooms.slice(3)).map((room) => <Link className="estate-photo" href={`/rooms/${room.slug}`} key={room.slug}>{room.coverPhoto && <img src={room.coverPhoto.variants[1]?.url ?? room.coverPhoto.variants[0]!.url} alt={room.name} loading="lazy" />}<span className="estate-photo-caption">{room.name}<ArrowUpRight size={18} aria-hidden="true" /></span></Link>)
            : category.photos.map((id, index) => <button className="estate-photo" key={id} type="button" aria-label={`View ${category.name.toLowerCase()}: ${category.captions[index]}`} onClick={() => { setPhoto(index); dialog.current?.showModal(); }}><img src={photoUrl(id, 640)} srcSet={photoSrcSet(id, [640, 960, 1280])} sizes="(max-width: 760px) 50vw, 33vw" alt={category.captions[index]} loading="lazy" /><span className="estate-photo-caption">{category.captions[index]}<ArrowUpRight size={18} aria-hidden="true" /></span></button>)}
        </div>
        <div className="estate-detail"><div><h3>{category.title}</h3><p>{category.description}</p></div><button className="estate-action" onClick={() => onChoose(category.name)}>{category.action}<ArrowUpRight size={17} aria-hidden="true" /></button></div>
      </div>
      <dialog className="estate-lightbox" ref={dialog} onClick={(event) => { if (event.target === dialog.current) dialog.current.close(); }} aria-label={`${category.name} photo preview`}><button className="lightbox-close" aria-label="Close photo" onClick={() => dialog.current?.close()}><X size={20} /></button><img src={photoUrl(category.photos[photo], 1280)} srcSet={photoSrcSet(category.photos[photo])} sizes="100vw" alt={category.captions[photo]} /><p>{category.captions[photo]}</p></dialog>
    </section>
  );
}
