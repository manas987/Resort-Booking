import type { Request } from 'express';
import { Router } from 'express';
import { rateLimit } from '../../../middleware/rateLimit.ts';
import { requireEmployee } from '../../../middleware/adminAuth.ts';
import { POLICY } from '../../../core/policy.ts';
import {
  loginEmployeeController,
  loginEmployeeGoogleController,
  refreshEmployeeSessionController,
  logoutEmployeeController,
  readMeController,
} from './controllers.ts';

export const authRouter = Router();

function usernameKey(request: Request): string | null {
  const username = (request.body as { username?: unknown } | undefined)?.username;
  return typeof username === 'string' ? username.trim().toLowerCase() : null;
}

// Hard rate limit per account AND per IP, per Docs/11-phase2-backend-staff.md 2A and §7's
// "rate limits, especially on staff login". Numbers live in core/policy.ts (INV-59).
const loginPerAccount = rateLimit({
  name: 'admin-login-account',
  windowSeconds: POLICY.employeeLogin.windowSeconds,
  max: POLICY.employeeLogin.maxPerAccount,
  key: usernameKey,
});
const loginPerIp = rateLimit({
  name: 'admin-login-ip',
  windowSeconds: POLICY.employeeLogin.windowSeconds,
  max: POLICY.employeeLogin.maxPerIp,
});

// The Google path is a second door into the same employee accounts, so it gets the same
// per-IP ceiling as the password path — a limiter on /login alone just moves the attempt here.
const googlePerIp = rateLimit({
  name: 'admin-google-ip',
  windowSeconds: POLICY.employeeLogin.windowSeconds,
  max: POLICY.employeeLogin.maxPerIp,
});
const refreshPerIp = rateLimit({
  name: 'admin-refresh-ip',
  windowSeconds: POLICY.publicRateLimits.windowSeconds,
  max: POLICY.publicRateLimits.refreshPerIp,
});

authRouter.post('/login', loginPerIp, loginPerAccount, loginEmployeeController);
authRouter.post('/google', googlePerIp, loginEmployeeGoogleController);
authRouter.post('/refresh', refreshPerIp, refreshEmployeeSessionController);
authRouter.post('/logout', logoutEmployeeController);
authRouter.get('/me', requireEmployee, readMeController);
