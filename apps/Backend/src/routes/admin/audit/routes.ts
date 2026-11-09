import { Router } from 'express';
import { requireOwner } from '../../../middleware/adminAuth.ts';
import { readAuditController } from './controllers.ts';

export const auditRouter = Router();

auditRouter.get('/', requireOwner, readAuditController);
