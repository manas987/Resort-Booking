import { z } from 'zod';

export const publishResortInfoSchema = z.object({
  key: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(10_000),
});

export const readResortInfoQuerySchema = z.object({
  key: z.string().trim().min(1).max(100).optional(),
  /** Include superseded versions, newest first. Rows are never edited in place — publishing
   *  writes a new version — so the history is simply the other rows for that key. */
  history: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
