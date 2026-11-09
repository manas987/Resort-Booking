import { z } from 'zod';

export const validatePromoSchema = z.object({
  code: z.string().trim().min(1).max(50),
});
export type ValidatePromoInput = z.infer<typeof validatePromoSchema>;
