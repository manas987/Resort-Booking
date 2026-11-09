/**
 * Curated room copy and photography, ported from the frontend's original design-concept
 * data (`apps/Frontend/src/data/rooms.ts`, now deleted — Docs/03-decisions.md, Phase 3/3C).
 * Synthetic content, not client-supplied facts (Product.md §26).
 *
 * Keyed by the seeded slug, tier-matched to the frontend's four rooms by price rank — slugs,
 * names, prices and capacities are the backend's own and are NOT changed by this file; see
 * Docs/08-known-issues.md / 03-decisions.md for why the seeded price ladder was kept.
 *
 * Used by both `seeds/run.ts` (a fresh seed) and `seeds/update-room-content.ts` (patching an
 * already-seeded database without touching its other rows) — one source, two call sites.
 */
export type RoomPhoto = { alt: string; unsplashId: string };

export type RoomContent = {
  summary: string;
  description: string;
  amenities: string[];
  inclusions: string[];
  photos: RoomPhoto[];
};

export const ROOM_CONTENT: Record<string, RoomContent> = {
  'estate-room': {
    summary: 'An easy escape for two.',
    description:
      'Soft light, warm textures and a little space to switch off. A considered base for unhurried days at the coffee estate.',
    amenities: ['Wi-Fi', 'Air conditioning', 'Tea & coffee', 'Private bathroom', 'Fresh linen', 'Seating area'],
    inclusions: ['Breakfast', 'Estate walk'],
    photos: [
      { alt: 'Estate Room, main view', unsplashId: 'photo-1611892440504-42a792e24d32' },
      { alt: 'Estate Room, interior detail', unsplashId: 'photo-1618773928121-c32242e63f39' },
      { alt: 'Estate Room, surroundings', unsplashId: 'photo-1449158743715-0a90ebb6d2d8' },
    ],
  },
  'garden-suite': {
    summary: 'Wake up a little closer to green.',
    description:
      'A relaxed room with a greener outlook. Open the curtains, take your time over coffee, and let the day find its own pace.',
    amenities: ['Garden outlook', 'Wi-Fi', 'Air conditioning', 'Tea & coffee', 'Private bathroom', 'Seating area'],
    inclusions: ['Breakfast', 'Estate walk'],
    photos: [
      { alt: 'Garden Suite, main view', unsplashId: 'photo-1618773928121-c32242e63f39' },
      { alt: 'Garden Suite, interior detail', unsplashId: 'photo-1611892440504-42a792e24d32' },
      { alt: 'Garden Suite, surroundings', unsplashId: 'photo-1441974231531-c6227db76b6e' },
    ],
  },
  'plantation-cottage': {
    summary: 'More room. Less rush.',
    description:
      'Room to spread out, settle in and stay a little longer. A separate sitting area makes quiet afternoons as inviting as slow mornings.',
    amenities: ['Separate sitting area', 'Wi-Fi', 'Air conditioning', 'Tea & coffee', 'Private bathroom', 'Sofa bed'],
    inclusions: ['Breakfast', 'Estate walk'],
    photos: [
      { alt: 'Plantation Cottage, main view', unsplashId: 'photo-1600210492486-724fe5c67fb0' },
      { alt: 'Plantation Cottage, interior detail', unsplashId: 'photo-1611892440504-42a792e24d32' },
      { alt: 'Plantation Cottage, surroundings', unsplashId: 'photo-1618773928121-c32242e63f39' },
    ],
  },
  'coffee-villa': {
    summary: 'A retreat of your own.',
    description:
      'A private corner for time together. Warm, natural interiors and generous living space give your stay a quieter rhythm.',
    amenities: ['Two bedrooms', 'Living space', 'Wi-Fi', 'Air conditioning', 'Tea & coffee', 'Private bathroom'],
    inclusions: ['Breakfast', 'Estate walk'],
    photos: [
      { alt: 'Coffee Villa, main view', unsplashId: 'photo-1510798831971-661eb04b3739' },
      { alt: 'Coffee Villa, interior detail', unsplashId: 'photo-1449844908441-8829872d2607' },
      { alt: 'Coffee Villa, surroundings', unsplashId: 'photo-1600210492486-724fe5c67fb0' },
    ],
  },
};

const PHOTO_WIDTHS = [480, 900, 1600] as const;

/** Every photo is forced to this width:height ratio (`&h=` alongside `&w=`, both with
 *  `fit=crop`) so the file Unsplash actually returns matches `PHOTO_ASPECT_RATIO` below —
 *  without an explicit height, `fit=crop` only crops to the SOURCE photo's own native aspect,
 *  which varies per photo (some of these are portrait shots) and silently stopped matching
 *  the room-grid CSS that assumes a fixed landscape ratio. */
export const PHOTO_ASPECT_RATIO = 1.5;

/** `auto=format` content-negotiates the real format per request; the `format: 'avif'` label
 *  matches the convention `room_photos.variants` already used for the picsum placeholder it
 *  replaces — informational for the client's `srcset`, not a literal promise from this URL. */
export function photoVariants(unsplashId: string): Array<{ w: number; h: number; format: string; url: string }> {
  return PHOTO_WIDTHS.map((w) => {
    const h = Math.round(w / PHOTO_ASPECT_RATIO);
    return {
      w,
      h,
      format: 'avif',
      url: `https://images.unsplash.com/${unsplashId}?auto=format&fit=crop&w=${w}&h=${h}&q=75`,
    };
  });
}
