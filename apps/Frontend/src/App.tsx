import { LoadingSkeleton } from './components/LoadingSkeleton';
import { lazy, Suspense, useEffect, useRef, useState, type Ref } from 'react';
import { Link, Route, Switch, useLocation, useSearchParams } from 'wouter';
import { RoomSelection } from './components/BookingPages';
import { restoreCart, type Cart } from './data/cart';
import { SignIn } from './components/SignIn';
import { RoomDetails } from './components/RoomDetails';
import { RoomList } from './components/RoomList';
import { Checkout } from './components/Checkout';
import { BookingConfirmation } from './components/BookingConfirmation';
import { PropertyTour } from './components/PropertyTour';
import { GuestReviews, ClosingSection } from './components/GuestReviews';
import { ExploreEstate } from './components/ExploreEstate';
import { ResortInfo } from './components/ResortInfo';
import { scrollToBooking } from './lib/scrollToBooking';
import { photoUrl, photoSrcSet } from './lib/photoUrl';
import { apiFetch } from './lib/api';
import { setSession, usePrincipal, signOut } from './lib/session';
import { SearchCapsule, type SearchCapsuleHandle } from './components/retro-pill/components/SearchCapsule';
import './components/retro-pill/styles.css';

type Panel = 'chat' | 'account';

/** Kept next to the preload hint in index.html — if one changes the other has to. */
const HERO_PHOTO_ID = 'photo-1449158743715-0a90ebb6d2d8';

/** `GET /auth/google/callback` redirects here with `#accessToken=<jwt>` (redirect-only — see
 * Docs/14-frontend-api-map.md). The fragment never reaches the server, so this is the one
 * place it is read. */
function AuthCallback({ onSignedIn }: { onSignedIn: () => void }) {
  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get('accessToken');
    if (token) {
      // The principal isn't in the fragment; GET /auth/me fills it in right after.
      import('./lib/api').then(({ apiFetch }) =>
        apiFetch<{ principal: Parameters<typeof setSession>[0]['principal'] }>('/auth/me')
          .then(({ principal }) => setSession({ accessToken: token, principal }))
          .finally(onSignedIn),
      );
    } else onSignedIn();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once, reads the fragment at mount
  }, []);
  return <LoadingSkeleton label="Signing you in…" variant="text" />;
}

function NotFound() {
  return <div className="booking-page checkout-empty"><h2>That page moved.</h2><Link className="booking-primary" href="/">Back to the estate</Link></div>;
}

function Home({ arrival, departure, calendarRef, onPlanStay, onBook, onAccount, onAsk }: {
  arrival: string; departure: string; calendarRef: Ref<SearchCapsuleHandle>;
  onPlanStay: () => void; onBook: (from: string, to: string) => void;
  onAccount: () => void; onAsk: (category: string) => void;
}) {
  return <>
    <section className="hero" aria-labelledby="hero-title">
      <img
        className="hero-photo"
        src={photoUrl(HERO_PHOTO_ID, 1280)}
        srcSet={photoSrcSet(HERO_PHOTO_ID)}
        sizes="100vw"
        width={1280}
        height={853}
        alt="A quiet woodland retreat surrounded by tall green trees"
        fetchPriority="high"
      />
      <div className="hero-shade" />
      <header className="header">
        <Link className="brand" href="/" aria-label="The Quiet Estate home"><span className="brand-mark">qe</span><span>THE QUIET ESTATE<small>CHIKKAMAGALURU</small></span></Link>
        <nav aria-label="Main navigation"><button className="account-button" aria-label="Your account" onClick={onAccount}><span className="person-icon" aria-hidden="true" /></button></nav>
      </header>

      <div className="hero-copy">
        <a href="#reviews-title" className="guest-badge"><span className="guest-faces" aria-hidden="true"><img src="https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&w=48&h=48&q=70" alt="" /><img src="https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=48&h=48&q=70" alt="" /><img src="https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=48&h=48&q=70" alt="" /></span><span>Loved by our guests</span></a>
        <h1 id="hero-title">A slower kind of stay.</h1>
        <div className="retro-pill-host">
          <SearchCapsule ref={calendarRef} initial={{ pickupAt: arrival, returnAt: departure }} onSearch={(value) => onBook(value.pickupAt, value.returnAt)} />
        </div>
        <p className="hero-description">Your quiet corner of Chikkamagaluru.</p>
      </div>
    </section>
    <section className="welcome" aria-labelledby="welcome-title">
      <div className="welcome-intro">
        <span className="welcome-label">THE ESTATE</span>
        <h2 id="welcome-title">A little closer to quiet.</h2>
        <p>In the hills of Chikkamagaluru, find room to slow down and stay a while.</p>
      </div>
      <div className="welcome-gallery" aria-label="A glimpse of the estate">
          <figure tabIndex={0}><img src="https://images.unsplash.com/photo-1449158743715-0a90ebb6d2d8?auto=format&fit=crop&w=600&q=75" alt="A cabin tucked among trees" loading="lazy" /><figcaption>Find your quiet</figcaption></figure>
          <figure tabIndex={0}><img src="https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=600&q=75" alt="Sunlight falling through a forest" loading="lazy" /><figcaption>Into the green</figcaption></figure>
          <figure tabIndex={0}><img src="https://images.unsplash.com/photo-1449844908441-8829872d2607?auto=format&fit=crop&w=600&q=75" alt="A quiet retreat surrounded by greenery" loading="lazy" /><figcaption>Stay a little longer</figcaption></figure>
          <figure tabIndex={0}><img src="https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=600&q=75" alt="A mountain landscape in soft light" loading="lazy" /><figcaption>Take it all in</figcaption></figure>
          <figure tabIndex={0}><img src="https://images.unsplash.com/photo-1510798831971-661eb04b3739?auto=format&fit=crop&w=600&q=75" alt="A cosy woodland cabin" loading="lazy" /><figcaption>Slow mornings</figcaption></figure>
          <figure tabIndex={0}><img src="https://images.unsplash.com/photo-1442512595331-e89e73853f31?auto=format&fit=crop&w=600&q=75" alt="Freshly brewed coffee" loading="lazy" /><figcaption>Time for coffee</figcaption></figure>
      </div>
    </section>
    <ExploreEstate onChoose={(category) => {
      if (category === 'Rooms' || category === 'Villas') onPlanStay();
      else onAsk(category === 'Weddings' ? 'a wedding' : 'a team offsite');
    }} />
    <PropertyTour onEnquire={() => onAsk('the estate, generally')} />
    <ResortInfo />
    <GuestReviews />
    <ClosingSection onBook={onPlanStay} onChat={() => onAsk('')} />
  </>;
}

function GuestApp() {
  const [location, navigate] = useLocation();
  const [search] = useSearchParams();
  const isCheckout = location === '/checkout';
  const isRoomSelection = location === '/book/select';
  const isRoomList = location === '/rooms';
  const isRoomDetail = location.startsWith('/rooms/');
  const isBookingConfirmation = location.startsWith('/booking/');
  // No <Switch>/<Route> here (this branch is plain boolean dispatch, not wouter matching), so
  // the slug/id is read straight off `location` rather than via `useParams()` — that hook
  // only resolves inside an actual matched <Route>, and rendering a page outside one is
  // exactly what made every room 404 against `/rooms/undefined` until that was fixed here.
  const roomSlug = isRoomDetail ? location.slice('/rooms/'.length) : '';
  const bookingId = isBookingConfirmation ? location.slice('/booking/'.length) : '';
  const isSignIn = location === '/signin';
  const isAuthCallback = location === '/auth/callback';
  const isEvents = location === '/events';
  const accountTab = location === '/account/bookings' ? 'bookings'
    : location === '/account/enquiries' ? 'enquiries'
    : location === '/account/profile' ? 'profile'
    : null;
  const calendar = useRef<SearchCapsuleHandle>(null);
  const stopBookingScroll = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => stopBookingScroll.current?.(), [location]);
  useEffect(() => {
    document.title = isCheckout ? 'Review your stay — The Quiet Estate' : isBookingConfirmation ? 'Your booking — The Quiet Estate' : isRoomSelection ? 'Choose your room — The Quiet Estate' : isRoomList ? 'Rooms & villas — The Quiet Estate' : isSignIn ? 'Sign in — The Quiet Estate' : 'The Quiet Estate — Chikkamagaluru';
    const section = search.get('section');
    if (isSignIn || isRoomSelection || isCheckout || isRoomList || isBookingConfirmation) window.scrollTo({ top: 0, behavior: 'instant' });
    else if (isRoomDetail && section && ['room-about', 'room-features', 'room-notes'].includes(section)) {
      document.getElementById(section)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    } else if (isRoomDetail) window.scrollTo({ top: 0, behavior: 'instant' });
  }, [location, isSignIn, isRoomSelection, isCheckout, isRoomList, isRoomDetail, isBookingConfirmation, search]);
  const dialog = useRef<HTMLDialogElement>(null);
  const [panel, setPanel] = useState<Panel>('chat');
  const [message, setMessage] = useState('');
  const [submitted, setSubmitted] = useState(false);
  // The ONLY source of "signed in" (see lib/session.ts). There used to be a local `guest`
  // string here as well, set only by /signin's demo flow, so a real sign-in at /checkout left
  // the header anonymous and a demo sign-in here left apiFetch with no token.
  const principal = usePrincipal();
  const [chatNotice, setChatNotice] = useState(false);
  const [sending, setSending] = useState(false);
  const [sentRef, setSentRef] = useState('');
  const [chatError, setChatError] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const returnPath = useRef((() => {
    try {
      const stored = sessionStorage.getItem('estate-signin-return');
      return stored?.startsWith('/') && !stored.startsWith('//') && !stored.startsWith('/signin') && !stored.startsWith('/auth/') ? stored : '/';
    } catch { return '/'; }
  })());
  const resumeChat = useRef(false);
  const arrival = search.get('arrival') || '';
  const departure = search.get('departure') || '';
  const [cart, setCart] = useState<Cart>(() => {
    try { return restoreCart(sessionStorage.getItem('estate-cart')); } catch { return []; }
  });
  useEffect(() => {
    try { sessionStorage.setItem('estate-cart', JSON.stringify(cart)); } catch { /* Storage is optional. */ }
  }, [cart]);

  function planStay() {
    stopBookingScroll.current?.();
    stopBookingScroll.current = scrollToBooking(() => calendar.current?.openCalendar());
  }

  function selectRoom(from: string, to: string) {
    navigate(`/book/select?${new URLSearchParams({ arrival: from, departure: to })}`);
  }

  function openPanel(next: Panel) {
    setPanel(next);
    setSubmitted(false);
    setChatNotice(false);
    setSentRef('');
    setChatError('');
    dialog.current?.showModal();
  }

  function openSignIn(fromChat = false) {
    returnPath.current = location === '/signin' ? '/' : location + (window.location.search || '');
    try { sessionStorage.setItem('estate-signin-return', returnPath.current); } catch { /* SPA return still works. */ }
    resumeChat.current = fromChat;
    dialog.current?.close();
    navigate('/signin');
  }
  function finishSignIn() {
    navigate(returnPath.current || '/');
    if (resumeChat.current) {
      resumeChat.current = false;
      setPanel('chat'); setSubmitted(true); setChatNotice(false);
      window.setTimeout(() => dialog.current?.showModal(), 0);
    }
  }
  function askAbout(subject: string) {
    setMessage(subject ? `I'd like to know more about ${subject}.` : '');
    openPanel('chat');
  }

  return (
    <main>
      {isAuthCallback ? <AuthCallback onSignedIn={finishSignIn} />
        : accountTab ? <Suspense fallback={<LoadingSkeleton label="Loading your account…" variant="detail" />}><Account tab={accountTab} /></Suspense>
        : isEvents ? <Suspense fallback={<LoadingSkeleton label="Loading…" variant="detail" />}><Events /></Suspense>
        : isRoomSelection ? <RoomSelection arrival={arrival} departure={departure} cart={cart} onCart={setCart} />
        : isCheckout ? <Checkout arrival={arrival} departure={departure} cart={cart} onCart={setCart} onSignIn={() => openSignIn()} />
        : isBookingConfirmation ? <BookingConfirmation key={bookingId} bookingId={bookingId} />
        : isSignIn ? <SignIn onComplete={finishSignIn} onBack={() => navigate(returnPath.current || '/')} />
        : isRoomList ? <RoomList />
        : isRoomDetail ? <RoomDetails key={roomSlug} slug={roomSlug} arrival={arrival} departure={departure} cart={cart} onCart={setCart} onAccount={() => principal ? navigate('/account/bookings') : openSignIn()} onAsk={askAbout} />
        : <Switch>
            <Route path="/">
              <Home arrival={arrival} departure={departure} calendarRef={calendar} onPlanStay={planStay} onBook={selectRoom} onAccount={() => principal ? navigate('/account/bookings') : openSignIn()} onAsk={askAbout} />
            </Route>
            <Route><NotFound /></Route>
          </Switch>}
      {!isSignIn && !isRoomSelection && !isCheckout && !isAuthCallback && !isBookingConfirmation && !accountTab && !isEvents && <button className="chat-trigger" onClick={() => openPanel('chat')} aria-label="Chat with us"><span className="chat-icon" aria-hidden="true" /><span>Chat with us</span></button>}

      <dialog ref={dialog} className={`popup ${panel === 'chat' ? 'chat-popup' : ''}`} onClick={(event) => { if (event.target === dialog.current) dialog.current.close(); }}>
        <button className="close-button" aria-label="Close popup" onClick={() => dialog.current?.close()}>×</button>
        <p className="popup-eyebrow">THE QUIET ESTATE</p>
        <h2>{panel === 'chat' ? 'A little help with your stay?' : 'Welcome to your quiet.'}</h2>
        {panel === 'account' ? <>
          <p>You’re signed in. Your bookings and messages travel with you.</p>
          <button className="solid-button" disabled={signingOut} onClick={async () => {
            setSigningOut(true);
            const ok = await signOut();
            setSigningOut(false);
            if (ok) dialog.current?.close();
            else setChatNotice(true);
          }}>{signingOut ? 'Signing out…' : <>Sign out <span>↗</span></>}</button>
          {chatNotice && <p role="alert" className="signin-error">We couldn't reach the server to end your session. Please try again.</p>}
        </> : !submitted ? <form onSubmit={(event) => { event.preventDefault(); if (principal) setSubmitted(true); else openSignIn(true); }}><p>Tell us what you have in mind. We’ll help you take it from here.</p><label className="message-label" htmlFor="message">Your message</label><textarea id="message" required maxLength={2000} placeholder="I’m planning a stay…" value={message} onChange={(event) => setMessage(event.target.value)} /><button className="solid-button" type="submit">Start a conversation <span>↗</span></button></form> : <>
          {sentRef
            ? <><p role="status">Thank you — your message is with our team.</p><blockquote>{message}</blockquote><p className="preview-note">Your reference is <strong>{sentRef}</strong>. We’ll reply by email.</p></>
            : <><p>Your message is ready to send.</p><blockquote>{message}</blockquote>
              <button className="solid-button" disabled={sending} onClick={async () => {
                setSending(true);
                setChatError('');
                try {
                  // Really creates the enquiry. This button used to set a local "sent" flag and
                  // show a success state without any network call at all.
                  const result = await apiFetch<{ enquiryId: string; publicRef: string }>('/enquiries', {
                    method: 'POST',
                    body: { message },
                  });
                  setSentRef(result.publicRef);
                } catch {
                  setChatError('We couldn’t send that just now. Please try again.');
                } finally {
                  setSending(false);
                }
              }}>{sending ? 'Sending…' : <>Send message <span>↗</span></>}</button>
              {chatError && <p role="alert" className="signin-error">{chatError}</p>}</>}
        </>}

      </dialog>
    </main>
  );
}

const EmployeeConsole = lazy(() => import('./console/Console'));
const Account = lazy(() => import('./components/Account'));
const Events = lazy(() => import('./components/Events'));

export default function App() {
  const [location] = useLocation();
  useEffect(() => {
    const settleImage = (event: Event) => {
      if (event.target instanceof HTMLImageElement) event.target.dataset.loaded = 'true';
    };
    for (const image of document.images) if (image.complete) image.dataset.loaded = 'true';
    document.addEventListener('load', settleImage, true);
    document.addEventListener('error', settleImage, true);
    return () => {
      document.removeEventListener('load', settleImage, true);
      document.removeEventListener('error', settleImage, true);
    };
  }, []);
  return location === '/console' || location.startsWith('/console/')
    ? <Suspense fallback={<LoadingSkeleton label="Loading employee workspace…" variant="table" rows={7} />}><EmployeeConsole /></Suspense>
    : <GuestApp />;
}
