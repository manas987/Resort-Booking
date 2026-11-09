// Unsplash URL builder — unrelated to the room catalog (which now gets its photo variants
// from the API). Kept here because PropertyTour/tour.ts use it for unrelated illustrative
// photography that isn't catalog data.
export const photoUrl = (id: string, width: number) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${width}&q=75`;

/** Widths offered for illustrative (non-catalog) photography. The catalog gets real variants
 *  from the API; these are decorative images whose URLs are built client-side. */
const PHOTO_WIDTHS = [640, 960, 1280, 1920] as const;

/** A `srcset` for one Unsplash id, so the browser can pick a width instead of always taking
 *  the largest. Pair it with a `sizes` describing the slot. Without this the hero shipped a
 *  single 2000px-wide file to every device, which is the whole first-paint budget on a phone
 *  (apps/Frontend/CLAUDE.md: "first mobile hero ≈100 KB"). */
export const photoSrcSet = (id: string, widths: readonly number[] = PHOTO_WIDTHS) =>
  widths.map((w) => `${photoUrl(id, w)} ${w}w`).join(', ');
