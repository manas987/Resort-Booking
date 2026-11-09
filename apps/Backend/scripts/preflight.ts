/**
 * `bun run preflight` — proves the environment before a sub-phase trusts it.
 *
 * It exists because a dead credential discovered in 2D is fifteen sub-phases of work built on
 * an assumption. Run it at the start of 1B and again before 2D. It makes ONE real Gemini call;
 * everything else is local.
 *
 * Reads no secrets into its output: it prints whether something works, never the value.
 */
import { GoogleGenAI } from '@google/genai';
import { Pool } from 'pg';
import { env, features } from '../src/env.ts';

type Check = { name: string; ok: boolean; detail: string; fatal: boolean };
const checks: Check[] = [];
const add = (name: string, ok: boolean, detail: string, fatal = true) =>
  checks.push({ name, ok, detail, fatal });

/** Is the database reachable, and has 001_init been applied to it? */
async function checkDatabase(label: string, url: string): Promise<void> {
  const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 5_000 });
  try {
    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const tables = rows[0]?.n ?? 0;
    // Ask whether the table exists rather than querying it and catching the failure — a
    // caught query error still surfaces as driver noise above the results.
    const { rows: present } = await pool.query<{ exists: boolean }>(
      `SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists`,
    );
    const migrated = present[0]?.exists
      ? await pool
          .query<{ version: string }>('SELECT version FROM schema_migrations ORDER BY version')
          .then((r) => r.rows.map((x) => x.version))
      : [];

    if (migrated.length === 0) {
      add(label, false, `reachable, but no migrations applied — run: bun run migrate`);
      return;
    }
    add(label, true, `reachable, ${tables} tables, migrations: ${migrated.join(', ')}`);
  } catch (err) {
    // The driver message can carry host, port and database name. Say what failed, not where.
    add(label, false, `unreachable (${(err as Error).message.split('\n')[0]})`);
  } finally {
    await pool.end();
  }
}

await checkDatabase('DATABASE_URL', env.DATABASE_URL);

if (!env.TEST_DATABASE_URL) {
  add('TEST_DATABASE_URL', false, 'not set — `bun test` refuses to run without it');
} else if (env.TEST_DATABASE_URL === env.DATABASE_URL) {
  add('TEST_DATABASE_URL', false, 'identical to DATABASE_URL — the suite would truncate your working data');
} else {
  await checkDatabase('TEST_DATABASE_URL', env.TEST_DATABASE_URL);
}

add(
  'Google sign-in',
  features.googleSignIn,
  features.googleSignIn
    ? 'client id and secret present; redirect URI is derived, not configured'
    : 'client id and secret must be set together — 1D reports Google sign-in as unverified',
  false,
);

/** The only check that leaves the machine. One tiny call: is the key live and the model real? */
if (!features.ai) {
  add('Gemini', false, 'GEMINI_API_KEY not set — 2D cannot be verified', false);
} else {
  const startedAt = performance.now();
  try {
    const client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY! });
    const response = await client.models.generateContent({
      model: env.GEMINI_MODEL,
      contents: 'Reply with the JSON object {"ok":true} and nothing else.',
      config: { responseMimeType: 'application/json', maxOutputTokens: 32 },
    });
    const text = (response.text ?? '').trim();
    const parsed = JSON.parse(text) as { ok?: boolean };
    const ms = Math.round(performance.now() - startedAt);
    add('Gemini', parsed.ok === true, `${env.GEMINI_MODEL} answered valid JSON in ${ms}ms`);
  } catch (err) {
    const message = (err as Error).message;
    // A 429 here is a live key at its quota, which is a different problem from a dead key.
    const hint = /429|quota|RESOURCE_EXHAUSTED/i.test(message)
      ? 'key is live but rate limited or out of quota'
      : /API key|401|403|PERMISSION/i.test(message)
        ? 'key rejected'
        : 'call failed';
    add('Gemini', false, `${hint} (model ${env.GEMINI_MODEL})`);
  }
}

const pad = Math.max(...checks.map((c) => c.name.length));
console.log('');
for (const c of checks) {
  console.log(`  ${c.ok ? 'ok  ' : c.fatal ? 'FAIL' : 'warn'}  ${c.name.padEnd(pad)}  ${c.detail}`);
}

const failed = checks.filter((c) => !c.ok && c.fatal);
console.log('');
if (failed.length > 0) {
  console.error(`preflight failed: ${failed.map((c) => c.name).join(', ')}`);
  process.exit(1);
}
console.log('preflight ok');
