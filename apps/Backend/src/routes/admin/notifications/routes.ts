import { Router } from 'express';
import { requireEmployee } from '../../../middleware/adminAuth.ts';
import { readNotificationsController, markNotificationReadController } from './controllers.ts';

export const notificationsRouter = Router();

notificationsRouter.get('/', requireEmployee, readNotificationsController);
notificationsRouter.post('/:notificationId/read', requireEmployee, markNotificationReadController);
