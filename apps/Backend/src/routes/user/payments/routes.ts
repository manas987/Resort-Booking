import { Router } from 'express';
import { requireVerifiedGuest } from '../../../middleware/userAuth.ts';
import { requireIdempotencyKey } from '../../../middleware/idempotency.ts';
import { createPaymentAttemptController } from './controllers.ts';

export const paymentsRouter = Router();

paymentsRouter.post(
  '/:bookingId/attempts',
  requireVerifiedGuest,
  requireIdempotencyKey('POST /api/user/payments/:bookingId/attempts'),
  createPaymentAttemptController,
);
