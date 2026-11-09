/**
 * Test database guard and reset. Signatures fixed in Docs/09-test-harness.md.
 */
import { Pool } from 'pg';
import { env } from '../../src/env.ts';
import { pool } from '../../src/db.ts';

const ALL_TABLES = [
  'users',
  'sessions',
  'otp_challenges',
  'room_types',
  'room_photos',
  'room_day',
  'promo_codes',
  'promo_redemptions',
  'quotes',
  'bookings',
  'booking_rooms',
  'booking_nights',
  'payments',
  'payment_events',
  'refunds',
  'idempotency_keys',
  'enquiries',
  'enquiry_messages',
  'enquiry_events',
  'enquiry_reads',
  'ai_runs',
  'ai_drafts',
  'resort_info',
  'jobs',
  'notifications',
  'audit_events',
  'analytics_events',
];

/** Refuses to run unless TEST_DATABASE_URL is set and DIFFERENT from DATABASE_URL. */
export function requireTestDatabase(): void {
  if (!env.TEST_DATABASE_URL) {
    throw new Error('TEST_DATABASE_URL is not set — refusing to run the destructive suite.');
  }
  if (env.TEST_DATABASE_URL === env.DATABASE_URL) {
    throw new Error('TEST_DATABASE_URL must differ from DATABASE_URL.');
  }
}

const TAX_CONFIG_SEED = `
  INSERT INTO tax_config (version, effective_from, threshold_paise, low_rate_bps, high_rate_bps, source_note)
  VALUES (1, '2025-09-22', 750000, 500, 1800,
          'Notification 15/2025-Central Tax (Rate) dated 17 Sep 2025, effective 22 Sep 2025, amending 11/2017-CTR (56th GST Council). Bracket applies per unit per day on post-discount value.')
  ON CONFLICT (version) DO NOTHING
`;

/** TRUNCATEs every table except tax_config, re-seeding tax_config v1 if missing. */
export async function resetDatabase(): Promise<void> {
  await pool.query(`TRUNCATE ${ALL_TABLES.join(', ')} CASCADE`);
  await pool.query(TAX_CONFIG_SEED);
}

/** A second, independent pool — needed so genuine concurrency isn't starved by a shared pool. */
export function extraPool(): Pool {
  return new Pool({ connectionString: env.TEST_DATABASE_URL, max: 10 });
}
