import { useState } from 'react';
import { ArrowUpRight, MapPin, Star, Expand, Shrink } from 'lucide-react';
import { EstateMap } from './EstateMap';

const reviews = [
  { name: 'Guest A', quote: 'A lovely place to slow down. We woke up to greenery and took our time over coffee.' },
  { name: 'Guest B', quote: 'The kind of stay that makes you want to put your phone away and enjoy the quiet.' },
  { name: 'Guest C', quote: 'A beautiful setting for time together. The hills made the whole trip feel special.' },
];

export function GuestReviews() {
  const [expanded, setExpanded] = useState(false);
  return <section className="guest-reviews" aria-labelledby="reviews-title">
    <div className="reviews-heading"><div><span className="welcome-label">WORDS & PLACES</span><h2 id="reviews-title">Good things happen<br />when you slow down.</h2></div><p>Find us in coffee country, and see what a stay here can feel like.</p></div>
    <div className={`reviews-layout ${expanded ? 'map-is-expanded' : ''}`}>
      <div className="estate-map-panel">
        <div className="estate-map-frame">
          <EstateMap />
          <button className="map-expand" aria-expanded={expanded} aria-label={expanded ? 'Make map smaller' : 'Expand map'} onClick={() => setExpanded(!expanded)}>{expanded ? <Shrink size={17} /> : <Expand size={17} />}<span>{expanded ? 'Close map' : 'Expand map'}</span></button>
          <div className="map-area-label"><MapPin size={16} /><span>Chikkamagaluru<small>Karnataka, India</small></span></div>
        </div>
        <div className="map-details"><div><p>The hills of Chikkamagaluru.</p><small>Area shown; exact estate address to be confirmed.</small></div><a href="https://www.google.com/maps/search/?api=1&query=Chikkamagaluru%2C+Karnataka" target="_blank" rel="noreferrer">Open in Google Maps <ArrowUpRight size={16} /></a></div>
      </div>
      <div className="reviews-side"><div className="reviews-side-heading"><div><span className="room-eyebrow">WORDS FROM GUESTS</span><h3>Stays worth remembering.</h3></div></div>
        <div className="review-list">{reviews.map((review) => <article className="review-card" key={review.name}><div className="review-card-top"><span className="review-avatar">{review.name.slice(-1)}</span><div><strong>{review.name}</strong></div><div className="review-stars" aria-label="5 out of 5 stars">{Array.from({ length: 5 }, (_, i) => <Star key={i} size={12} fill="currentColor" strokeWidth={1.3} aria-hidden="true" />)}</div></div><p>“{review.quote}”</p></article>)}</div>
      </div>
    </div>
  </section>;
}

export function ClosingSection({ onChat, onBook }: { onChat: () => void; onBook: () => void }) {
  return <footer className="estate-footer">
    <div className="footer-invitation">
      <div><span className="footer-kicker">A LITTLE CLOSER TO QUIET</span><h2>Whenever you’re ready.</h2><p>The hills are waiting. Come find a little time for yourself.</p></div>
      <div className="footer-actions"><button className="footer-book" onClick={onBook}>Book your stay <ArrowUpRight size={17} /></button><button className="footer-chat" onClick={onChat}>Talk to us <ArrowUpRight size={16} /></button></div>
    </div>
    <div className="footer-bottom">
      <a className="footer-brand" href="#"><span className="footer-monogram">qe</span><span>THE QUIET ESTATE<small>CHIKKAMAGALURU</small></span></a>
      <nav className="footer-nav" aria-label="Footer navigation"><a href="#welcome-title">The estate</a><a href="#explore-title">Stays & gatherings</a><a href="#reviews-title">Reviews</a></nav>
      <div className="footer-location"><a href="tel:+910000000000">+91 00000 00000</a><a href="mailto:hello@quietestate.example">hello@quietestate.example</a><small>Chikkamagaluru, Karnataka</small></div>
    </div>
  </footer>;
}
