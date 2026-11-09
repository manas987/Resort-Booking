import type { NextFunction, Request, Response } from 'express';
import { env } from '../env.ts';
import { AppError } from './errors.ts';

/** Gates routes that only make sense for a reviewer demo — never live in a real deployment. */
export function demoOnly(_request: Request, _response: Response, next: NextFunction): void {
  if (!env.DEMO_MODE) {
    next(new AppError('feature_unavailable', 'This endpoint is only available in demo mode.'));
    return;
  }
  next();
}
