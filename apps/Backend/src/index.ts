import { createApp } from './app.ts';
import { env, features } from './env.ts';
import { closePool, pool } from './db.ts';

const app = createApp();
const server = app.listen(env.PORT, () => {
  console.log(`[api] listening on :${env.PORT} (${env.NODE_ENV})`);
  console.log(`[api] google sign-in: ${features.googleSignIn ? 'configured' : 'NOT configured'}`);
  console.log(`[api] ai: ${features.ai ? `configured (${env.GEMINI_MODEL})` : 'NOT configured'}`);
});

/**
 * Graceful shutdown: stop accepting connections, let in-flight requests finish, then close
 * the pool. Without this, a deploy can kill a request mid-transaction.
 */
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[api] ${signal} received, draining`);

  const forced = setTimeout(() => {
    console.error('[api] drain timed out after 10s, exiting');
    process.exit(1);
  }, 10_000);
  forced.unref();

  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closePool();
  clearTimeout(forced);
  console.log('[api] stopped');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

// A startup probe, so a bad DATABASE_URL surfaces at boot rather than on first request.
try {
  await pool.query('SELECT 1');
  console.log('[api] database reachable');
} catch (err) {
  console.error(`[api] database unreachable: ${(err as Error).message}`);
}
