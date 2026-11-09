import { Router } from 'express';
import { requireEmployee } from '../../../middleware/adminAuth.ts';
import { sendEnquiryReplyController, createInternalNoteController } from './controllers.ts';

export const enquiryMessagesRouter = Router();

enquiryMessagesRouter.post('/:enquiryId', requireEmployee, sendEnquiryReplyController);
enquiryMessagesRouter.post('/:enquiryId/notes', requireEmployee, createInternalNoteController);
