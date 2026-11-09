/**
 * Migration runner. `bun run migrate`
 *
 * Numbered files in this folder are applied in filename order, each inside its own
 * transaction, each recorded in schema_migrations. Already-applied files are skipped, so a
 * second run is a no-op. Never invoked from an HTTP request.
 *
 * Flags:
 *   --status   list applied and pending migrations, change nothing
 */
import { readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { closePool, pool, withTransaction } from '../src/db.ts';

/** The SQL sits next to this runner, so no directory climbing and nothing to re-point. */
const MIGRATIONS_DIR = import.meta.dir;

const BOOTSTRAP = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version    text PRIMARY KEY,
    checksum   text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )
`;

async function listFiles(): Promise<string[]> {
  const entries = await readdir(MIGRATIONS_DIR);
  return entries.filter((f) => f.endsWith('.sql')).sort();
}

async function appliedVersions(): Promise<Map<string, string>> {
  const { rows } = await pool.query<{ version: string; checksum: string }>(
    'SELECT version, checksum FROM schema_migrations',
  );
  return new Map(rows.map((r) => [r.version, r.checksum]));
}

async function main(): Promise<void> {
  const statusOnly = process.argv.includes('--status');

  await pool.query(BOOTSTRAP);
  const files = await listFiles();
  const applied = await appliedVersions();

  if (statusOnly) {
    for (const file of files) {
      console.log(`${applied.has(file) ? 'applied ' : 'pending '} ${file}`);
    }
    return;
  }

  let count = 0;
  for (const file of files) {
    const sql = await Bun.file(join(MIGRATIONS_DIR, file)).text();
    const checksum = createHash('sha256').update(sql).digest('hex').slice(0, 16);
    const previous = applied.get(file);

    if (previous) {
      // An edited migration that has already run is a real problem: the database and the repo
      // now disagree. Refuse rather than guess.
      if (previous !== checksum) {
        throw new Error(
          `${file} has already been applied but its contents changed (${previous} -> ${checksum}). ` +
            `Add a new migration instead of editing an applied one.`,
        );
      }
      continue;
    }

    await withTransaction(async (tx) => {
      await tx.query(sql);
      await tx.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [
        file,
        checksum,
      ]);
    });
    console.log(`applied ${file}`);
    count += 1;
  }

  console.log(count === 0 ? 'up to date' : `${count} migration(s) applied`);
}

try {
  await main();
} catch (err) {
  console.error(`migration failed: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  await closePool();
}
