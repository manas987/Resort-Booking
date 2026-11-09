import { Router } from 'express';
import { POLICY } from '../../../core/policy.ts';
import { rateLimit } from '../../../middleware/rateLimit.ts';
import { recordAnalyticsEventController } from './controllers.ts';

// Anonymous, unauthenticated and row-writing. Dedupe keys stop repeats of the SAME event,
// not a flood of distinct ones.
const analyticsPerIp = rateLimit({
  name: 'analytics-ip',
  windowSeconds: POLICY.publicRateLimits.windowSeconds,
  max: POLICY.publicRateLimits.analyticsPerIp,
});

export const analyticsRouter = Router();

analyticsRouter.post('/events', analyticsPerIp, recordAnalyticsEventController);
