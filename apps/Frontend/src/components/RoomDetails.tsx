import { LoadingSkeleton } from './LoadingSkeleton';
import { useRef, useState } from 'react';
import { Link } from 'wouter';
import { ArrowLeft, ArrowUpRight, BedDouble, Users, Maximize, Check, X, ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { formatPaise } from '../lib/money';
import { useResource } from '../lib/useResource';
import type { RoomDetail, RoomListing } from '../lib/types';
import { linesForRoomType, stayLabel, stayNights, type Cart } from '../data/cart';
import { AvailabilityCalendar } from './AvailabilityCalendar';
import { RoomQuantityStepper } from './RoomQuantityStepper';

type Props = {
  slug: string;
  arrival: string;
  departure: string;
  cart: Cart;
  onCart: (cart: Cart) => void;
  onAccount: () => void;
  onAsk: (subject: string) => void;
};

export function RoomDetails({ slug, arrival, departure, cart, onCart, onAccount, onAsk }: Props) {
  const dates = new URLSearchParams({ arrival, departure });
  const back = arrival && departure ? `/book/select?${dates}` : '/#explore-title';
  const [photo, setPhoto] = useState(0);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const lightbox = useRef<HTMLDialogElement>(null);

  const { data: room, loading, error } = useResource<RoomDetail>((signal) => apiFetch(`/rooms/${slug}`, { signal }), [slug]);
  const { data: others } = useResource<{ rooms: RoomListing[] }>((signal) => apiFetch('/rooms', { signal }), []);

  if (loading) return <div className="room-page"><LoadingSkeleton label="Loading room…" variant="detail" /></div>;
  if (error || !room) return <div className="room-page checkout-empty"><h2>We couldn't find that room.</h2><Link className="booking-primary" href="/rooms">Back to all rooms</Link></div>;

  // A stable `const` the closures below can trust — `room` itself is a fresh binding from
  // `useResource` each render, but a nested function's capture of a narrowed `let`-shaped
  // value isn't something TS's control-flow analysis carries across a closure boundary.
  const activeRoom = room;
  const showPhoto = (index: number) => { setPhoto(index); lightbox.current?.showModal(); };
  const totalLines = linesForRoomType(cart, activeRoom.id).length;

  return <div className="room-page">
    <header className="room-header"><Link href="/" className="brand"><span className="brand-mark">qe</span><span>THE QUIET ESTATE<small>CHIKKAMAGALURU</small></span></Link><button className="room-account" onClick={onAccount}>Your account <ArrowUpRight size={15} /></button></header>
    <Link className="room-back" href={back}><ArrowLeft size={16} /> {arrival && departure ? 'Back to room selection' : 'Back to the estate'}</Link>
    <div className="room-heading"><div><span className="room-eyebrow">ROOMS & VILLAS · CHIKKAMAGALURU</span><h1>{room.name}</h1><p>{room.summary}</p></div><span className="room-number">THE QUIET ESTATE</span></div>
    <div className="room-gallery">{room.photos.map((photoItem, index) => <button key={photoItem.alt} className={`room-gallery-photo room-gallery-photo-${index}`} onClick={() => showPhoto(index)} aria-label={`Open ${room.name} photo ${index + 1}`}>
      <img
        src={photoItem.variants[photoItem.variants.length - 1]!.url}
        srcSet={photoItem.variants.map((v) => `${v.url} ${v.w}w`).join(', ')}
        sizes={index === 0 ? '(max-width: 760px) 100vw, 60vw' : '(max-width: 760px) 50vw, 400px'}
        width={photoItem.width} height={photoItem.height}
        alt={photoItem.alt}
        loading={index === 0 ? 'eager' : 'lazy'}
      />
      {index === 0 && <span>View photos <Maximize size={14} /></span>}
    </button>)}</div>
    <div className="room-layout"><div className="room-story">
      <div className="room-facts"><span><Users size={17} /> Up to {room.maxOccupancy} guests</span><span><BedDouble size={18} /> {room.maxAdults} adults · {room.maxChildren} children</span></div>
      <nav className="room-section-nav" aria-label="Room information"><Link href={`/rooms/${room.slug}?${dates}&section=room-about`}>The space</Link><Link href={`/rooms/${room.slug}?${dates}&section=room-features`}>Amenities</Link><Link href={`/rooms/${room.slug}?${dates}&section=room-notes`}>Good to know</Link></nav>
      <section id="room-about"><span className="room-eyebrow">MAKE YOURSELF AT HOME</span><h2>A slower pace starts here.</h2><p>{room.description}</p></section>
      <section id="room-features"><h2>The little essentials.</h2><ul className="room-amenities">{room.amenities.map((item) => <li key={item}><Check size={16} />{item}</li>)}</ul>{room.inclusions.length > 0 && <><h3>Included</h3><ul className="room-amenities">{room.inclusions.map((item) => <li key={item}><Check size={16} />{item}</li>)}</ul></>}</section>
      <section id="room-notes"><h2>Good to know.</h2><details><summary>Planning your arrival</summary><p>Share your expected arrival time with our reservations team. They can help with directions and any special requests.</p></details><details><summary>Rates & your stay</summary><p>Choose your dates to see live availability and the final price, including GST.</p></details><details><summary>Need something specific?</summary><p>Ask our team about accessibility, sleeping arrangements or anything else you need before booking.</p><button className="room-inline-link" onClick={() => onAsk(room.name)}>Chat with reservations <ArrowUpRight size={15} /></button></details></section>
    </div><aside className="room-booking">
      <span className="room-eyebrow">YOUR STAY</span>
      <p className="room-price"><small>From</small>{formatPaise(room.fromPricePaise)}<span> / night</span></p>
      <p className="room-rate-note">GST shown in your checkout total.</p>
      <button type="button" className="room-stay-dates" aria-expanded={calendarOpen} onClick={() => setCalendarOpen((open) => !open)}>
        <CalendarDays size={18} aria-hidden="true" />
        <span><strong>Check availability</strong>{stayNights(arrival, departure) > 0 && <small>{stayLabel(arrival, departure)}</small>}</span>
        <span className="room-date-edit">{calendarOpen ? 'Hide' : 'View'}</span>
      </button>
      {calendarOpen && <AvailabilityCalendar slug={room.slug} checkIn={arrival} checkOut={departure} />}
      {stayNights(arrival, departure) > 0 && <div className="room-booking-quantity"><span>Rooms<small>{stayNights(arrival, departure)} nights</small></span><RoomQuantityStepper room={{ roomTypeId: room.id, slug: room.slug, name: room.name, pricePaise: room.fromPricePaise }} cart={cart} onCart={onCart} /></div>}
      {totalLines > 0 && <Link className="booking-primary room-booking-continue" href={`/checkout?${dates}`}>Review your stay <ArrowUpRight size={16} /></Link>}
      {!stayNights(arrival, departure) && <Link className="booking-primary room-booking-continue" href="/">Choose stay dates <ArrowUpRight size={16} /></Link>}
      <button className="room-booking-question" onClick={() => onAsk(room.name)}>Ask about this room <ArrowUpRight size={14} /></button>
    </aside></div>
    {others && <section className="room-more"><div><span className="room-eyebrow">FIND YOUR KIND OF QUIET</span><h2>A different way to stay.</h2></div><div className="room-more-grid">{others.rooms.filter((item) => item.slug !== room.slug).slice(0, 3).map((item) => <Link href={`/rooms/${item.slug}?${dates}`} key={item.slug}>{item.coverPhoto && <img src={item.coverPhoto.variants[0]!.url} srcSet={item.coverPhoto.variants.map((v) => `${v.url} ${v.w}w`).join(', ')} sizes="(max-width: 760px) 100vw, 400px" width={item.coverPhoto.width} height={item.coverPhoto.height} alt={item.coverPhoto.alt} loading="lazy" />}<span>{item.name}<ArrowUpRight size={17} /></span><small>{item.summary}</small></Link>)}</div></section>}
    <footer className="room-footer"><span>THE QUIET ESTATE</span><Link href="/">Back to the estate <ArrowUpRight size={15} /></Link></footer>
    <dialog ref={lightbox} className="estate-lightbox room-lightbox" aria-label={`${room.name} gallery`} onClick={(event) => { if (event.target === lightbox.current) lightbox.current.close(); }} onKeyDown={(event) => { if (event.key === 'ArrowRight') setPhoto((photo + 1) % room.photos.length); if (event.key === 'ArrowLeft') setPhoto((photo + room.photos.length - 1) % room.photos.length); }}><button className="lightbox-close" aria-label="Close gallery" onClick={() => lightbox.current?.close()}><X size={20} /></button><img src={room.photos[photo]!.variants[room.photos[photo]!.variants.length - 1]!.url} alt={`${room.name} photo ${photo + 1}`} /><div className="room-lightbox-controls"><button aria-label="Previous photo" onClick={() => setPhoto((photo + room.photos.length - 1) % room.photos.length)}><ChevronLeft size={20} /></button><span aria-live="polite">{photo + 1} / {room.photos.length}</span><button aria-label="Next photo" onClick={() => setPhoto((photo + 1) % room.photos.length)}><ChevronRight size={20} /></button></div></dialog>
  </div>;
}
