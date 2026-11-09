import type { NextFunction, Request, Response } from 'express';
import { pool } from '../../../db.ts';
import { badRequest, notFound } from '../../../middleware/errors.ts';
import { POLICY } from '../../../core/policy.ts';
import { calculateQuote } from '../../../core/pricing.ts';
import type { Principal } from '../../../core/tokens.ts';
import { createQuoteSchema } from './schema.ts';

type QuoteRow = {
  id: string;
  guest_user_id: string | null;
  check_in: string;
  check_out: string;
  pricing: unknown;
  room_paise: number;
  discount_paise: number;
  tax_paise: number;
  total_paise: number;
  tax_config_version: number;
  terms_version: number;
  expires_at: string;
};

function serializeQuote(quote: QuoteRow) {
  return {
    quoteId: quote.id,
    checkIn: quote.check_in,
    checkOut: quote.check_out,
    pricing: quote.pricing,
    roomPaise: quote.room_paise,
    discountPaise: quote.discount_paise,
    taxPaise: quote.tax_paise,
    totalPaise: quote.total_paise,
    taxConfigVersion: quote.tax_config_version,
    termsVersion: quote.terms_version,
    expiresAt: quote.expires_at,
    expired: new Date(quote.expires_at).getTime() <= Date.now(),
  };
}

/** Quotes are public — §8 prices a stay before sign-in (Docs/10-phase1-backend-guest.md).
 *  `optionalGuest` already ran; `guest_user_id` is stamped only when it did find someone. */
export async function createQuoteController(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const parsed = createQuoteSchema.safeParse(request.body);
  if (!parsed.success) return next(badRequest(parsed.error));
  const { checkIn, checkOut, rooms, promoCode } = parsed.data;
  const principal = response.locals.principal as Principal | undefined;

  try {
    const result = await calculateQuote(pool, { stay: { checkIn, checkOut }, rooms, promoCode });

    let promoId: string | null = null;
    if (promoCode) {
      const { rows } = await pool.query<{ id: string }>(
        `SELECT id FROM promo_codes WHERE upper(code) = upper($1)`,
        [promoCode],
      );
      promoId = rows[0]?.id ?? null;
    }

    const { rows } = await pool.query<QuoteRow>(
      `INSERT INTO quotes
         (guest_user_id, check_in, check_out, lines, pricing, promo_id, room_paise,
          discount_paise, tax_paise, total_paise, tax_config_version, terms_version, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now() + interval '1 minute' * $13)
       RETURNING id, guest_user_id, check_in, check_out, pricing, room_paise, discount_paise,
                 tax_paise, total_paise, tax_config_version, terms_version, expires_at`,
      [
        principal?.userId ?? null,
        checkIn,
        checkOut,
        JSON.stringify(rooms),
        JSON.stringify(result),
        promoId,
        result.roomPaise,
        result.discountPaise,
        result.taxPaise,
        result.totalPaise,
        result.taxConfigVersion,
        result.termsVersion,
        POLICY.expiry.quoteMinutes,
      ],
    );
    response.status(201).json(serializeQuote(rows[0]!));
  } catch (error) {
    next(error);
  }
}

/** A quote id is not a capability (INV-34). A quote owned by someone else is `404`, never
 *  `403` — confirming it exists would leak that a different guest is mid-booking. */
export async function readQuoteController(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const principal = response.locals.principal as Principal | undefined;

  try {
    const { rows } = await pool.query<QuoteRow>(
      `SELECT id, guest_user_id, check_in, check_out, pricing, room_paise, discount_paise,
              tax_paise, total_paise, tax_config_version, terms_version, expires_at
         FROM quotes WHERE id = $1`,
      [request.params.quoteId],
    );
    const quote = rows[0];
    if (!quote) return next(notFound('Quote'));
    const owned = quote.guest_user_id === null || quote.guest_user_id === principal?.userId;
    if (!owned) return next(notFound('Quote'));

    response.status(200).json(serializeQuote(quote));
  } catch (error) {
    next(error);
  }
}
