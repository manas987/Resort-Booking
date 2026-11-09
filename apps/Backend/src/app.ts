import express from 'express';
import { POLICY } from './core/policy.ts';
import { cors } from './middleware/cors.ts';
import { errorHandler, notFoundHandler } from './middleware/errors.ts';
import { requestId } from './middleware/requestId.ts';
import { apiRouter } from './router.ts';

/**
 * App assembly only. Listening lives in index.ts so tests can import the app without binding
 * a port. Middleware order below is deliberate — see the comments; do not reorder it.
 */
export function createApp() {
  const app = express();

  // Railway and Vercel sit in front of this; trust exactly one proxy hop so req.ip and
  // req.protocol are the client's, not the proxy's. Rate limiting depends on this being right.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // First, so even a body-parser rejection or a 404 carries a request id in its envelope.
  app.use(requestId);
  app.use(cors);
  // Bounded body size: nothing this API accepts is large, and an unbounded parser is a free
  // denial-of-service. A rejection here is translated by errorHandler, not left as a 500.
  app.use(express.json({ limit: POLICY.bodyLimitBytes }));

  app.use(apiRouter);

  // Last two, in this order. notFoundHandler turns an unmatched path into an AppError so it
  // leaves through the same envelope as everything else.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
