import { Router } from 'express';
import { readResortContentController } from './controllers.ts';

export const contentRouter = Router();

contentRouter.get('/', readResortContentController);
