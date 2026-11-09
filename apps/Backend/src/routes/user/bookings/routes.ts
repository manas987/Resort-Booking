import { Router } from 'express';
import { requireGuest, requireVerifiedGuest } from '../../../middleware/userAuth.ts';
import { requireIdempotencyKey } from '../../../middleware/idempotency.ts';
import {
  createBookingController,
  readBookingsController,
  readBookingController,
  readBookingStatusController,
} from './controllers.ts';

export const bookingsRouter = Router();

bookingsRouter.post(
  '/',
  requireVerifiedGuest,
  requireIdempotencyKey('POST /api/user/bookings'),
  createBookingController,
);
bookingsRouter.get('/', requireGuest, readBookingsController);
bookingsRouter.get('/reference/:reference/status', requireGuest, readBookingStatusController);
bookingsRouter.get('/:bookingId', requireGuest, readBookingController);
