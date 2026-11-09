import { z } from 'zod';

export const publishResortInfoSchema = z.object({
  key: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(10_000),
});

export const readResortInfoQuerySchema = z.object({
  key: z.string().trim().min(1).max(100).optional(),
});
