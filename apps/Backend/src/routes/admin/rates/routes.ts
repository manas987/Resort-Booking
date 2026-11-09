import { Router } from 'express';
import { requireGm } from '../../../middleware/adminAuth.ts';
import {
  readRatesController,
  updateBasePriceController,
  previewRateChangeController,
  applyRateOverrideController,
  removeRateOverrideController,
  readRateHistoryController,
} from './controllers.ts';

export const ratesRouter = Router();

ratesRouter.get('/', requireGm, readRatesController);
ratesRouter.get('/history', requireGm, readRateHistoryController);
ratesRouter.patch('/room-types/:roomTypeId', requireGm, updateBasePriceController);
ratesRouter.post('/preview', requireGm, previewRateChangeController);
ratesRouter.put('/', requireGm, applyRateOverrideController);
ratesRouter.delete('/', requireGm, removeRateOverrideController);
