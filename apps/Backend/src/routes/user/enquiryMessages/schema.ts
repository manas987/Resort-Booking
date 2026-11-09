import { z } from 'zod';

export const sendEnquiryMessageSchema = z.object({
  message: z.string().trim().min(1).max(4000),
});
export type SendEnquiryMessageInput = z.infer<typeof sendEnquiryMessageSchema>;
