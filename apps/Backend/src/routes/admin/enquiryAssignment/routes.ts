import { Router } from 'express';
import { requireEmployee, requireGm } from '../../../middleware/adminAuth.ts';
import { readAssignableEmployeesController, assignEnquiryController, claimEnquiryController } from './controllers.ts';

export const enquiryAssignmentRouter = Router();

enquiryAssignmentRouter.get('/assignable', requireEmployee, readAssignableEmployeesController);
enquiryAssignmentRouter.post('/:enquiryId/assign', requireGm, assignEnquiryController);
enquiryAssignmentRouter.post('/:enquiryId/claim', requireEmployee, claimEnquiryController);
