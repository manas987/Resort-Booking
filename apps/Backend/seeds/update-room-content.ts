/**
 * One-off, idempotent: applies `ROOM_CONTENT` to an ALREADY-SEEDED database's existing room
 * types, without touching anything else — unlike `seeds/run.ts`, which refuses a non-empty
 * database because it seeds the *entire* synthetic reviewer dataset (users, bookings,
 * enquiries) and a `--force` re-run would duplicate all of it.
 *
 * Needed because the hosted DATABASE_URL (Docs/08-known-issues.md) was already migrated and
 * seeded with the generic filler copy when Phase 3 first connected to it — re-running the full
 * seed there would have produced a second, duplicate set of reviewer fixtures. This patches
 * the four seeded room types in place: UPDATE room_types for summary/description/amenities/
 * inclusions (slug, name, price, capacity untouched), then replaces each one's room_photos
 * wholesale with the curated multi-width set.
 *
 * Safe to run twice — the UPDATE is idempotent and the photo replace is DELETE+INSERT inside
 * one transaction per room type, keyed by slug, so a repeat run converges to the same rows.
 *
 * Run: bun seeds/update-room-content.ts
 */
import { pool, withTransaction } from '../src/db.ts';
import { ROOM_CONTENT, photoVariants } from './data/roomContent.ts';

async function run(): Promise<void> {
  for (const [slug, content] of Object.entries(ROOM_CONTENT)) {
    const { rows } = await pool.query<{ id: string; name: string }>(
      `SELECT id, name FROM room_types WHERE slug = $1`,
      [slug],
    );
    const room = rows[0];
    if (!room) {
      console.log(`skip ${slug} — not seeded on this database`);
      continue;
    }

    await withTransaction(async (client) => {
      await client.query(
        `UPDATE room_types SET summary = $1, description = $2, amenities = $3, inclusions = $4
           WHERE id = $5`,
        [content.summary, content.description, content.amenities, content.inclusions, room.id],
      );
      await client.query(`DELETE FROM room_photos WHERE room_type_id = $1`, [room.id]);
      for (const [index, photo] of content.photos.entries()) {
        const variants = photoVariants(photo.unsplashId);
        const { w: rowWidth, h: rowHeight } = variants[variants.length - 1]!;
        await client.query(
          `INSERT INTO room_photos (room_type_id, alt, width, height, variants, is_cover, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [room.id, photo.alt, rowWidth, rowHeight, JSON.stringify(variants), index === 0, index],
        );
      }
    });
    console.log(`updated ${slug} (${room.name}) — ${content.photos.length} photos`);
  }
}

if (import.meta.main) {
  run()
    .then(() => {
      console.log('done');
      process.exit(0);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
