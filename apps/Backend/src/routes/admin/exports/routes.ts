import { Router } from 'express';
import { requireExporter } from '../../../middleware/adminAuth.ts';
import { exportBookingsCsvController } from './controllers.ts';

export const exportsRouter = Router();

exportsRouter.get('/bookings.csv', requireExporter, exportBookingsCsvController);
