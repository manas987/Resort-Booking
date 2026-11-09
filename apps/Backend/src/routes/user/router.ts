import { Router } from 'express';
import { authRouter } from './auth/routes.ts';
import { accountRouter } from './account/routes.ts';
import { contentRouter } from './content/routes.ts';
import { roomsRouter } from './rooms/routes.ts';
import { availabilityRouter } from './availability/routes.ts';
import { quotesRouter } from './quotes/routes.ts';
import { promosRouter } from './promos/routes.ts';
import { bookingsRouter } from './bookings/routes.ts';
import { paymentsRouter } from './payments/routes.ts';
import { enquiriesRouter } from './enquiries/routes.ts';
import { eventEnquiriesRouter } from './eventEnquiries/routes.ts';
import { analyticsRouter } from './analytics/routes.ts';

/**
 * The guest tree. Mounted at /api/user.
 *
 * Shares NO HTTP code with the admin tree — separate routers, schemas, controllers and auth
 * middleware, even where both read the same table. The one shared layer below HTTP is
 * src/core/. The separation greps in Docs/07-backend-structure.md prove it; they match import
 * paths, so nothing here may import across the trees.
 *
 * Resource folders arrive with their sub-phase (Docs/10-phase1-backend-guest.md). Mount in
 * the order listed there and nowhere else; the paths are already specified, don't invent any.
 *
 *   1D  auth  account        1E  content  rooms  availability
 *   1F  quotes  promos       1G  bookings
 *   1H  payments             1I  enquiries  enquiryMessages  eventEnquiries
 *   1J  analytics
 */
export const userRouter = Router();

userRouter.use('/auth', authRouter);
userRouter.use('/account', accountRouter);
userRouter.use('/content', contentRouter);
userRouter.use('/rooms', roomsRouter);
userRouter.use('/availability', availabilityRouter);
userRouter.use('/quotes', quotesRouter);
userRouter.use('/promos', promosRouter);
userRouter.use('/bookings', bookingsRouter);
userRouter.use('/payments', paymentsRouter);
userRouter.use('/enquiries', enquiriesRouter);
userRouter.use('/eventEnquiries', eventEnquiriesRouter);
userRouter.use('/analytics', analyticsRouter);
