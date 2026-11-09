import type { NextFunction, Request, Response } from 'express';
import { pool } from '../../../db.ts';
import { badRequest } from '../../../middleware/errors.ts';
import { validatePromoSchema } from './schema.ts';

/** Checks against booking time only (INV-32-adjacent) and reserves nothing — capacity is
 *  only ever reserved alongside the hold (1G). Same lookup `calculateQuote` (1B) uses, so a
 *  code that validates here is guaranteed to still apply at quote time. */
export async function validatePromoController(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const parsed = validatePromoSchema.safeParse(request.body);
  if (!parsed.success) return next(badRequest(parsed.error));

  try {
    const { rows } = await pool.query<{ kind: 'percent' | 'fixed'; value: number }>(
      `SELECT kind, value FROM promo_codes
         WHERE upper(code) = upper($1) AND is_active
           AND (starts_at IS NULL OR starts_at <= now())
           AND (ends_at IS NULL OR ends_at > now())`,
      [parsed.data.code],
    );
    const promo = rows[0];
    if (!promo) {
      response.status(200).json({ valid: false, reason: 'Invalid or expired promo code.' });
      return;
    }
    response.status(200).json({ valid: true, kind: promo.kind, value: promo.value });
  } catch (error) {
    next(error);
  }
}
