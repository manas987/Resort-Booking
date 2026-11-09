import { Router } from 'express';
import { requireEmployee } from '../../../middleware/adminAuth.ts';
import { readRoomsController, readRoomController } from './controllers.ts';

export const roomsRouter = Router();

roomsRouter.get('/', requireEmployee, readRoomsController);
roomsRouter.get('/:roomTypeId', requireEmployee, readRoomController);
