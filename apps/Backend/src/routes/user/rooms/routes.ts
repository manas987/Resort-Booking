import { Router } from 'express';
import { readRoomsController, readRoomBySlugController } from './controllers.ts';

export const roomsRouter = Router();

roomsRouter.get('/', readRoomsController);
roomsRouter.get('/:slug', readRoomBySlugController);
