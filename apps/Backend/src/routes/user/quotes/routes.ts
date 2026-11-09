import { Router } from 'express';
import { POLICY } from '../../../core/policy.ts';
import { rateLimit } from '../../../middleware/rateLimit.ts';
import { optionalGuest } from '../../../middleware/userAuth.ts';
import { createQuoteController, readQuoteController } from './controllers.ts';

// Public and row-writing: every call persists a quote. Metered so it cannot be used to
// inflate the table for free.
const quotePerIp = rateLimit({
  name: 'quote-create-ip',
  windowSeconds: POLICY.publicRateLimits.windowSeconds,
  max: POLICY.publicRateLimits.quotePerIp,
});

export const quotesRouter = Router();

quotesRouter.post('/', quotePerIp, optionalGuest, createQuoteController);
quotesRouter.get('/:quoteId', optionalGuest, readQuoteController);
