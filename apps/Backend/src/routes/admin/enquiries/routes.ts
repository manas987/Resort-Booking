import { Router } from 'express';
import { requireEmployee } from '../../../middleware/adminAuth.ts';
import {
  readEnquiriesController,
  readEnquiryCountsController,
  readEnquiryController,
  markEnquiryReadController,
  updateEnquiryCategoryController,
  updateEnquiryStatusController,
} from './controllers.ts';

export const enquiriesRouter = Router();

enquiriesRouter.get('/', requireEmployee, readEnquiriesController);
enquiriesRouter.get('/counts', requireEmployee, readEnquiryCountsController);
enquiriesRouter.get('/:enquiryId', requireEmployee, readEnquiryController);
enquiriesRouter.post('/:enquiryId/read', requireEmployee, markEnquiryReadController);
enquiriesRouter.patch('/:enquiryId/category', requireEmployee, updateEnquiryCategoryController);
enquiriesRouter.patch('/:enquiryId/status', requireEmployee, updateEnquiryStatusController);
