import type { NextFunction, Request, Response } from 'express';
import { pool } from '../../../db.ts';
import { badRequest, notFound } from '../../../middleware/errors.ts';
import { POLICY } from '../../../core/policy.ts';
import { readAvailability } from '../../../core/inventory.ts';
import { roomWindowQuerySchema } from './schema.ts';

function resortToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: POLICY.timezone }).format(new Date());
}
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

type RoomTypeRow = {
  id: string;
  slug: string;
  name: string;
  max_adults: number;
  max_children: number;
  max_occupancy: number;
  base_price_paise: number;
  physical_stock: number;
  base_allotment: number;
  is_active: boolean;
};
type PhotoRow = { room_type_id: string; alt: string; width: number; height: number; variants: unknown[] };

/** Exists because §5 grants reservations and sales "room information, prices and
 *  availability" and they must not call the user tree for it (SP-10). Unlike the guest
 *  listing (CR-13), staff legitimately see `physical_stock`/`base_allotment`/`is_active` —
 *  operational figures a booking screen needs, not something to hide from an employee. */
export async function readRoomsController(request: Request, response: Response, next: NextFunction): Promise<void> {
  const parsed = roomWindowQuerySchema.safeParse(request.query);
  if (!parsed.success) return next(badRequest(parsed.error));
  const checkIn = parsed.data.from ?? resortToday();
  const checkOut = parsed.data.to ?? addDays(checkIn, 14);

  try {
    const { rows: rooms } = await pool.query<RoomTypeRow>(
      `SELECT id, slug, name, max_adults, max_children, max_occupancy, base_price_paise,
              physical_stock, base_allotment, is_active
         FROM room_types ORDER BY sort_order, name`,
    );
    const { rows: covers } = await pool.query<PhotoRow>(
      `SELECT room_type_id, alt, width, height, variants FROM room_photos WHERE room_type_id = ANY($1) AND is_cover`,
      [rooms.map((r) => r.id)],
    );
    const coverByRoom = new Map(covers.map((c) => [c.room_type_id, c]));

    const availability = await readAvailability(pool, { stay: { checkIn, checkOut }, roomTypeIds: rooms.map((r) => r.id) });
    const summaryByRoom = new Map<string, { remaining: number; hasBlackout: boolean }>();
    for (const night of availability) {
      const current = summaryByRoom.get(night.roomTypeId);
      summaryByRoom.set(night.roomTypeId, {
        remaining: current === undefined ? night.remaining : Math.min(current.remaining, night.remaining),
        hasBlackout: (current?.hasBlackout ?? false) || night.isBlackout,
      });
    }

    response.status(200).json({
      checkIn,
      checkOut,
      rooms: rooms.map((room) => {
        const cover = coverByRoom.get(room.id);
        const summary = summaryByRoom.get(room.id) ?? { remaining: 0, hasBlackout: false };
        return {
          id: room.id,
          slug: room.slug,
          name: room.name,
          maxAdults: room.max_adults,
          maxChildren: room.max_children,
          maxOccupancy: room.max_occupancy,
          basePricePaise: room.base_price_paise,
          physicalStock: room.physical_stock,
          baseAllotment: room.base_allotment,
          isActive: room.is_active,
          remainingInWindow: summary.remaining,
          hasBlackoutInWindow: summary.hasBlackout,
          coverPhoto: cover ? { alt: cover.alt, width: cover.width, height: cover.height, variants: cover.variants } : null,
        };
      }),
    });
  } catch (error) {
    next(error);
  }
}

export async function readRoomController(request: Request, response: Response, next: NextFunction): Promise<void> {
  const parsed = roomWindowQuerySchema.safeParse(request.query);
  if (!parsed.success) return next(badRequest(parsed.error));
  const checkIn = parsed.data.from ?? resortToday();
  const checkOut = parsed.data.to ?? addDays(checkIn, 14);
  const { roomTypeId } = request.params as { roomTypeId: string };

  try {
    const { rows } = await pool.query<RoomTypeRow & { summary: string; description: string; amenities: string[]; inclusions: string[] }>(
      `SELECT id, slug, name, summary, description, amenities, inclusions, max_adults, max_children,
              max_occupancy, base_price_paise, physical_stock, base_allotment, is_active
         FROM room_types WHERE id = $1`,
      [roomTypeId],
    );
    const room = rows[0];
    if (!room) return next(notFound('Room type'));

    const { rows: photos } = await pool.query<{ alt: string; width: number; height: number; variants: unknown[]; is_cover: boolean }>(
      `SELECT alt, width, height, variants, is_cover FROM room_photos WHERE room_type_id = $1 ORDER BY sort_order`,
      [room.id],
    );
    const availability = await readAvailability(pool, { stay: { checkIn, checkOut }, roomTypeIds: [room.id] });

    response.status(200).json({
      id: room.id,
      slug: room.slug,
      name: room.name,
      summary: room.summary,
      description: room.description,
      amenities: room.amenities,
      inclusions: room.inclusions,
      maxAdults: room.max_adults,
      maxChildren: room.max_children,
      maxOccupancy: room.max_occupancy,
      basePricePaise: room.base_price_paise,
      physicalStock: room.physical_stock,
      baseAllotment: room.base_allotment,
      isActive: room.is_active,
      photos: photos.map((p) => ({ alt: p.alt, width: p.width, height: p.height, variants: p.variants, isCover: p.is_cover })),
      availability: availability.map((a) => ({
        stayDate: a.stayDate,
        allotment: a.allotment,
        committed: a.committed,
        remaining: a.remaining,
        isBlackout: a.isBlackout,
      })),
    });
  } catch (error) {
    next(error);
  }
}
