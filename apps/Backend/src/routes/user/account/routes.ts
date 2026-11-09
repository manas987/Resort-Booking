import { Router } from 'express';
import { requireGuest } from '../../../middleware/userAuth.ts';
import { updateProfileController, startContactVerificationController } from './controllers.ts';

export const accountRouter = Router();

accountRouter.patch('/profile', requireGuest, updateProfileController);
accountRouter.post('/contact/verify-start', requireGuest, startContactVerificationController);
