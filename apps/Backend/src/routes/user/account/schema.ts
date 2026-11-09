import { z } from 'zod';

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(200),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const startContactVerificationSchema = z.object({
  destinationKind: z.enum(['email', 'phone']),
  destination: z.string().trim().min(1).max(200),
});
export type StartContactVerificationInput = z.infer<typeof startContactVerificationSchema>;
