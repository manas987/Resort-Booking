import type { Request } from 'express';
import { Router } from 'express';
import { POLICY } from '../../../core/policy.ts';
import { rateLimit } from '../../../middleware/rateLimit.ts';
import { optionalGuest, requireGuest } from '../../../middleware/userAuth.ts';
import {
  registerGuestController,
  requestOtpController,
  verifyOtpController,
  startGoogleController,
  googleCallbackController,
  refreshSessionController,
  logoutController,
  readMeController,
} from './controllers.ts';

export const authRouter = Router();

function destinationKey(request: Request): string | null {
  const destination = (request.body as { destination?: unknown } | undefined)?.destination;
  return typeof destination === 'string' ? destination.trim().toLowerCase() : null;
}

// Per-destination AND per-IP, per Docs/10-phase1-backend-guest.md. One 60s code-resend
// cooldown lives inside otp.ts itself; this is the request-rate ceiling around it.
// Numbers come from POLICY.otp — they are business limits, not route trivia (INV-59).
const otpRequestPerDestination = rateLimit({
  name: 'otp-request-destination',
  windowSeconds: POLICY.otp.requestWindowSeconds,
  max: POLICY.otp.maxRequestsPerDestination,
  key: destinationKey,
});
const otpRequestPerIp = rateLimit({
  name: 'otp-request-ip',
  windowSeconds: POLICY.otp.requestWindowSeconds,
  max: POLICY.otp.maxRequestsPerIp,
});
// The 5-attempt lock in otp.ts protects a single challenge. This stops one caller sweeping
// codes across many challenges from the same address.
const otpVerifyPerIp = rateLimit({
  name: 'otp-verify-ip',
  windowSeconds: POLICY.otp.requestWindowSeconds,
  max: POLICY.otp.maxVerifyPerIp,
});
// Unauthenticated and account-creating: unmetered, one address could mint rows indefinitely.
const registerPerIp = rateLimit({
  name: 'register-ip',
  windowSeconds: POLICY.publicRateLimits.windowSeconds,
  max: POLICY.publicRateLimits.registerPerIp,
});
// Unauthenticated: takes a bearer refresh credential, so it must not be a free guessing loop.
const refreshPerIp = rateLimit({
  name: 'user-refresh-ip',
  windowSeconds: POLICY.publicRateLimits.windowSeconds,
  max: POLICY.publicRateLimits.refreshPerIp,
});

authRouter.post('/register', registerPerIp, registerGuestController);
authRouter.post('/otp/request', otpRequestPerIp, otpRequestPerDestination, requestOtpController);
authRouter.post('/otp/verify', otpVerifyPerIp, optionalGuest, verifyOtpController);
authRouter.get('/google/start', startGoogleController);
authRouter.get('/google/callback', googleCallbackController);
authRouter.post('/refresh', refreshPerIp, refreshSessionController);
authRouter.post('/logout', logoutController);
authRouter.get('/me', requireGuest, readMeController);
