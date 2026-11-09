import { useState, type FormEvent } from 'react';
import { ArrowRight } from 'lucide-react';
import { apiFetch, ApiError } from '../lib/api';
import { setSession } from '../lib/session';
import type { Principal } from '../lib/types';

type Step = 'form' | 'email-code' | 'phone-code';

type SessionResponse = { accessToken: string; principal: Principal };

/** Verification form used on `/signin`. One name/email/phone form, then `POST /auth/register` to find out
 * whether this is a new or returning guest (the backend never distinguishes "wrong code"
 * from "no such guest" at verify time, by design — Docs/14-frontend-api-map.md — so asking
 * the guest to self-identify as new/returning isn't reliable; trying register first is).
 * `requireVerifiedGuest` needs BOTH contacts verified, so a second OTP round for phone runs
 * after email succeeds whenever the signed-in principal doesn't already have it. */
export function CheckoutSignIn({ onVerified }: { onVerified: () => void }) {
  const [step, setStep] = useState<Step>('form');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [emailPurpose, setEmailPurpose] = useState<'guest_signup' | 'guest_login'>('guest_signup');
  const [demoCode, setDemoCode] = useState<string | undefined>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function startIdentity(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      let purpose: 'guest_signup' | 'guest_login' = 'guest_signup';
      try {
        await apiFetch('/auth/register', { method: 'POST', body: { name, email, phone } });
      } catch (registerError) {
        // A duplicate email/phone means this is a returning guest — not a failure here.
        if (!(registerError instanceof ApiError) || registerError.code !== 'validation_failed') throw registerError;
        purpose = 'guest_login';
      }
      setEmailPurpose(purpose);
      const { demoCode: emailDemoCode } = await apiFetch<{ expiresAt: string; demoCode?: string }>('/auth/otp/request', {
        method: 'POST',
        body: { destinationKind: 'email', destination: email, purpose },
      });
      setDemoCode(emailDemoCode);
      setStep('email-code');
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function verifyEmail(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const session = await apiFetch<SessionResponse>('/auth/otp/verify', {
        method: 'POST',
        body: { destinationKind: 'email', destination: email, purpose: emailPurpose, code },
      });
      setSession(session);
      if (session.principal.phoneVerified) {
        onVerified();
        return;
      }
      setCode('');
      const { demoCode: phoneDemoCode } = await apiFetch<{ expiresAt: string; demoCode?: string }>('/account/contact/verify-start', {
        method: 'POST',
        body: { destinationKind: 'phone', destination: phone },
      });
      setDemoCode(phoneDemoCode);
      setStep('phone-code');
    } catch (verifyError) {
      setError(verifyError instanceof ApiError ? verifyError.message : 'That code didn’t work. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function verifyPhone(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const session = await apiFetch<SessionResponse>('/auth/otp/verify', {
        method: 'POST',
        body: { destinationKind: 'phone', destination: phone, purpose: 'verify_phone', code },
      });
      setSession(session);
      onVerified();
    } catch (verifyError) {
      setError(verifyError instanceof ApiError ? verifyError.message : 'That code didn’t work. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (step === 'form') {
    return <form className="checkout-signin" onSubmit={startIdentity}>
      <label htmlFor="co-name">Your name</label>
      <input id="co-name" required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
      <label htmlFor="co-email">Email</label>
      <input id="co-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
      <label htmlFor="co-phone">Mobile number</label>
      <div className="signin-phone"><span>+91</span><input id="co-phone" type="tel" inputMode="numeric" pattern="[6-9][0-9]{9}" minLength={10} maxLength={10} required value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))} placeholder="10-digit mobile number" /></div>
      {error && <p role="alert" className="signin-error">{error}</p>}
      <button type="submit" className="booking-primary" disabled={busy}>Continue <ArrowRight size={16} /></button>
    </form>;
  }

  const verifyingPhone = step === 'phone-code';
  return <form className="checkout-signin" onSubmit={verifyingPhone ? verifyPhone : verifyEmail}>
    <label htmlFor="co-code">{verifyingPhone ? `Code sent to +91 ${phone}` : `Code sent to ${email}`}</label>
    <input id="co-code" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} required autoFocus value={code} onChange={(e) => { setCode(e.target.value.replace(/\D/g, '')); setError(''); }} placeholder="6-digit code" />
    {demoCode && <p className="signin-demo">Verification code: {demoCode}</p>}
    {error && <p role="alert" className="signin-error">{error}</p>}
    <button type="submit" className="booking-primary" disabled={busy}>Verify <ArrowRight size={16} /></button>
  </form>;
}
