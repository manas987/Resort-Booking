import { Router } from 'express';
import { requireGuest } from '../../../middleware/userAuth.ts';
import {
  createEnquiryController,
  readEnquiriesController,
  readEnquiryController,
  createBookingEnquiryController,
} from './controllers.ts';
import { sendEnquiryMessageController } from '../enquiryMessages/controllers.ts';

export const enquiriesRouter = Router();

enquiriesRouter.post('/', requireGuest, createEnquiryController);
enquiriesRouter.get('/', requireGuest, readEnquiriesController);
enquiriesRouter.post('/from-booking/:bookingId', requireGuest, createBookingEnquiryController);
// The feature folders stay separate (enquiries/ vs enquiryMessages/, per
// Docs/07-backend-structure.md's one-folder-per-resource rule), but the path itself is
// nested under /enquiries exactly as Docs/10-phase1-backend-guest.md's route table lists it.
enquiriesRouter.post('/:enquiryId/messages', requireGuest, sendEnquiryMessageController);
enquiriesRouter.get('/:enquiryId', requireGuest, readEnquiryController);
