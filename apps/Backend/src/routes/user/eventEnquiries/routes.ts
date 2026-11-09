import { Router } from 'express';
import { requireGuest } from '../../../middleware/userAuth.ts';
import { createEventEnquiryController } from './controllers.ts';

export const eventEnquiriesRouter = Router();

eventEnquiriesRouter.post('/', requireGuest, createEventEnquiryController);
