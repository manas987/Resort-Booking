import { LoadingSkeleton } from './LoadingSkeleton';
import { Select } from './FormControls';
import { useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { ArrowUpRight, ArrowLeft } from 'lucide-react';
import { apiFetch, ApiError } from '../lib/api';
import { useResource } from '../lib/useResource';
import { usePrincipal } from '../lib/session';
import { formatPaise } from '../lib/money';
import type { Booking, EnquiryDetail, EnquirySummary, Paginated } from '../lib/types';

/**
 * §8F "My account / Open queries" — bookings, enquiry threads and profile. Lazy-loaded from
 * `App.tsx` so none of it reaches the guest entry bundle (`apps/Frontend/CLAUDE.md`).
 *
 * Every read here is already scoped to the authenticated guest server-side: `GET /bookings`
 * and `GET /enquiries` filter on `guest_user_id`, and a record belonging to someone else
 * answers `404`, never `403` (INV-34, anti-leak). So there is no ownership check to write in
 * this file — attempting one would only duplicate the authority badly.
 *
 * Staff-only notes and AI internals never appear: `GET /enquiries/:id` returns guest-visible
 * messages only, and nothing here reaches for them anywhere else.
 */

const STATUS_LABEL: Record<EnquirySummary['status'], string> = {
  new: 'Received',
  in_progress: 'With our team',
  awaiting_guest: 'In progress',
  resolved: 'Resolved',
};

const BOOKING_LABEL: Record<Booking['status'], string> = {
  pending_payment: 'Payment pending',
  confirmed: 'Confirmed',
  payment_failed: 'Payment failed',
  expired: 'Expired',
};

function formatDay(value: string) {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(value.length === 10 ? `${value}T12:00:00+05:30` : value));
}

function formatMoment(value: string) {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(value));
}

function AccountShell({ tab, children }: { tab: 'bookings' | 'enquiries' | 'profile'; children: React.ReactNode }) {
  const tabs = [
    ['bookings', 'My bookings', '/account/bookings'],
    ['enquiries', 'My messages', '/account/enquiries'],
    ['profile', 'Profile', '/account/profile'],
  ] as const;
  return (
    <div className="account-page">
      <header className="booking-header">
        <Link href="/" className="booking-wordmark">
          THE QUIET ESTATE
        </Link>
        <Link href="/">
          Back to the estate <ArrowUpRight size={14} />
        </Link>
      </header>
      <div className="account-heading">
        <span className="room-eyebrow">YOUR ACCOUNT</span>
        <h1>Everything in one quiet place.</h1>
      </div>
      <nav className="account-tabs" aria-label="Account sections">
        {tabs.map(([key, label, href]) => (
          <Link key={key} href={href} aria-current={tab === key ? 'page' : undefined}>
            {label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}

function SignedOut() {
  return (
    <div className="checkout-empty">
      <h2>Sign in to see your stay.</h2>
      <p>Your bookings and messages are tied to your account.</p>
      <Link className="booking-primary" href="/signin">
        Sign in <ArrowUpRight size={16} />
      </Link>
    </div>
  );
}

function Bookings() {
  const { data, loading, error, refetch } = useResource<Paginated<Booking>>(
    (signal) => apiFetch('/bookings?limit=25', { signal }),
    [],
  );
  if (loading) return <LoadingSkeleton label="Loading your bookings…" variant="cards" />;
  if (error)
    return (
      <p role="alert">
        Couldn’t load your bookings.{' '}
        <button type="button" className="room-inline-link" onClick={refetch}>
          Try again
        </button>
      </p>
    );
  if (!data || data.items.length === 0)
    return (
      <div className="checkout-empty">
        <h2>No stays yet.</h2>
        <p>When you book, it will appear here with your reference and the price you paid.</p>
        <Link className="booking-primary" href="/rooms">
          Explore rooms <ArrowUpRight size={16} />
        </Link>
      </div>
    );
  return (
    <ul className="account-list">
      {data.items.map((booking) => (
        <li key={booking.bookingId}>
          <Link href={`/booking/${booking.bookingId}`}>
            <div>
              <strong>{booking.reference}</strong>
              <span>
                {formatDay(booking.checkIn)} – {formatDay(booking.checkOut)}
              </span>
            </div>
            <div className="account-list-end">
              {/* The label carries the state in words; colour alone never conveys it (§28). */}
              <span className={`account-status account-status-${booking.status}`}>{BOOKING_LABEL[booking.status]}</span>
              <span>{formatPaise(booking.totalPaise)}</span>
              <ArrowUpRight size={15} aria-hidden="true" />
            </div>
          </Link>
        </li>
      ))}
      {data.nextCursor && (
        <li className="account-list-note">
          Showing your 25 most recent stays. Older bookings are with our reservations team.
        </li>
      )}
    </ul>
  );
}

function Thread({ enquiryId, onBack }: { enquiryId: string; onBack: () => void }) {
  const { data, loading, error, refetch } = useResource<EnquiryDetail>(
    (signal) => apiFetch(`/enquiries/${enquiryId}`, { signal }),
    [enquiryId],
  );
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!reply.trim()) return;
    setSending(true);
    setSendError('');
    try {
      await apiFetch(`/enquiries/${enquiryId}/messages`, { method: 'POST', body: { message: reply.trim() } });
      setReply('');
      refetch();
    } catch (sendFailure) {
      setSendError(sendFailure instanceof ApiError ? sendFailure.message : 'We couldn’t send that. Please try again.');
    } finally {
      setSending(false);
    }
  }

  if (loading) return <LoadingSkeleton label="Loading your conversation…" variant="detail" />;
  if (error)
    return (
      <p role="alert">
        Couldn’t load this conversation.{' '}
        <button type="button" className="room-inline-link" onClick={refetch}>
          Try again
        </button>
      </p>
    );
  if (!data) return null;

  return (
    <div className="account-thread">
      <button type="button" className="signin-back" onClick={onBack}>
        <ArrowLeft size={16} /> All messages
      </button>
      <div className="account-thread-head">
        <strong>{data.publicRef}</strong>
        <span className={`account-status account-status-${data.status}`}>{STATUS_LABEL[data.status]}</span>
      </div>
      <ol className="account-messages">
        {data.messages.map((message) => (
          <li key={message.id} className={`account-message account-message-${message.direction === 'inbound' ? 'guest' : 'staff'}`}>
            <span className="account-message-who">{message.direction === 'inbound' ? 'You' : 'The Quiet Estate'}</span>
            <p>{message.body}</p>
            <time dateTime={message.createdAt}>{formatMoment(message.createdAt)}</time>
          </li>
        ))}
      </ol>
      {data.status === 'resolved' ? (
        <p className="preview-note">
          This conversation is resolved. Replying reopens it, and our team will pick it up again.
        </p>
      ) : null}
      <form className="account-reply" onSubmit={send}>
        <label htmlFor="account-reply">Your reply</label>
        <textarea
          id="account-reply"
          required
          maxLength={4000}
          value={reply}
          onChange={(event) => setReply(event.target.value)}
          placeholder="Add anything that would help…"
        />
        {sendError && (
          <p role="alert" className="signin-error">
            {sendError}
          </p>
        )}
        <button className="solid-button" type="submit" disabled={sending}>
          {sending ? 'Sending…' : <>Send reply <span>↗</span></>}
        </button>
      </form>
    </div>
  );
}

function Enquiries() {
  const [openThread, setOpenThread] = useState('');
  const { data, loading, error, refetch } = useResource<Paginated<EnquirySummary>>(
    (signal) => apiFetch('/enquiries?limit=25', { signal }),
    [],
  );

  if (openThread) return <Thread enquiryId={openThread} onBack={() => setOpenThread('')} />;
  if (loading) return <LoadingSkeleton label="Loading your messages…" variant="table" />;
  if (error)
    return (
      <p role="alert">
        Couldn’t load your messages.{' '}
        <button type="button" className="room-inline-link" onClick={refetch}>
          Try again
        </button>
      </p>
    );
  if (!data || data.items.length === 0)
    return (
      <div className="checkout-empty">
        <h2>No messages yet.</h2>
        <p>Ask us anything about a stay and the conversation will live here.</p>
        <Link className="booking-primary" href="/">
          Start a conversation <ArrowUpRight size={16} />
        </Link>
      </div>
    );

  // §8F asks for open threads and resolved history as distinct things.
  const open = data.items.filter((item) => item.status !== 'resolved');
  const resolved = data.items.filter((item) => item.status === 'resolved');

  const row = (item: EnquirySummary) => (
    <li key={item.enquiryId}>
      <button type="button" onClick={() => setOpenThread(item.enquiryId)}>
        <div>
          <strong>{item.publicRef}</strong>
          <span>Last activity {formatMoment(item.lastActivityAt)}</span>
        </div>
        <div className="account-list-end">
          <span className={`account-status account-status-${item.status}`}>{STATUS_LABEL[item.status]}</span>
          <ArrowUpRight size={15} aria-hidden="true" />
        </div>
      </button>
    </li>
  );

  return (
    <>
      <h2 className="account-subhead">Open</h2>
      {open.length > 0 ? <ul className="account-list">{open.map(row)}</ul> : <p className="account-list-note">Nothing open right now.</p>}
      <h2 className="account-subhead">Resolved</h2>
      {resolved.length > 0 ? (
        <ul className="account-list">{resolved.map(row)}</ul>
      ) : (
        <p className="account-list-note">No resolved conversations yet.</p>
      )}
    </>
  );
}

function Profile() {
  const principal = usePrincipal();
  const [name, setName] = useState('');
  const [nameBusy, setNameBusy] = useState(false);
  const [nameDone, setNameDone] = useState('');
  const [nameError, setNameError] = useState('');

  const [kind, setKind] = useState<'email' | 'phone'>('email');
  const [destination, setDestination] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'idle' | 'code'>('idle');
  const [demoCode, setDemoCode] = useState<string | undefined>();
  const [contactBusy, setContactBusy] = useState(false);
  const [contactError, setContactError] = useState('');
  const [contactDone, setContactDone] = useState('');

  async function saveName(event: FormEvent) {
    event.preventDefault();
    setNameBusy(true);
    setNameError('');
    setNameDone('');
    try {
      const result = await apiFetch<{ name: string }>('/account/profile', { method: 'PATCH', body: { name: name.trim() } });
      setNameDone(`Saved as ${result.name}.`);
    } catch (error) {
      setNameError(error instanceof ApiError ? error.message : 'Couldn’t save that. Please try again.');
    } finally {
      setNameBusy(false);
    }
  }

  async function startContactChange(event: FormEvent) {
    event.preventDefault();
    setContactBusy(true);
    setContactError('');
    setContactDone('');
    try {
      const result = await apiFetch<{ expiresAt: string; demoCode?: string }>('/account/contact/verify-start', {
        method: 'POST',
        body: { destinationKind: kind, destination: destination.trim() },
      });
      setDemoCode(result.demoCode);
      setStage('code');
    } catch (error) {
      setContactError(error instanceof ApiError ? error.message : 'Couldn’t start that change. Please try again.');
    } finally {
      setContactBusy(false);
    }
  }

  async function confirmContactChange(event: FormEvent) {
    event.preventDefault();
    setContactBusy(true);
    setContactError('');
    try {
      // The new value is written only once this verify succeeds — that is what makes the change
      // safe (INV-34): an unverified address never becomes the account's contact.
      await apiFetch('/auth/otp/verify', {
        method: 'POST',
        body: {
          destinationKind: kind,
          destination: destination.trim(),
          purpose: kind === 'email' ? 'verify_email' : 'verify_phone',
          code,
        },
      });
      setContactDone(`Your ${kind} is updated and verified.`);
      setStage('idle');
      setCode('');
      setDestination('');
    } catch (error) {
      setContactError(error instanceof ApiError ? error.message : 'That code didn’t match. Please try again.');
    } finally {
      setContactBusy(false);
    }
  }

  return (
    <div className="account-profile">
      <section>
        <h2 className="account-subhead">Your name</h2>
        <form onSubmit={saveName}>
          <label htmlFor="profile-name">Name</label>
          <input
            id="profile-name"
            required
            maxLength={100}
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Your full name"
          />
          {nameError && (
            <p role="alert" className="signin-error">
              {nameError}
            </p>
          )}
          {nameDone && (
            <p role="status" className="preview-note">
              {nameDone}
            </p>
          )}
          <button className="solid-button" type="submit" disabled={nameBusy}>
            {nameBusy ? 'Saving…' : 'Save name'}
          </button>
        </form>
      </section>

      <section>
        <h2 className="account-subhead">Email and mobile</h2>
        <p className="account-list-note">
          Verified now: email {principal?.emailVerified ? 'yes' : 'not yet'} · mobile{' '}
          {principal?.phoneVerified ? 'yes' : 'not yet'}. Both are needed before you can book.
        </p>
        {stage === 'idle' ? (
          <form onSubmit={startContactChange}>
            <label htmlFor="profile-kind">What would you like to change?</label>
            <Select id="profile-kind" value={kind} onChange={(event) => setKind(event.target.value as 'email' | 'phone')}>
              <option value="email">Email address</option>
              <option value="phone">Mobile number</option>
            </Select>
            <label htmlFor="profile-destination">{kind === 'email' ? 'New email address' : 'New mobile number'}</label>
            <input
              id="profile-destination"
              required
              type={kind === 'email' ? 'email' : 'tel'}
              inputMode={kind === 'email' ? 'email' : 'numeric'}
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
              placeholder={kind === 'email' ? 'you@example.com' : '+91 98765 43210'}
            />
            {contactError && (
              <p role="alert" className="signin-error">
                {contactError}
              </p>
            )}
            {contactDone && (
              <p role="status" className="preview-note">
                {contactDone}
              </p>
            )}
            <button className="solid-button" type="submit" disabled={contactBusy}>
              {contactBusy ? 'Sending a code…' : 'Send verification code'}
            </button>
          </form>
        ) : (
          <form onSubmit={confirmContactChange}>
            <label htmlFor="profile-code">Verification code</label>
            <input
              id="profile-code"
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              minLength={6}
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
              placeholder="6-digit code"
            />
            {demoCode && <p className="signin-demo">Verification code: {demoCode}</p>}
            {contactError && (
              <p role="alert" className="signin-error">
                {contactError}
              </p>
            )}
            <button className="solid-button" type="submit" disabled={contactBusy}>
              {contactBusy ? 'Verifying…' : 'Verify and save'}
            </button>
            <button type="button" className="room-inline-link" onClick={() => { setStage('idle'); setCode(''); }}>
              Start over
            </button>
          </form>
        )}
      </section>
    </div>
  );
}

export default function Account({ tab }: { tab: 'bookings' | 'enquiries' | 'profile' }) {
  const principal = usePrincipal();
  return (
    <AccountShell tab={tab}>
      {!principal ? <SignedOut /> : tab === 'bookings' ? <Bookings /> : tab === 'enquiries' ? <Enquiries /> : <Profile />}
    </AccountShell>
  );
}
