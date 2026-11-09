import { Router } from 'express';
import { requireEmployee } from '../../../middleware/adminAuth.ts';
import { readBookingCalendarController } from './controllers.ts';

export const bookingCalendarRouter = Router();

bookingCalendarRouter.get('/', requireEmployee, readBookingCalendarController);
