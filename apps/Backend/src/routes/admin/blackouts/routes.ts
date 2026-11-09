import { Router } from 'express';
import { requireGm } from '../../../middleware/adminAuth.ts';
import { readBlackoutsController, previewBlackoutChangeController, applyBlackoutController, removeBlackoutController } from './controllers.ts';

export const blackoutsRouter = Router();

blackoutsRouter.get('/', requireGm, readBlackoutsController);
blackoutsRouter.post('/preview', requireGm, previewBlackoutChangeController);
blackoutsRouter.put('/', requireGm, applyBlackoutController);
blackoutsRouter.delete('/', requireGm, removeBlackoutController);
