import { useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight } from 'lucide-react';
import { photoUrl, photoSrcSet } from '../lib/photoUrl';

import { stops, slideOffset } from '../data/tour';

export function PropertyTour({ onEnquire }: { onEnquire: () => void }) {
  const [{ active, direction }, setSlide] = useState({ active: 0, direction: 1 });
  const touch = useRef<number | null>(null);
  const current = stops[active];
  function move(by: number) { setSlide((state) => ({ active: (state.active + by + stops.length) % stops.length, direction: by })); }
  function choose(index: number) { setSlide((state) => index === state.active ? state : ({ active: index, direction: index > state.active ? 1 : -1 })); }
  return <section className="property-tour" aria-labelledby="tour-title" aria-roledescription="carousel">
    <div className="tour-intro"><span className="welcome-label">TAKE A LOOK AROUND</span><h2 id="tour-title">A feel for the estate.</h2></div>
    <div className="tour-layout">
      <div className="tour-visual" tabIndex={0} aria-label="Property tour photos. Use left and right arrow keys to explore." onKeyDown={(event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); move(event.key === 'ArrowLeft' ? -1 : 1); } }} onTouchStart={(event) => { touch.current = event.touches[0].clientX; }} onTouchEnd={(event) => { if (touch.current !== null) { const delta = touch.current - event.changedTouches[0].clientX; if (Math.abs(delta) > 45) move(delta > 0 ? 1 : -1); touch.current = null; } }}>
        <div className="tour-ambient" aria-hidden="true" style={{ backgroundImage: `url(${photoUrl(current.photo, 300)})` }} />
        <div className="tour-deck">
          {stops.map((stop, index) => {
            const offset = slideOffset(index, active, stops.length);
            return <div key={stop.title} className={`tour-slide ${index === active ? 'is-active' : ''}`} aria-hidden={index !== active} style={{ transform: `translateX(${offset * 105}%) scale(${index === active ? 1 : .94}) rotate(${offset * 4}deg)`, opacity: index === active ? 1 : 0, zIndex: index === active ? 2 : 1 }}>
              <img src={photoUrl(stop.photo, 960)} srcSet={photoSrcSet(stop.photo, [640, 960, 1280])} sizes="(max-width: 760px) 100vw, 50vw" alt={stop.title} loading="lazy" />
            </div>;
          })}
        </div>
        <button className="tour-photo-arrow tour-photo-prev" aria-label="Previous tour photo" onClick={() => move(-1)}><ArrowLeft size={18} /></button><button className="tour-photo-arrow tour-photo-next" aria-label="Next tour photo" onClick={() => move(1)}><ArrowRight size={18} /></button>
        <span className="tour-photo-counter" aria-hidden="true">0{active + 1} / 0{stops.length}</span>
      </div>
      <div className="tour-information">
        <div className="tour-copy" key={active} style={{ '--tour-direction': direction } as React.CSSProperties} aria-live="polite" aria-atomic="true"><span className="room-eyebrow">{current.eyebrow}</span><h3>{current.title}</h3><p>{current.description}</p><div className="tour-tags">{current.tags.map((tag) => <span key={tag}>{tag}</span>)}</div></div>
        <div className="tour-bottom"><div className="tour-dots" aria-label="Choose a property stop">{stops.map((stop, index) => <button key={stop.title} aria-label={`Show ${stop.title}`} aria-pressed={index === active} onClick={() => choose(index)} />)}</div><button className="room-inline-link" onClick={onEnquire}>Ask us about the estate <ArrowUpRight size={16} /></button></div>
      </div>
    </div>
  </section>;
}
