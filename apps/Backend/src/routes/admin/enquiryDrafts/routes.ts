import { Router } from 'express';
import { requireEmployee } from '../../../middleware/adminAuth.ts';
import { generateEnquiryDraftController, retryEnquiryAiController } from './controllers.ts';

export const enquiryDraftsRouter = Router();

enquiryDraftsRouter.post('/:enquiryId', requireEmployee, generateEnquiryDraftController);
enquiryDraftsRouter.post('/:enquiryId/retry', requireEmployee, retryEnquiryAiController);
