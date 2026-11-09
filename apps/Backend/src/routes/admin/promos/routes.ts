import { Router } from 'express';
import { requireGm } from '../../../middleware/adminAuth.ts';
import { readPromosController, createPromoController, updatePromoController, readPromoRedemptionsController } from './controllers.ts';

export const promosRouter = Router();

promosRouter.get('/', requireGm, readPromosController);
promosRouter.post('/', requireGm, createPromoController);
promosRouter.patch('/:promoId', requireGm, updatePromoController);
promosRouter.get('/:promoId/redemptions', requireGm, readPromoRedemptionsController);
