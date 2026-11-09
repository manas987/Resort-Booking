/**
 * Real-concurrency barrier for oversell-style tests. Two sequential `await`s are not
 * concurrent and will pass against code that oversells — see Docs/09-test-harness.md.
 */
import type { Tx } from '../../src/db.ts';
import { extraPool } from './db.ts';

type Settled<T> = { status: 'ok'; value: T } | { status: 'error'; error: unknown };

/** Runs `bodies.length` transactions that all reach a barrier before any proceeds past it,
 *  so the contended section genuinely overlaps. Each body gets its own checked-out client. */
export async function runConcurrently<T>(
  bodies: Array<(client: Tx, barrier: () => Promise<void>) => Promise<T>>,
): Promise<Array<Settled<T>>> {
  const pool = extraPool();
  let arrived = 0;
  let resolveBarrier: () => void;
  const everyoneArrived = new Promise<void>((resolve) => {
    resolveBarrier = resolve;
  });
  const barrier = async (): Promise<void> => {
    arrived += 1;
    if (arrived === bodies.length) resolveBarrier();
    await everyoneArrived;
  };

  try {
    const settled = await Promise.allSettled(
      bodies.map(async (body) => {
        const client = await pool.connect();
        try {
          return await body(client, barrier);
        } finally {
          client.release();
        }
      }),
    );
    return settled.map((r) =>
      r.status === 'fulfilled' ? { status: 'ok' as const, value: r.value } : { status: 'error' as const, error: r.reason },
    );
  } finally {
    await pool.end();
  }
}
