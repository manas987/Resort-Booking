import { DateInput } from './FormControls';
import { useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { ArrowUpRight } from 'lucide-react';
import { apiFetch, ApiError } from '../lib/api';
import { usePrincipal } from '../lib/session';
import { photoUrl, photoSrcSet } from '../lib/photoUrl';
import type { EventEnquiryInput } from '../lib/types';

/**
 * §8G — the wedding/offsite page and form. Lazy-loaded.
 *
 * What this page deliberately does NOT do, because §8G is explicit about it: reserve a lawn,
 * guarantee event space, take a deposit, start an event-payment flow, or quote a package price.
 * It creates an enquiry and promises a reply. Any pricing language here would also contradict
 * the AI drafter, which is forbidden from inventing a figure the backend has not quoted
 * (INV-45) — the two have to tell the guest the same story.
 *
 * `POST /eventEnquiries` is `requireGuest`, so this asks for sign-in first rather than letting
 * someone fill in a long form and lose it to a 401.
 */
const HERO = 'photo-1465495976277-4387d4b0b4c6';

export default function Events() {
  const principal = usePrincipal();
  const [eventType, setEventType] = useState<EventEnquiryInput['eventType']>('wedding');
  const [dateMode, setDateMode] = useState<'exact' | 'month' | 'flexible'>('exact');
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [month, setMonth] = useState('');
  const [flexibleNotes, setFlexibleNotes] = useState('');
  const [guestCount, setGuestCount] = useState('');
  const [roomsNeeded, setRoomsNeeded] = useState('');
  const [nights, setNights] = useState('');
  const [budget, setBudget] = useState('');
  const [requirements, setRequirements] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sentRef, setSentRef] = useState('');

  function preferredDates(): EventEnquiryInput['preferredDates'] {
    if (dateMode === 'exact') return { type: 'exact', checkIn, checkOut };
    if (dateMode === 'month') return { type: 'month', month };
    return { type: 'flexible', notes: flexibleNotes };
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body: EventEnquiryInput = {
        eventType,
        preferredDates: preferredDates(),
        guestCount: Number(guestCount),
        roomsNeeded: Number(roomsNeeded),
        nights: Number(nights),
        // Rupees in the field, paise on the wire — the whole API is integer paise
        // (Docs/00-conventions.md). Optional, so an empty field is omitted, not sent as 0.
        ...(budget.trim() ? { budgetPaise: Math.round(Number(budget) * 100) } : {}),
        ...(requirements.trim() ? { requirements: requirements.trim() } : {}),
        contactName: contactName.trim(),
        ...(contactEmail.trim() ? { contactEmail: contactEmail.trim() } : {}),
        ...(contactPhone.trim() ? { contactPhone: contactPhone.trim() } : {}),
      };
      const result = await apiFetch<{ enquiryId: string; publicRef: string }>('/eventEnquiries', {
        method: 'POST',
        body,
      });
      setSentRef(result.publicRef);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'We couldn’t send that just now. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="events-page">
      <header className="booking-header">
        <Link href="/" className="booking-wordmark">
          THE QUIET ESTATE
        </Link>
        <Link href="/rooms">
          Rooms &amp; villas <ArrowUpRight size={14} />
        </Link>
      </header>

      <section className="events-hero">
        <img
          src={photoUrl(HERO, 1280)}
          srcSet={photoSrcSet(HERO)}
          sizes="100vw"
          width={1280}
          height={720}
          alt="Open estate lawns framed by tall trees"
          fetchPriority="high"
        />
        <div className="events-hero-copy">
          <span className="room-eyebrow">WEDDINGS &amp; OFFSITES</span>
          <h1>Room to gather.</h1>
          <p>
            Tell us what you have in mind and our team will come back to you on what the estate can
            do for your dates.
          </p>
        </div>
      </section>

      <section className="events-body">
        <div className="events-intro">
          <h2>How this works</h2>
          <p>
            Share your dates, your group and anything particular you need. This starts a
            conversation with our events team — it doesn’t hold a date or a space, and nothing is
            charged here. They’ll confirm what’s possible, including capacity and pricing, before
            anything is agreed.
          </p>
        </div>

        {sentRef ? (
          <div className="checkout-empty">
            <h2>Thank you — that’s with our team.</h2>
            <p>
              Your reference is <strong>{sentRef}</strong>. You can follow the conversation in your
              account.
            </p>
            <Link className="booking-primary" href="/account/enquiries">
              View your messages <ArrowUpRight size={16} />
            </Link>
          </div>
        ) : !principal ? (
          <div className="checkout-empty">
            <h2>Sign in to send an enquiry.</h2>
            <p>So we can reach you about it, and so you can read our reply in your account.</p>
            <Link className="booking-primary" href="/signin">
              Sign in <ArrowUpRight size={16} />
            </Link>
          </div>
        ) : (
          <form className="events-form" onSubmit={submit}>
            <fieldset>
              <legend>What are you planning?</legend>
              {(
                [
                  ['wedding', 'A wedding'],
                  ['offsite', 'A corporate offsite'],
                ] as const
              ).map(([value, label]) => (
                <label key={value} className="events-radio">
                  <input
                    type="radio"
                    name="eventType"
                    value={value}
                    checked={eventType === value}
                    onChange={() => setEventType(value)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </fieldset>

            <fieldset>
              <legend>When?</legend>
              {(
                [
                  ['exact', 'I have exact dates'],
                  ['month', 'I know the month'],
                  ['flexible', 'We’re flexible'],
                ] as const
              ).map(([value, label]) => (
                <label key={value} className="events-radio">
                  <input
                    type="radio"
                    name="dateMode"
                    value={value}
                    checked={dateMode === value}
                    onChange={() => setDateMode(value)}
                  />
                  <span>{label}</span>
                </label>
              ))}

              {dateMode === 'exact' && (
                <div className="events-pair">
                  <label htmlFor="events-checkin">
                    Arrival
                    <DateInput
                      id="events-checkin"
                      type="date"
                      required
                      value={checkIn}
                      onChange={(event) => setCheckIn(event.target.value)}
                    />
                  </label>
                  <label htmlFor="events-checkout">
                    Departure
                    <DateInput
                      id="events-checkout"
                      type="date"
                      required
                      value={checkOut}
                      onChange={(event) => setCheckOut(event.target.value)}
                    />
                  </label>
                </div>
              )}
              {dateMode === 'month' && (
                <label htmlFor="events-month">
                  Month
                  <input
                    id="events-month"
                    type="month"
                    required
                    value={month}
                    onChange={(event) => setMonth(event.target.value)}
                  />
                </label>
              )}
              {dateMode === 'flexible' && (
                <label htmlFor="events-flexible">
                  Roughly when, and how flexible?
                  <input
                    id="events-flexible"
                    required
                    maxLength={200}
                    value={flexibleNotes}
                    onChange={(event) => setFlexibleNotes(event.target.value)}
                    placeholder="Any weekend after the monsoon, say"
                  />
                </label>
              )}
            </fieldset>

            <div className="events-pair events-triple">
              <label htmlFor="events-guests">
                Guests
                <input
                  id="events-guests"
                  type="number"
                  required
                  min={1}
                  max={1000}
                  inputMode="numeric"
                  value={guestCount}
                  onChange={(event) => setGuestCount(event.target.value)}
                />
              </label>
              <label htmlFor="events-rooms">
                Rooms needed
                <input
                  id="events-rooms"
                  type="number"
                  required
                  min={1}
                  max={76}
                  inputMode="numeric"
                  value={roomsNeeded}
                  onChange={(event) => setRoomsNeeded(event.target.value)}
                />
              </label>
              <label htmlFor="events-nights">
                Nights
                <input
                  id="events-nights"
                  type="number"
                  required
                  min={1}
                  max={30}
                  inputMode="numeric"
                  value={nights}
                  onChange={(event) => setNights(event.target.value)}
                />
              </label>
            </div>

            <label htmlFor="events-budget">
              Budget in rupees <span className="events-optional">optional</span>
              <input
                id="events-budget"
                type="number"
                min={0}
                inputMode="numeric"
                value={budget}
                onChange={(event) => setBudget(event.target.value)}
                placeholder="Total you have in mind"
              />
            </label>

            <label htmlFor="events-requirements">
              Anything else we should know? <span className="events-optional">optional</span>
              <textarea
                id="events-requirements"
                maxLength={2000}
                value={requirements}
                onChange={(event) => setRequirements(event.target.value)}
                placeholder="Catering, timings, accessibility, anything at all"
              />
            </label>

            <fieldset>
              <legend>How do we reach you?</legend>
              <label htmlFor="events-name">
                Your name
                <input
                  id="events-name"
                  required
                  maxLength={100}
                  autoComplete="name"
                  value={contactName}
                  onChange={(event) => setContactName(event.target.value)}
                />
              </label>
              <div className="events-pair">
                <label htmlFor="events-email">
                  Email
                  <input
                    id="events-email"
                    type="email"
                    autoComplete="email"
                    value={contactEmail}
                    onChange={(event) => setContactEmail(event.target.value)}
                  />
                </label>
                <label htmlFor="events-phone">
                  Mobile
                  <input
                    id="events-phone"
                    type="tel"
                    autoComplete="tel"
                    value={contactPhone}
                    onChange={(event) => setContactPhone(event.target.value)}
                  />
                </label>
              </div>
            </fieldset>

            {error && (
              <p role="alert" className="signin-error">
                {error}
              </p>
            )}
            <button className="solid-button" type="submit" disabled={busy}>
              {busy ? 'Sending…' : <>Send enquiry <span>↗</span></>}
            </button>
            <p className="events-note">
              This creates an enquiry. It does not hold a date, reserve a space or take a payment.
            </p>
          </form>
        )}
      </section>
    </div>
  );
}
