import { z } from 'zod';

export const createPromoSchema = z
  .object({
    code: z.string().trim().min(1).max(50),
    kind: z.enum(['percent', 'fixed']),
    value: z.number().int().positive(),
    maxUses: z.number().int().positive().optional(),
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().optional(),
  })
  .refine((v) => v.kind !== 'percent' || v.value <= 10000, { message: 'Percent value cannot exceed 10000 bps (100%).', path: ['value'] })
  .refine((v) => !(v.startsAt && v.endsAt) || new Date(v.endsAt) > new Date(v.startsAt), {
    message: 'endsAt must be after startsAt.',
    path: ['endsAt'],
  });

export const updatePromoSchema = z
  .object({
    value: z.number().int().positive().optional(),
    maxUses: z.number().int().positive().optional(),
    startsAt: z.string().datetime().nullable().optional(),
    endsAt: z.string().datetime().nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => !(v.startsAt && v.endsAt) || new Date(v.endsAt) > new Date(v.startsAt), {
    message: 'endsAt must be after startsAt.',
    path: ['endsAt'],
  });
