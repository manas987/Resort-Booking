import { CheckoutSignIn } from './CheckoutSignIn';
import { LoadingSkeleton } from './LoadingSkeleton';
import { Select } from './FormControls';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowLeft, ArrowUpRight, BedDouble } from 'lucide-react';
import { apiFetch, ApiError, isInFlightReplay } from '../lib/api';
import { reviewerToolsEnabled } from '../lib/reviewerTools';
import { formatPaise } from '../lib/money';
import { usePrincipal, useSessionRestoring } from '../lib/session';
import { idempotentRequest, clearIdempotentRequest } from '../lib/idempotency';
import { stayLabel, stayNights, toQuoteLineItems, linesForRoomType, updateOccupancy, type Cart } from '../data/cart';
import type {
  QuoteResponse, PromoValidateResponse, CreateBookingResponse, CreatePaymentAttemptResponse,
  PaymentAttemptOutcome, PriceChangedDetails, RoomListing,
} from '../lib/types';
import { RoomQuantityStepper } from './RoomQuantityStepper';
import { useResource } from '../lib/useResource';

type Props = { arrival: string; departure: string; cart: Cart; onCart: (cart: Cart) => void; onSignIn: () => void };

const POLL_MS = 2000;
const POLL_TIMEOUT_MS = 30_000;

/** Review and payment stay together; authentication uses /signin and returns to this stay. */
export function Checkout({ arrival, departure, cart, onCart, onSignIn }: Props) {
  const [, navigate] = useLocation();
  const principal = usePrincipal();
  // The refresh-cookie bootstrap in App.tsx has not answered yet. "Signed out" is not yet known
  // to be true, and this page's whole right-hand column branches on it.
  const restoringSession = useSessionRestoring();
  const nights = stayNights(arrival, departure);
  const dates = new URLSearchParams({ arrival, departure });

  const { data: catalogue, error: catalogueError, refetch: retryCatalogue } = useResource<{ rooms: RoomListing[] }>(
    (signal) => apiFetch('/rooms', { signal }), [],
  );
  const roomTypes = [...new Map(cart.map((line) => [line.roomTypeId, line])).values()];
  const verified = !!principal?.emailVerified && !!principal?.phoneVerified;
  const quoteRequest = useRef(0);
  const [step, setStep] = useState<'review' | 'pay'>('review');
  const [quoteKey, setQuoteKey] = useState('');
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [quoteError, setQuoteError] = useState('');
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [promoInput, setPromoInput] = useState('');
  const [promoApplied, setPromoApplied] = useState<string | undefined>();
  const [promoMessage, setPromoMessage] = useState('');
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [bookingError, setBookingError] = useState('');
  const [existingReference, setExistingReference] = useState<string | undefined>();
  const [priceChanged, setPriceChanged] = useState<PriceChangedDetails | null>(null);
  const [conflictNights, setConflictNights] = useState<string[] | null>(null);
  const [payOutcome, setPayOutcome] = useState<PaymentAttemptOutcome>('succeed');
  const [paying, setPaying] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const hasCart = cart.length > 0 && !!nights;

  /** A quote already paid for with a server round trip is worth recovering across a reload.
   *  Keyed by the exact stay it was priced for, so a stored id is never reused for a different
   *  stay. Only the id is stored — never an amount; the backend owns every number. */
  const QUOTE_STORE_KEY = 'estate-quote';
  function quoteSignature(promoCode?: string) {
    return JSON.stringify({
      checkIn: arrival.slice(0, 10),
      checkOut: departure.slice(0, 10),
      rooms: toQuoteLineItems(cart),
      promoCode: promoCode ?? null,
    });
  }
  function rememberQuote(quoteId: string, promoCode?: string) {
    try {
      sessionStorage.setItem(QUOTE_STORE_KEY, JSON.stringify({ quoteId, signature: quoteSignature(promoCode) }));
    } catch {
      // Private mode or blocked storage. Recovery is an optimisation, never a requirement.
    }
  }
  function recallQuoteId(promoCode?: string): string | null {
    try {
      const raw = sessionStorage.getItem(QUOTE_STORE_KEY);
      if (!raw) return null;
      const stored = JSON.parse(raw) as { quoteId?: unknown; signature?: unknown };
      if (typeof stored.quoteId !== 'string' || stored.signature !== quoteSignature(promoCode)) return null;
      return stored.quoteId;
    } catch {
      return null;
    }
  }

  async function fetchQuote(promoCode?: string) {
    const request = ++quoteRequest.current;
    if (!hasCart) return;
    const signature = quoteSignature(promoCode);
    setQuoteLoading(true);
    setQuoteError('');
    try {
      // Try the quote this session already has for exactly this stay before minting another.
      // Posting unconditionally restarted the 5-minute window and changed the quoteId on every
      // reload, silently, which is the one thing a guest should never have happen to a price.
      const recalled = recallQuoteId(promoCode);
      if (recalled) {
        try {
          const existing = await apiFetch<QuoteResponse>(`/quotes/${recalled}`);
          if (request !== quoteRequest.current) return;
          if (!existing.expired) {
            setQuoteKey(signature);
            setQuote(existing);
            setPromoApplied(promoCode);
            return;
          }
        } catch (recallError) {
          // 404 covers both "gone" and "owned by someone else" by design (INV-34). Either way
          // the only correct move is to quote afresh, so fall through.
          if (!(recallError instanceof ApiError) || recallError.code !== 'not_found') throw recallError;
        }
      }
      const result = await apiFetch<QuoteResponse>('/quotes', {
        method: 'POST',
        body: { checkIn: arrival.slice(0, 10), checkOut: departure.slice(0, 10), rooms: toQuoteLineItems(cart), promoCode },
      });
      if (request !== quoteRequest.current) return;
      setQuoteKey(signature);
      setQuote(result);
      setPromoApplied(promoCode);
      rememberQuote(result.quoteId, promoCode);
    } catch (error) {
      if (request === quoteRequest.current) setQuoteError(error instanceof ApiError ? error.message : 'Could not price your stay. Please try again.');
    } finally {
      if (request === quoteRequest.current) setQuoteLoading(false);
    }
  }

  // Deferred a tick so the first setState inside fetchQuote isn't synchronous within the
  // effect body (react-hooks set-state-in-effect) — same pattern as useResource.ts.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- re-quote only when the cart or dates actually change
  useEffect(() => { Promise.resolve().then(() => fetchQuote(promoApplied)); }, [cart, arrival, departure]);

  useEffect(() => () => { quoteRequest.current++; if (pollTimer.current) clearInterval(pollTimer.current); }, []);

  async function applyPromo() {
    if (!promoInput.trim()) return;
    const selectionVersion = quoteRequest.current;
    setPromoMessage('');
    try {
      const result = await apiFetch<PromoValidateResponse>('/promos/validate', { method: 'POST', body: { code: promoInput.trim() } });
      if (selectionVersion !== quoteRequest.current) { setPromoMessage('Your selection changed. Apply the code again.'); return; }
      if (!result.valid) { setPromoMessage(result.reason); return; }
      await fetchQuote(promoInput.trim());
      setPromoMessage('Promo applied.');
    } catch (error) {
      setPromoMessage(error instanceof ApiError ? error.message : 'Could not check that code.');
    }
  }

  function pollBookingStatus(reference: string) {
    const startedAt = Date.now();
    pollTimer.current = setInterval(async () => {
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        clearInterval(pollTimer.current);
        setBookingError('Payment is taking longer than expected. Check My bookings shortly.');
        setPaying(false);
        return;
      }
      try {
        const status = await apiFetch<{ reference: string; status: string }>(`/bookings/reference/${reference}/status`);
        if (status.status === 'confirmed') {
          clearInterval(pollTimer.current);
          clearIdempotentRequest('qe_idem_booking');
          clearIdempotentRequest('qe_idem_payment');
          navigate(`/booking/${reference}`);
        } else if (status.status === 'payment_failed' || status.status === 'expired') {
          clearInterval(pollTimer.current);
          setPaying(false);
          setBookingError(status.status === 'expired' ? 'Your hold expired before payment completed.' : 'That payment attempt failed. Try again below.');
        }
        // pending_payment: keep polling, visible via document.visibilityState implicitly —
        // the interval only runs while this component (and tab) is mounted/active.
      } catch {
        // transient — try again on the next tick rather than surfacing a blip as an error
      }
    }, POLL_MS);
  }

  async function payNow() {
    if (!quote || !canPay || paying) return;
    setBookingError('');
    setPriceChanged(null);
    setConflictNights(null);
    setExistingReference(undefined);
    setPaying(true);
    try {
      const bookingBody = { quoteId: quote.quoteId, guestName, guestEmail, guestPhone };
      const bookingIdem = idempotentRequest('qe_idem_booking', bookingBody);
      let booking: CreateBookingResponse;
      try {
        booking = await apiFetch<CreateBookingResponse>('/bookings', { method: 'POST', body: bookingBody, idempotencyKey: bookingIdem.key });
      } catch (error) {
        if (isInFlightReplay(error)) {
          // Another attempt with this exact key is still being processed — poll, don't fail.
          await new Promise((resolve) => setTimeout(resolve, POLL_MS));
          booking = await apiFetch<CreateBookingResponse>('/bookings', { method: 'POST', body: bookingBody, idempotencyKey: bookingIdem.key });
        } else throw error;
      }

      const paymentBody = { outcome: payOutcome };
      const paymentIdem = idempotentRequest('qe_idem_payment', { bookingId: booking.bookingId, ...paymentBody });
      await apiFetch<CreatePaymentAttemptResponse>(`/payments/${booking.bookingId}/attempts`, {
        method: 'POST', body: paymentBody, idempotencyKey: paymentIdem.key,
      });
      pollBookingStatus(booking.reference);
    } catch (error) {
      setPaying(false);
      if (!(error instanceof ApiError)) { setBookingError('Something went wrong. Please try again.'); return; }
      switch (error.code) {
        case 'availability_conflict': {
          const conflicts = (error.details as { conflicts?: Array<{ stayDate: string }> } | undefined)?.conflicts ?? [];
          setConflictNights(conflicts.map((c) => c.stayDate));
          clearIdempotentRequest('qe_idem_booking');
          break;
        }
        case 'quote_expired':
          setQuoteError('Your quote expired. Getting a fresh one…');
          clearIdempotentRequest('qe_idem_booking');
          fetchQuote(promoApplied);
          break;
        case 'quote_already_booked':
          setExistingReference((error.details as { reference?: string } | undefined)?.reference);
          clearIdempotentRequest('qe_idem_booking');
          break;
        case 'price_changed':
          setPriceChanged(error.details as PriceChangedDetails);
          clearIdempotentRequest('qe_idem_booking');
          break;
        case 'promo_exhausted':
          setPromoMessage('That promo code just reached its limit.');
          setPromoApplied(undefined);
          clearIdempotentRequest('qe_idem_booking');
          fetchQuote(undefined);
          break;
        case 'hold_expired':
          setBookingError('Your hold expired. Please start again from room selection.');
          clearIdempotentRequest('qe_idem_booking');
          clearIdempotentRequest('qe_idem_payment');
          break;
        default:
          setBookingError(error.message);
      }
    }
  }

  function acknowledgePriceChange() {
    if (!priceChanged) return;
    setQuote((current) => current && { ...current, quoteId: priceChanged.quoteId, pricing: priceChanged, roomPaise: priceChanged.roomPaise, discountPaise: priceChanged.discountPaise, taxPaise: priceChanged.taxPaise, totalPaise: priceChanged.totalPaise });
    setPriceChanged(null);
  }

  const currentQuote = quoteKey === quoteSignature(promoApplied) ? quote : null;
  const canPay = !!currentQuote && !quoteError && !quoteLoading && verified && principal?.onboardingComplete !== false && !!guestName.trim() && !!guestEmail.trim() && !!guestPhone.trim();

  function changeCart(next: Cart) {
    if (paying) return;
    quoteRequest.current++;
    setQuote(null);
    setBookingError('');
    setPriceChanged(null);
    setConflictNights(null);
    setExistingReference(undefined);
    onCart(next);
  }

  if (!hasCart) {
    return <div className="booking-page checkout-page">
      <header className="booking-header"><Link href="/" className="booking-wordmark">THE QUIET ESTATE</Link></header>
      <div className="checkout-empty"><h2>Your stay starts with a room.</h2><p>Add a room to see your selection here.</p><Link className="booking-primary" href={nights ? `/book/select?${dates}` : '/'}>Explore rooms <ArrowUpRight size={16} /></Link></div>
    </div>;
  }

  return <div className="booking-page checkout-page">
    <header className="booking-header"><Link href={`/book/select?${dates}`}><ArrowLeft size={15} /> Room selection</Link><Link href="/" className="booking-wordmark">THE QUIET ESTATE</Link></header>
    <div className="checkout-heading"><span className="room-eyebrow">YOUR TIME AWAY</span><h1>{step === 'review' ? 'Review your stay.' : 'Complete your stay.'}</h1><p>{stayLabel(arrival, departure)} · {nights} nights</p></div>

    <div className="checkout-layout">
      <div className="checkout-items">
        {step === 'review' && <><h2 className="checkout-section-title">Your rooms <span>{cart.length} selected</span></h2>
        {catalogueError && <p className="checkout-media-error">Room photos couldn't load. <button className="room-inline-link" onClick={retryCatalogue}>Try again</button></p>}
        {roomTypes.map((line) => {
          const room = catalogue?.rooms.find((item) => item.id === line.roomTypeId);
          const photo = room?.coverPhoto;
          const lines = linesForRoomType(cart, line.roomTypeId);
          return <article className="checkout-item" key={line.roomTypeId}>
            <Link className="checkout-room-photo" href={`/rooms/${line.slug}?${dates}`} aria-label={`View ${line.name}`}>
              {photo ? <img src={photo.variants[0]?.url} srcSet={photo.variants.map((v) => `${v.url} ${v.w}w`).join(', ')} sizes="(max-width: 640px) 88px, 140px" width={140} height={112} alt={photo.alt} /> : !catalogue && !catalogueError ? <LoadingSkeleton label="Loading room photo…" variant="photo" rows={1} /> : <BedDouble size={26} aria-hidden="true" />}
            </Link>
            <div className="checkout-room-info"><Link href={`/rooms/${line.slug}?${dates}`}><h2>{line.name}</h2></Link><p>{nights} nights · {lines.length} {lines.length === 1 ? 'room' : 'rooms'}</p></div>
            <RoomQuantityStepper room={line} cart={cart} onCart={changeCart} disabled={paying} />
            <details className="checkout-room-guests"><summary>Guests per room <span>{lines.reduce((sum, item) => sum + item.adults + item.children, 0)} guests</span></summary>
              {lines.map((item, index) => <fieldset key={item.lineId} disabled={paying}><legend>Room {index + 1}</legend>
                <label htmlFor={`adults-${item.lineId}`}>Adults<input id={`adults-${item.lineId}`} type="number" min={1} max={room?.maxAdults} value={item.adults} onChange={(event) => changeCart(updateOccupancy(cart, item.lineId, { adults: event.target.valueAsNumber }))} /></label>
                <label htmlFor={`children-${item.lineId}`}>Children<input id={`children-${item.lineId}`} type="number" min={0} max={room?.maxChildren} value={item.children} onChange={(event) => changeCart(updateOccupancy(cart, item.lineId, { children: event.target.valueAsNumber }))} /></label>
                {room && <small>Up to {room.maxOccupancy} guests in this room.</small>}
              </fieldset>)}
            </details>
          </article>;
        })}
        <Link className="room-inline-link" href={`/book/select?${dates}`}>Edit selection <ArrowUpRight size={15} /></Link></>}

        {existingReference && <div className="checkout-notice" role="alert">This stay is already booked. <Link href={`/booking/${existingReference}`}>View your booking <ArrowUpRight size={14} /></Link></div>}
        {conflictNights && <div className="checkout-notice" role="alert">These nights are no longer available: {conflictNights.join(', ')}. <Link href={`/book/select?${dates}`}>Change your selection</Link></div>}
        {priceChanged && <div className="checkout-notice" role="alert">Prices changed — new total {formatPaise(priceChanged.totalPaise)}. <button type="button" className="room-inline-link" onClick={acknowledgePriceChange}>Accept the new total</button></div>}
        {bookingError && <p role="alert" className="signin-error">{bookingError}</p>}

        {restoringSession ? <section className="checkout-auth"><LoadingSkeleton label="Checking your sign-in…" rows={2} /></section>
          : principal && step === 'review' ? <form id="checkout-guest" className="checkout-contact" onSubmit={(event) => { event.preventDefault(); setStep('pay'); }}>
          <h2>Main guest</h2><p>Who should we confirm the booking with?</p><fieldset disabled={paying}>
          <label htmlFor="co-guest-name">Name</label>
          <input id="co-guest-name" autoComplete="name" required maxLength={200} value={guestName} onChange={(e) => setGuestName(e.target.value)} />
          <label htmlFor="co-guest-email">Email</label>
          <input id="co-guest-email" type="email" autoComplete="email" required value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} />
          <label htmlFor="co-guest-phone">Mobile number</label>
          <div className="signin-phone"><span>+91</span><input id="co-guest-phone" type="tel" inputMode="numeric" pattern="[6-9][0-9]{9}" minLength={10} maxLength={10} required value={guestPhone} onChange={(e) => setGuestPhone(e.target.value.replace(/\D/g, ''))} /></div>
        </fieldset></form> : !principal ? <section className="checkout-auth">
          <div><h2>Make it your stay.</h2><p>Sign in to add your details and complete your booking.</p></div>
        </section> : null}
        {principal && step === 'pay' && <section className="checkout-contact">
          <button type="button" className="room-inline-link" disabled={paying} onClick={() => setStep('review')}><ArrowLeft size={14} /> Back to review</button>
          {(!verified || principal.onboardingComplete === false) && <><h2>Verify your details</h2><CheckoutSignIn verificationOnly onVerified={() => {}} /></>}
          <h2>Test payment</h2><p>Sample card details only. No real card is collected or charged.</p>
          <label htmlFor="sample-card">Card number</label><input id="sample-card" value="4242 4242 4242 4242" readOnly autoComplete="off" />
          <label htmlFor="sample-holder">Name on card</label><input id="sample-holder" value="Sample Guest" readOnly autoComplete="off" />
          <div className="checkout-card-row"><label>Expiry<input value="12 / 30" readOnly autoComplete="off" /></label><label>CVV<input value="123" readOnly autoComplete="off" /></label></div>
        </section>}
      </div>

      <aside className="checkout-summary">
        <h2>Your stay</h2><p className="checkout-summary-dates">{stayLabel(arrival, departure)} · {nights} nights</p>
        {quoteLoading && <LoadingSkeleton label="Pricing your stay…" rows={3} />}
        {quoteError && <p role="alert" className="signin-error">{quoteError} <button type="button" className="room-inline-link" disabled={quoteLoading || paying} onClick={() => void fetchQuote(promoApplied)}>Try again</button></p>}
        {currentQuote && <>
          <div><span>Room total</span><span>{formatPaise(currentQuote.roomPaise)}</span></div>
          {currentQuote.discountPaise > 0 && <div><span>Promo discount</span><span>−{formatPaise(currentQuote.discountPaise)}</span></div>}
          <div><span>GST</span><span>{formatPaise(currentQuote.taxPaise)}</span></div>
          <div className="checkout-total"><span>Total</span><strong>{formatPaise(currentQuote.totalPaise)}</strong></div>
          <p>Includes GST. Availability and prices are confirmed when you book.</p>
        </>}
        <details className="checkout-promo"><summary>Have a promo code?</summary>
          <div><input id="co-promo" aria-label="Promo code" disabled={paying} value={promoInput} onChange={(e) => setPromoInput(e.target.value)} placeholder="Optional" /><button type="button" disabled={paying || quoteLoading} onClick={applyPromo}>Apply</button></div>
          {promoMessage && <small>{promoMessage}</small>}
        </details>
        {step === 'pay' && reviewerToolsEnabled && principal?.emailVerified && principal?.phoneVerified && <div className="checkout-pay-outcome">
          <label htmlFor="co-outcome">Payment outcome</label>
          <Select id="co-outcome" value={payOutcome} onChange={(e) => setPayOutcome(e.target.value as PaymentAttemptOutcome)}>
            <option value="succeed">Succeed</option>
            <option value="decline">Decline</option>
            <option value="succeed_late">Succeed (late)</option>
          </Select>
        </div>}
        {principal ? step === 'review' ? <button type="submit" form="checkout-guest" className="booking-primary" disabled={restoringSession || quoteLoading || !currentQuote || !!quoteError}>Checkout <ArrowUpRight size={16} /></button>
          : <button type="button" className="booking-primary" disabled={!canPay || paying} onClick={() => void payNow()}>{paying ? 'Processing…' : 'Pay now'}<ArrowUpRight size={16} /></button>
          : <button type="button" className="booking-primary" disabled={restoringSession} onClick={onSignIn}>Sign in to book <ArrowUpRight size={16} /></button>}
        <small>No charge will be made.</small>
      </aside>
    </div>
  </div>;
}
