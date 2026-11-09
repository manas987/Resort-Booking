import { Router } from 'express';
import { requireEmployee } from '../../../middleware/adminAuth.ts';
import { readBookingsController, readBookingController } from './controllers.ts';

export const bookingsRouter = Router();

bookingsRouter.get('/', requireEmployee, readBookingsController);
bookingsRouter.get('/:bookingId', requireEmployee, readBookingController);
