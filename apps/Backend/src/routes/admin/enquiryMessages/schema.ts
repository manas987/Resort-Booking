import { z } from 'zod';

export const sendReplySchema = z.object({
  body: z.string().trim().min(1).max(4000),
  // Set only when sending a pending AI draft verbatim — never otherwise. Omitted, this is a
  // from-scratch staff reply with no AI involvement (2D).
  draftId: z.string().uuid().optional(),
});

export const createNoteSchema = z.object({
  body: z.string().trim().min(1).max(4000),
});
