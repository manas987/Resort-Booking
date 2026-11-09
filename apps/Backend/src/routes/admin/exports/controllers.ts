import type { NextFunction, Request, Response } from 'express';
import { pool, withTransaction } from '../../../db.ts';
import { badRequest } from '../../../middleware/errors.ts';
import { POLICY } from '../../../core/policy.ts';
import type { Principal } from '../../../core/tokens.ts';
import { recordAuditEvent } from '../../../core/audit.ts';
import { exportBookingsQuerySchema } from './schema.ts';

/** INV-51: a leading `= + - @`, tab or CR makes a spreadsheet try to evaluate the cell as a
 *  formula. Prefixing with `'` first, then CSV-quoting if the value needs it (comma, quote
 *  or newline), keeps both rules independent — one checks the content, the other checks
 *  whether the field needs escaping for the format itself (EC-7..EC-9). */
function csvField(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

const HEADER = [
  'reference', 'status', 'check_in', 'check_out', 'guest_name', 'guest_email', 'guest_phone',
  'room_name', 'adults', 'children', 'room_paise', 'discount_paise', 'tax_paise', 'total_paise', 'confirmed_at',
] as const;

type ExportRow = {
  reference: string; status: string; check_in: string; check_out: string;
  guest_name: string; guest_email: string; guest_phone: string;
  room_name_snapshot: string; adults: number; children: number;
  room_paise: number; discount_paise: number; tax_paise: number; total_paise: number;
  confirmed_at: string;
};

/** Filtered by confirmation date in Asia/Kolkata (INV-37's own wording), not stay date —
 *  EC-3/EC-5 depend on that distinction. One row per booking-room, the reference repeated
 *  (EC-10) — purchased snapshot values throughout, never recomputed (EC-12, "Do not
 *  recompute prices for display instead of reading the snapshot"). */
export async function exportBookingsCsvController(request: Request, response: Response, next: NextFunction): Promise<void> {
  const parsed = exportBookingsQuerySchema.safeParse(request.query);
  if (!parsed.success) return next(badRequest(parsed.error));
  const { from, to } = parsed.data;
  const actor = response.locals.principal as Principal;

  try {
    const { rows } = await pool.query<ExportRow>(
      `SELECT b.reference, b.status, b.check_in, b.check_out, b.guest_name, b.guest_email, b.guest_phone,
              br.room_name_snapshot, br.adults, br.children,
              b.room_paise, b.discount_paise, b.tax_paise, b.total_paise, b.confirmed_at
         FROM bookings b
         JOIN booking_rooms br ON br.booking_id = b.id
        WHERE b.confirmed_at IS NOT NULL
          AND (b.confirmed_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date
        ORDER BY b.confirmed_at, b.reference, br.id`,
      [POLICY.timezone, from, to],
    );

    const lines = [HEADER.join(',')];
    for (const row of rows) {
      lines.push(
        [
          row.reference, row.status, row.check_in, row.check_out, row.guest_name, row.guest_email, row.guest_phone,
          row.room_name_snapshot, row.adults, row.children, row.room_paise, row.discount_paise, row.tax_paise,
          row.total_paise, row.confirmed_at,
        ]
          .map(csvField)
          .join(','),
      );
    }
    const csv = lines.join('\r\n');

    await withTransaction((client) =>
      recordAuditEvent(client, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: 'export.bookings',
        targetKind: 'export',
        after: { from, to, rows: rows.length },
      }),
    );

    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="bookings-${from}-to-${to}.csv"`);
    response.status(200).send(csv);
  } catch (error) {
    next(error);
  }
}
