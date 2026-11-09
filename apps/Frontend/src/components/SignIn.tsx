import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { CheckoutSignIn } from './CheckoutSignIn';

/**
 * `/signin` — the standalone sign-in page. Its visual shell is unchanged; what changed is
 * everything behind it.
 *
 * It used to run a self-contained demo: a hardcoded `123456` code from `data/signInDemo.ts`,
 * a hardcoded "existing guest" email, and a Google button that decoded the credential JWT in
 * the browser and trusted it. That last part is why this had to go — a token verified only by
 * the client is not authentication, and the backend already implements the redirect flow
 * properly. It also meant the app carried two unrelated notions of "signed in": this page's
 * local name string, and `lib/session.ts`'s real Principal that `/checkout` sets.
 *
 * Now there is one. The email/phone OTP flow is `CheckoutSignIn`, used verbatim rather than
 * reimplemented — it is the real `POST /auth/register` → `/auth/otp/request` →
 * `/auth/otp/verify` chain, and it verifies BOTH contacts, which is what `requireVerifiedGuest`
 * needs before a booking. Google is a full-page navigation to the backend, which ends at
 * `/auth/callback#accessToken=` (handled in `App.tsx`).
 */
export function SignIn({ onComplete, onBack }: { onComplete: () => void; onBack: () => void }) {
  const [googleError, setGoogleError] = useState('');

  function continueWithGoogle() {
    // A navigation, NOT a fetch: the backend answers with a 302 to Google and the whole point
    // is that the browser follows it. `fetch` would silently follow it in the background and
    // throw the redirect away. Docs/14-frontend-api-map.md spells this out.
    setGoogleError('');
    try {
      window.location.assign('/api/user/auth/google/start');
    } catch {
      setGoogleError('Google sign-in is unavailable right now. Please continue with your email.');
    }
  }

  return (
    <div className="signin-page">
      <div className="signin-visual">
        <div className="signin-visual-content">
          <span className="signin-brand">
            THE QUIET ESTATE <small>CHIKKAMAGALURU</small>
          </span>
          <p>
            A little closer
            <br />
            to quiet.
          </p>
        </div>
      </div>
      <div className="signin-side">
        <button type="button" className="signin-back" onClick={onBack}>
          <ArrowLeft size={16} /> Back
        </button>
        <div className="signin-content">
          <span className="signin-eyebrow">THE QUIET ESTATE</span>
          <h1>Come on in.</h1>
          <p className="signin-intro">Sign in or create an account to continue your stay.</p>

          <button type="button" className="signin-google" onClick={continueWithGoogle}>
            Continue with Google
          </button>
          {googleError && (
            <p className="signin-error" role="alert">
              {googleError}
            </p>
          )}
          <div className="signin-divider">
            <span>or continue with email</span>
          </div>

          <CheckoutSignIn onVerified={onComplete} />

          <p className="signin-footnote">A peaceful stay starts here.</p>
        </div>
      </div>
    </div>
  );
}
