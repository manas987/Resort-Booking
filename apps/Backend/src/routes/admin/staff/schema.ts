import { z } from 'zod';

const usernameSchema = z.string().trim().min(3).max(40).regex(/^[a-z0-9._-]+$/i);
const nameSchema = z.string().trim().min(1).max(200);
const emailSchema = z.string().trim().email();
const passwordSchema = z.string().min(8).max(200);
// 'owner' parses here on purpose — SP-16/SP-17 (Docs/tests-phase2.md) expect a request naming
// role "owner" to be refused with 403 forbidden, not 400 validation_failed. The controller's
// `assertCanManage` is what actually enforces INV-36; the schema only shapes the value.
const roleSchema = z.enum(['staff', 'gm', 'owner']);
const teamSchema = z.enum(['reservations', 'sales']);

export const createStaffSchema = z
  .object({
    username: usernameSchema,
    email: emailSchema,
    name: nameSchema,
    role: roleSchema,
    team: teamSchema.optional(),
    password: passwordSchema,
  })
  .refine((data) => (data.role === 'staff' ? data.team !== undefined : data.team === undefined), {
    message: 'team is required for role "staff" and must be omitted otherwise.',
    path: ['team'],
  });

export const updateStaffSchema = z
  .object({
    username: usernameSchema.optional(),
    email: emailSchema.optional(),
    name: nameSchema.optional(),
    role: roleSchema.optional(),
    team: teamSchema.optional(),
    password: passwordSchema.optional(),
  })
  .refine((data) => !(data.role === 'gm' && data.team !== undefined), {
    message: 'team must be omitted when setting role "gm".',
    path: ['team'],
  });
