import { LoadingSkeleton } from './LoadingSkeleton';
import { useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { ArrowUpRight, Check } from 'lucide-react';
import { apiFetch, ApiError } from '../lib/api';
import { formatPaise } from '../lib/money';
import { useResource } from '../lib/useResource';
import type { Booking } from '../lib/types';

const STATUS_COPY: Record<Booking['status'], string> = {
  confirmed: 'Confirmed',
  pending_payment: 'Payment pending',
  payment_failed: 'Payment failed',
  expired: 'Hold expired',
};

/** §8E's required "clear support/enquiry action". Posts to
 *  `POST /enquiries/from-booking/:bookingId`, which checks ownership server-side — so this
 *  component never has to, and must not try. The resulting thread is readable at
 *  /account/enquiries. */
function SupportAction({ bookingId }: { bookingId: string }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sentRef, setSentRef] = useState('');

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!message.trim()) return;
    setBusy(true);
    setError('');
    try {
      const result = await apiFetch<{ enquiryId: string; publicRef: string }>(
        `/enquiries/from-booking/${bookingId}`,
        { method: 'POST', body: { message: message.trim() } },
      );
      setSentRef(result.publicRef);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'We couldn’t send that. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (sentRef) {
    return (
      <div className="booking-support">
        <p role="status">
          Our team has your message. Reference <strong>{sentRef}</strong>.
        </p>
        <Link className="room-inline-link" href="/account/enquiries">
          Follow it in your account <ArrowUpRight size={14} />
        </Link>
      </div>
    );
  }

  return (
    <div className="booking-support">
      {open ? (
        <form onSubmit={send}>
          <label htmlFor="booking-support-message">How can we help with this stay?</label>
          <textarea
            id="booking-support-message"
            required
            maxLength={2000}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Anything about this booking…"
          />
          {error && (
            <p role="alert" className="signin-error">
              {error}
            </p>
          )}
          <button className="solid-button" type="submit" disabled={busy}>
            {busy ? 'Sending…' : <>Send to our team <span>↗</span></>}
          </button>
        </form>
      ) : (
        <button type="button" className="room-inline-link" onClick={() => setOpen(true)}>
          Need help with this booking?
        </button>
      )}
    </div>
  );
}

/** `/booking/:bookingId` — §8E in full. Keyed by `bookingId` (uuid), not the human `reference`
 * code: `GET /bookings/reference/:reference/status` (the only reference-keyed read) returns
 * just a status triple, not the full breakdown this page needs — `GET /bookings/:bookingId`
 * is the one that does, so the URL carries what that endpoint actually takes. `reference` is
 * still what's shown to the guest, just not what's in the address bar. */
export function BookingConfirmation({ bookingId }: { bookingId: string }) {
  const { data: booking, loading, error } = useResource<Booking>((signal) => apiFetch(`/bookings/${bookingId}`, { signal }), [bookingId]);

  if (loading) return <div className="booking-page"><LoadingSkeleton label="Loading your booking…" variant="detail" /></div>;
  if (error || !booking) return <div className="booking-page checkout-empty"><h2>We couldn't find that booking.</h2><Link className="booking-primary" href="/">Back to the estate</Link></div>;

  const confirmed = booking.status === 'confirmed';
  return <div className="booking-page payment-complete">
    {confirmed ? <Check size={30} /> : null}
    <span className="room-eyebrow">{STATUS_COPY[booking.status]}</span>
    <h1>{confirmed ? 'A little closer to quiet.' : booking.status === 'pending_payment' ? 'Almost there.' : 'This booking didn’t go through.'}</h1>
    <p>Reference <strong>{booking.reference}</strong> · {booking.checkIn} – {booking.checkOut}</p>
    <p>Total {formatPaise(booking.totalPaise)}</p>
    {booking.status === 'payment_failed' && <p>The payment attempt failed. Start again from room selection to try once more.</p>}
    {booking.status === 'expired' && <p>The hold on these rooms expired before payment completed.</p>}
    <SupportAction bookingId={bookingId} />
    <Link className="booking-primary" href="/">Back to the estate <ArrowUpRight size={16} /></Link>
  </div>;
}
