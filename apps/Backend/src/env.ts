/**
 * The only place in the backend that reads `process.env`.
 *
 * Parsed once, at import time. A bad or missing variable kills the process with the names of
 * what is wrong rather than failing later, deeper, and less clearly. Bun loads `.env` itself,
 * so there is no dotenv here.
 */
import { z } from 'zod';

const origin = z
  .string()
  .url()
  .refine((v) => !v.endsWith('/'), { message: 'must not have a trailing slash' });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(3001),

  DATABASE_URL: z.string().min(1, 'required'),
  /** Used by `bun test`. Must differ from DATABASE_URL — tests are destructive. */
  TEST_DATABASE_URL: z.string().min(1).optional(),

  /** Browser origin of the web app. The CORS allowlist and cookie scope derive from it. */
  APP_ORIGIN: origin,
  /** Public origin of this API, used to build OAuth redirect URIs and absolute links. */
  API_PUBLIC_ORIGIN: origin,

  /** Signs short-lived access tokens. Refresh credentials are opaque and hashed, so they
   *  need no secret of their own. */
  JWT_SECRET: z.string().min(32, 'must be at least 32 characters'),

  /** Google sign-in. Both together or neither. The redirect URI is NOT a variable — it is
   *  derived below from API_PUBLIC_ORIGIN, because we own the route it points at and a
   *  hand-maintained copy can only ever drift out of sync with it. */
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),

  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_MODEL: z.string().min(1).default('gemini-3.5-flash-lite'),

  /** Exposes mock OTP codes and payment controls for seeded reviewer identities only.
   *  Never enable in a real deployment. */
  DEMO_MODE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

/**
 * An empty variable means "not set", not "set to the empty string". Copying `.env.example` to
 * `.env` leaves every unfilled line as `KEY=`, and without this the process refuses to boot
 * over an optional variable nobody asked for — and reports a required one as "too small"
 * instead of "required". Dropping blanks makes defaults and `.optional()` behave.
 */
const supplied = Object.fromEntries(
  Object.entries(process.env).filter(([, value]) => value !== undefined && value !== ''),
);

const parsed = schema.safeParse(supplied);

if (!parsed.success) {
  const lines = parsed.error.issues.map((issue) => {
    const name = issue.path.join('.') || '(root)';
    // A missing variable reads as "expected string, received undefined", which tells someone
    // staring at a half-filled .env nothing useful. Say it is required.
    const missing = issue.code === 'invalid_type' && /received undefined/.test(issue.message);
    return `  ${name}: ${missing ? 'required, and currently empty or absent' : issue.message}`;
  });
  console.error(`Invalid environment:\n${lines.join('\n')}\n\nSee .env.example for the full list.`);
  process.exit(1);
}

export const env = parsed.data;

/** Google sign-in needs both values or neither; a half-configured client is a misconfiguration. */
const googleParts = [env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET];
if (googleParts.some(Boolean) && !googleParts.every(Boolean)) {
  console.error(
    'Invalid environment:\n  GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together.',
  );
  process.exit(1);
}

/**
 * Derived, never configured. This must match the Authorised redirect URI registered in the
 * Google Cloud console exactly — Google rejects a mismatch rather than redirecting anyway —
 * and it must match the callback route in routes/user/auth/. Deriving it from one origin makes
 * those two the same string by construction. Paste this value into the console; it is not a
 * secret.
 */
export const googleRedirectUri = `${env.API_PUBLIC_ORIGIN}/api/user/auth/google/callback`;

/**
 * Optional integrations are reported once at boot. They fail loudly at the point of use
 * rather than silently pretending to work — see Docs/03-decisions.md.
 */
export const features = {
  googleSignIn: googleParts.every(Boolean),
  ai: Boolean(env.GEMINI_API_KEY),
} as const;

export const isProduction = env.NODE_ENV === 'production';
