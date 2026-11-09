import { Router } from 'express';
import { pool } from '../../../db.ts';
import { features } from '../../../env.ts';

export const healthRouter = Router();

/** Liveness: the process is up. Deliberately touches nothing else, so a database blip does
 *  not get the container killed and restarted into the same blip. */
healthRouter.get('/healthz', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
});

/** Readiness: this instance can serve traffic. Requires a working database round trip. */
healthRouter.get('/readyz', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    await pool.query('SELECT 1');
  } catch (err) {
    // The driver's message can carry the host, port and database name. It goes to the log
    // with the request id, never to the caller (INV-53, Docs/00-conventions.md).
    console.error(`[${res.locals.requestId}] readyz: database unreachable: ${(err as Error).message}`);
    res.status(503).json({ status: 'unavailable', checks: { database: 'down' } });
    return;
  }
  res.json({
    status: 'ready',
    checks: { database: 'up' },
    // `configured`, not `features` — these say what this instance is SET UP for, never what is
    // reachable. A present GEMINI_API_KEY proves nothing about the provider being up or
    // GEMINI_MODEL still existing, and reporting it next to a live `checks` block invited
    // exactly that misreading. A real provider call lives in scripts/preflight.ts: readiness
    // must stay cheap and must not depend on a third party or spend tokens on every poll.
    configured: features,
  });
});
