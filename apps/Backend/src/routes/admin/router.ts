import { Router } from 'express';
import { authRouter } from './auth/routes.ts';
import { staffRouter } from './staff/routes.ts';
import { enquiriesRouter } from './enquiries/routes.ts';
import { notificationsRouter } from './notifications/routes.ts';
import { enquiryMessagesRouter } from './enquiryMessages/routes.ts';
import { enquiryAssignmentRouter } from './enquiryAssignment/routes.ts';
import { enquiryDraftsRouter } from './enquiryDrafts/routes.ts';
import { roomsRouter } from './rooms/routes.ts';
import { bookingsRouter } from './bookings/routes.ts';
import { bookingCalendarRouter } from './bookingCalendar/routes.ts';
import { exportsRouter } from './exports/routes.ts';
import { ratesRouter } from './rates/routes.ts';
import { inventoryRouter } from './inventory/routes.ts';
import { blackoutsRouter } from './blackouts/routes.ts';
import { promosRouter } from './promos/routes.ts';
import { resortInfoRouter } from './resortInfo/routes.ts';
import { reportsRouter } from './reports/routes.ts';
import { auditRouter } from './audit/routes.ts';

/**
 * The staff / GM / owner tree. Mounted at /api/admin.
 *
 * Shares NO HTTP code with the guest tree; see Docs/07-backend-structure.md for the greps
 * that prove it. Guards come from Docs/02-permissions.md and are enforced per route — hidden
 * navigation is never a control (INV-33).
 *
 * Resource folders arrive with their sub-phase (Docs/11-phase2-backend-staff.md):
 *
 *   2A  auth  staff                        2B  enquiries  notifications
 *   2C  enquiryMessages  enquiryAssignment 2D  enquiryDrafts
 *   2E  rooms  bookings  bookingCalendar  exports
 *   2F  rates  inventory  blackouts        2G  promos  resortInfo
 *   2H  reports  audit
 */
export const adminRouter = Router();

adminRouter.use('/auth', authRouter);
adminRouter.use('/staff', staffRouter);
adminRouter.use('/enquiries', enquiriesRouter);
adminRouter.use('/notifications', notificationsRouter);
adminRouter.use('/enquiryMessages', enquiryMessagesRouter);
adminRouter.use('/enquiryAssignment', enquiryAssignmentRouter);
adminRouter.use('/enquiryDrafts', enquiryDraftsRouter);
adminRouter.use('/rooms', roomsRouter);
adminRouter.use('/bookings', bookingsRouter);
adminRouter.use('/bookingCalendar', bookingCalendarRouter);
adminRouter.use('/exports', exportsRouter);
adminRouter.use('/rates', ratesRouter);
adminRouter.use('/inventory', inventoryRouter);
adminRouter.use('/blackouts', blackoutsRouter);
adminRouter.use('/promos', promosRouter);
adminRouter.use('/resortInfo', resortInfoRouter);
adminRouter.use('/reports', reportsRouter);
adminRouter.use('/audit', auditRouter);
