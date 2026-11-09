import { Router } from 'express';
import { requireGm } from '../../../middleware/adminAuth.ts';
import {
  readInventoryController,
  updateBaseAllotmentController,
  previewAllotmentChangeController,
  applyAllotmentOverrideController,
  removeAllotmentOverrideController,
} from './controllers.ts';

export const inventoryRouter = Router();

inventoryRouter.get('/', requireGm, readInventoryController);
inventoryRouter.patch('/room-types/:roomTypeId', requireGm, updateBaseAllotmentController);
inventoryRouter.post('/preview', requireGm, previewAllotmentChangeController);
inventoryRouter.put('/', requireGm, applyAllotmentOverrideController);
inventoryRouter.delete('/', requireGm, removeAllotmentOverrideController);
