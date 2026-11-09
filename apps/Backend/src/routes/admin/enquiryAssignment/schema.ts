import { z } from 'zod';

export const assignSchema = z.object({
  assigneeId: z.string().uuid(),
});
