import { Router } from 'express';
import { readAvailabilityController, readAvailabilityCalendarController } from './controllers.ts';

export const availabilityRouter = Router();

// /calendar before '/' — both are GET on this router, and an Express route with no params
// would otherwise never shadow it, but matching order is still explicit here on purpose.
availabilityRouter.get('/calendar', readAvailabilityCalendarController);
availabilityRouter.get('/', readAvailabilityController);
