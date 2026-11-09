import { Router } from 'express';
import { demoOnly } from '../../../middleware/demoOnly.ts';
import { injectInboundController } from './controllers.ts';

export const mockRouter = Router();

// systemRouter mounts at root (same as /healthz) — the spec's path is /api/mock/..., so the
// /api prefix lives here, not in the mount.
mockRouter.post('/api/mock/inbound/:channel', demoOnly, injectInboundController);
