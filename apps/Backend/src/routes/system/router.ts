import { Router } from 'express';
import { healthRouter } from './health/routes.ts';
import { mockRouter } from './mock/routes.ts';

/**
 * Root-level routes belonging to neither tree: liveness, readiness, and (from 1I) the
 * demo-gated mock inbound-message injector behind middleware/demoOnly.
 */
export const systemRouter = Router();

systemRouter.use(healthRouter);
systemRouter.use(mockRouter);
