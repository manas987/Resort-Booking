import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import { env } from './env.ts';

/**
 * `pg` is used rather than Bun's SQL because the reservation path needs an explicitly
 * checked-out client held for the life of one transaction (Docs/Product.md §22).
 *
 * Money arrives as BIGINT. `pg` returns BIGINT as a string to avoid silent precision loss,
 * which is the right default but awkward everywhere, so it is parsed back to a number here.
 * Safe: paise amounts stay far below Number.MAX_SAFE_INTEGER (₹1 crore is 10⁹ paise).
 */
import pgTypes from 'pg';

const BIGINT_OID = 20;
const NUMERIC_OID = 1700;
const DATE_OID = 1082;

pgTypes.types.setTypeParser(BIGINT_OID, (v) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new Error(`BIGINT ${v} exceeds safe integer range`);
  return n;
});
pgTypes.types.setTypeParser(NUMERIC_OID, (v) => Number(v));
/** A DATE is a calendar date, never a moment. Keep it as `YYYY-MM-DD`, never a JS Date. */
pgTypes.types.setTypeParser(DATE_OID, (v) => v);

const connectionString =
  env.NODE_ENV === 'test' ? (env.TEST_DATABASE_URL ?? env.DATABASE_URL) : env.DATABASE_URL;

if (env.NODE_ENV === 'test' && !env.TEST_DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL must be set when NODE_ENV=test — tests are destructive.');
}

export const pool = new Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  // A query that has not finished in 15s is not going to; fail rather than hold a connection.
  statement_timeout: 15_000,
  query_timeout: 15_000,
});

pool.on('error', (err) => {
  // An idle client erroring is not fatal — log and let the pool replace it.
  console.error('[db] idle client error', err.message);
});

export async function closePool(): Promise<void> {
  await pool.end();
}


/** The handle a transaction body gets. Deliberately not the full PoolClient: a transaction
 *  body has no business calling `release()` or starting a nested transaction. */
export type Tx = Pick<PoolClient, 'query'>;

/**
 * Runs `body` inside a single transaction on **one** checked-out client, then commits.
 * Rolls back and rethrows on any error. Always releases the client.
 *
 * Why this exists rather than ad-hoc `pool.query` calls: `pool.query` may hand each statement
 * a different connection, so a `BEGIN` issued that way does not wrap the statements that
 * follow, and `SELECT ... FOR UPDATE` locks would be taken and dropped immediately. Every
 * multi-statement write goes through here.
 *
 * Rules (see apps/Backend/CLAUDE.md):
 *  - never make a network call inside the body — no AI call, no payment wait, no sleep;
 *  - take row locks in a documented, consistent order;
 *  - keep the body short. Locks are held until commit.
 */
export async function withTransaction<T>(body: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await body(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      // The connection is likely already broken; the original error is the useful one.
      console.error('[db] rollback failed', (rollbackErr as Error).message);
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Postgres error codes we branch on by name instead of by string matching. */
export const PG = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  CHECK_VIOLATION: '23514',
  SERIALIZATION_FAILURE: '40001',
  DEADLOCK_DETECTED: '40P01',
  LOCK_NOT_AVAILABLE: '55P03',
} as const;

export function isPgError(err: unknown, code: string): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === code;
}

/**
 * Runs `body` inside a SAVEPOINT so that an error the caller intends to catch does not leave
 * the surrounding transaction aborted. In Postgres *any* failed statement aborts the whole
 * transaction — every statement after it fails with `25P02` — so a retry-on-collision loop
 * (a random booking reference or enquiry ref hitting its unique index, per
 * Docs/01-data-model.md) cannot recover without this. The savepoint name is generated here
 * from hex only and never comes from a request, so interpolating it is safe.
 */
export async function withSavepoint<T>(client: Tx, body: () => Promise<T>): Promise<T> {
  const name = `sp_${randomUUID().replaceAll('-', '')}`;
  await client.query(`SAVEPOINT ${name}`);
  try {
    const result = await body();
    await client.query(`RELEASE SAVEPOINT ${name}`);
    return result;
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
    throw error;
  }
}
