import { Router } from 'express';
import { requireGm } from '../../../middleware/adminAuth.ts';
import {
  readStaffController,
  createStaffController,
  updateStaffController,
  disableStaffController,
  enableStaffController,
} from './controllers.ts';

export const staffRouter = Router();

staffRouter.get('/', requireGm, readStaffController);
staffRouter.post('/', requireGm, createStaffController);
staffRouter.patch('/:targetUserId', requireGm, updateStaffController);
staffRouter.post('/:targetUserId/disable', requireGm, disableStaffController);
staffRouter.post('/:targetUserId/enable', requireGm, enableStaffController);
