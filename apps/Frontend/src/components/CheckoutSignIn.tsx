import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight } from 'lucide-react';
import { apiFetch, ApiError } from '../lib/api';
import { getAccessToken, setSession, usePrincipal } from '../lib/session';
import type { Principal } from '../lib/types';
import { LoadingSkeleton } from './LoadingSkeleton';

type Step = 'email' | 'email-code' | 'phone' | 'phone-code' | 'name' | 'loading';
type SessionResponse = { accessToken: string; principal: Principal; needsOnboarding?: boolean };
type Identity = { needsOnboarding: boolean; profile: { name: string; email: string | null; phone: string | null } };

/** Email ownership is established before account lookup or onboarding. */
export function CheckoutSignIn({ onVerified, verificationOnly = false }: { onVerified: () => void; verificationOnly?: boolean }) {
  const principal = usePrincipal();
  const [step, setStep] = useState<Step>(principal ? 'loading' : 'email');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [needsName, setNeedsName] = useState(false);
  const [demoCode, setDemoCode] = useState<string>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!principal) return;
    let cancelled = false;
    apiFetch<Identity>('/auth/me').then((identity) => {
      if (cancelled) return;
      setName(identity.profile.name === 'Guest' ? '' : identity.profile.name);
      setEmail(identity.profile.email ?? '');
      setPhone((identity.profile.phone ?? '').replace(/^\+91/, ''));
      setNeedsName(identity.needsOnboarding);
      if (!principal.emailVerified) setStep('email');
      else if (!principal.phoneVerified && (identity.needsOnboarding || verificationOnly)) setStep('phone');
      else if (identity.needsOnboarding) setStep('name');
      else onVerified();
    }).catch(() => { if (!cancelled) { setError('Could not load your account. Please try again.'); setStep('email'); } });
    return () => { cancelled = true; };
    // Contact verification updates the session during this flow; do not reset its current step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      if (step === 'email') {
        const result = await apiFetch<{ demoCode?: string }>('/auth/otp/request', { method: 'POST',
          body: { destinationKind: 'email', destination: email.trim(), purpose: 'guest_login' } });
        setDemoCode(result.demoCode); setCode(''); setStep('email-code');
      } else if (step === 'email-code') {
        const session = await apiFetch<SessionResponse>('/auth/otp/verify', { method: 'POST',
          body: { destinationKind: 'email', destination: email.trim(), purpose: 'guest_login', code } });
        setSession(session); setNeedsName(!!session.needsOnboarding);
        if (session.needsOnboarding || (verificationOnly && !session.principal.phoneVerified)) setStep('phone');
        else onVerified();
      } else if (step === 'phone') {
        const result = await apiFetch<{ demoCode?: string }>('/account/contact/verify-start', { method: 'POST',
          body: { destinationKind: 'phone', destination: '+91' + phone } });
        setDemoCode(result.demoCode); setCode(''); setStep('phone-code');
      } else if (step === 'phone-code') {
        const session = await apiFetch<SessionResponse>('/auth/otp/verify', { method: 'POST',
          body: { destinationKind: 'phone', destination: '+91' + phone, purpose: 'verify_phone', code } });
        setSession(session);
        if (needsName) setStep('name'); else onVerified();
      } else if (step === 'name') {
        await apiFetch('/account/profile', { method: 'PATCH', body: { name: name.trim() } });
        const accessToken = getAccessToken();
        if (accessToken && principal) setSession({ accessToken, principal: { ...principal, onboardingComplete: true } });
        onVerified();
      }
    } catch (failure) { setError(failure instanceof ApiError ? failure.message : 'Could not continue. Please try again.'); }
    finally { setBusy(false); }
  }

  if (step === 'loading') return <LoadingSkeleton label="Checking your account…" />;
  const verifying = step === 'email-code' || step === 'phone-code';
  return <form className="checkout-signin" onSubmit={submit}>
    {step === 'email' && <><label htmlFor="co-email">Email address</label>
      <input id="co-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></>}
    {step === 'phone' && <><label htmlFor="co-phone">Verify your mobile number</label>
      <div className="signin-phone"><span>+91</span><input id="co-phone" type="tel" autoComplete="tel-national" inputMode="numeric" pattern="[0-9]{10}" required minLength={10} maxLength={10} value={phone} onChange={(event) => setPhone(event.target.value.replace(/\D/g, ''))} placeholder="10-digit mobile number" /></div></>}
    {verifying && <><label htmlFor="co-code">{step === 'email-code' ? 'Code sent to ' + email : 'Code sent to +91 ' + phone}</label>
      <input id="co-code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" required minLength={6} maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} placeholder="6-digit code" />
      {demoCode && <p className="signin-demo">Verification code: {demoCode}</p>}</>}
    {step === 'name' && <><label htmlFor="co-name">Your name</label><input id="co-name" autoComplete="name" required maxLength={200} value={name} onChange={(event) => setName(event.target.value)} placeholder="Full name" /></>}
    {error && <p className="signin-error" role="alert">{error}</p>}
    {verifying && <button type="button" className="room-inline-link" disabled={busy} onClick={() => { setCode(''); setError(''); setStep(step === 'email-code' ? 'email' : 'phone'); }}>Change details or request a new code</button>}
    <button type="submit" className="booking-primary" disabled={busy}>{busy ? 'Please wait…' : verifying ? 'Verify' : step === 'name' ? 'Confirm and continue' : 'Continue'}<ArrowRight size={16} /></button>
  </form>;
}
