import { Router } from 'express';
import { POLICY } from '../../../core/policy.ts';
import { rateLimit } from '../../../middleware/rateLimit.ts';
import { validatePromoController } from './controllers.ts';

/** The tightest public limiter in the app, and the reason `publicRateLimits` exists:
 *  this endpoint answers "is this a real promo code, and what is it worth" for any string,
 *  with no account. Unmetered, it hands an attacker the whole promo namespace and every
 *  discount value in it. */
const promoCheckPerIp = rateLimit({
  name: 'promo-validate-ip',
  windowSeconds: POLICY.publicRateLimits.windowSeconds,
  max: POLICY.publicRateLimits.promoCheckPerIp,
});

export const promosRouter = Router();

promosRouter.post('/validate', promoCheckPerIp, validatePromoController);
