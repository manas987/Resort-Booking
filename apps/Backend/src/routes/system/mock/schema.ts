import { z } from 'zod';

export const injectInboundSchema = z.object({
  from: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(4000),
  contactName: z.string().trim().min(1).max(200).optional(),
});
export type InjectInboundInput = z.infer<typeof injectInboundSchema>;
