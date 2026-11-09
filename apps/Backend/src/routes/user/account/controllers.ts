import type { NextFunction, Request, Response } from 'express';
import { pool } from '../../../db.ts';
import { badRequest, unauthenticated } from '../../../middleware/errors.ts';
import type { Principal } from '../../../core/tokens.ts';
import { requestOtp } from '../auth/otp.ts';
import { updateProfileSchema, startContactVerificationSchema } from './schema.ts';

function currentPrincipal(response: Response): Principal {
  const principal = response.locals.principal as Principal | undefined;
  if (!principal) throw unauthenticated();
  return principal;
}

/** Name only — not an authorisation identifier (Docs/Product.md §7); changing a contact goes
 *  through `contact/verify-start`, never this route, so an edit here can never silently move
 *  booking ownership. */
export async function updateProfileController(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const parsed = updateProfileSchema.safeParse(request.body);
  if (!parsed.success) return next(badRequest(parsed.error));

  try {
    const principal = currentPrincipal(response);
    await pool.query(`UPDATE users SET name = $1 WHERE id = $2`, [parsed.data.name, principal.userId]);
    response.status(200).json({ name: parsed.data.name });
  } catch (error) {
    next(error);
  }
}

/** Opens a `verify_email`/`verify_phone` challenge for the calling guest's own account. The
 *  new contact is only written once `/otp/verify` succeeds — never here (INV-34, §7 "changing
 *  a contact must not silently merge accounts or transfer booking ownership"). */
export async function startContactVerificationController(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const parsed = startContactVerificationSchema.safeParse(request.body);
  if (!parsed.success) return next(badRequest(parsed.error));

  try {
    currentPrincipal(response); // requireGuest already ran; this just surfaces a clean 401
    const purpose = parsed.data.destinationKind === 'email' ? 'verify_email' : 'verify_phone';
    const result = await requestOtp({ ...parsed.data, purpose });
    response.status(200).json(result);
  } catch (error) {
    next(error);
  }
}
