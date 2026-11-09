import { z } from 'zod';

export const registerSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    email: z.string().trim().email().optional(),
    phone: z.string().trim().min(6).max(20).optional(),
  })
  .refine((v) => Boolean(v.email || v.phone), {
    message: 'At least one of email or phone is required.',
  });
export type RegisterInput = z.infer<typeof registerSchema>;

const destinationKind = z.enum(['email', 'phone']);

export const otpRequestSchema = z.object({
  destinationKind,
  destination: z.string().trim().min(1).max(200),
  purpose: z.enum(['guest_signup', 'guest_login']),
});
export type OtpRequestInput = z.infer<typeof otpRequestSchema>;

export const otpVerifySchema = z.object({
  destinationKind,
  destination: z.string().trim().min(1).max(200),
  purpose: z.enum(['guest_signup', 'guest_login', 'verify_email', 'verify_phone']),
  code: z.string().trim().length(6),
});
export type OtpVerifyInput = z.infer<typeof otpVerifySchema>;
