import { Router } from 'express';
import { requireOwner } from '../../../middleware/adminAuth.ts';
import { readMetricsController, readFunnelController } from './controllers.ts';

export const reportsRouter = Router();

reportsRouter.get('/metrics', requireOwner, readMetricsController);
reportsRouter.get('/funnel', requireOwner, readFunnelController);
