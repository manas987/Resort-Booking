import { Router } from 'express';
import { requireGm } from '../../../middleware/adminAuth.ts';
import { readResortInfoController, publishResortInfoController } from './controllers.ts';

export const resortInfoRouter = Router();

resortInfoRouter.get('/', requireGm, readResortInfoController);
resortInfoRouter.put('/', requireGm, publishResortInfoController);
