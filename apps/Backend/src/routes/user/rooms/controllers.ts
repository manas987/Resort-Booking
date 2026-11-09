import type { NextFunction, Request, Response } from 'express';
import { pool } from '../../../db.ts';
import { notFound } from '../../../middleware/errors.ts';

type PhotoVariant = Record<string, unknown>;
type PhotoRow = { alt: string; width: number; height: number; variants: PhotoVariant[]; is_cover: boolean };

type RoomTypeRow = {
  id: string;
  slug: string;
  name: string;
  summary: string;
  description: string;
  amenities: string[];
  inclusions: string[];
  max_adults: number;
  max_children: number;
  max_occupancy: number;
  base_price_paise: number;
};

/** Only ever this shape to a guest — never physical_stock, base_allotment or anything else
 *  internal (CR-13). "from" price, explicitly labelled, never a stay quote. */
function toListing(room: RoomTypeRow, coverPhoto: PhotoRow | undefined) {
  return {
    id: room.id,
    slug: room.slug,
    name: room.name,
    summary: room.summary,
    amenities: room.amenities,
    inclusions: room.inclusions,
    maxAdults: room.max_adults,
    maxChildren: room.max_children,
    maxOccupancy: room.max_occupancy,
    fromPricePaise: room.base_price_paise,
    coverPhoto: coverPhoto
      ? { alt: coverPhoto.alt, width: coverPhoto.width, height: coverPhoto.height, variants: coverPhoto.variants }
      : null,
  };
}

export async function readRoomsController(_request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const { rows: rooms } = await pool.query<RoomTypeRow>(
      `SELECT id, slug, name, summary, description, amenities, inclusions,
              max_adults, max_children, max_occupancy, base_price_paise
         FROM room_types WHERE is_active ORDER BY sort_order, name`,
    );
    const { rows: covers } = await pool.query<PhotoRow & { room_type_id: string }>(
      `SELECT room_type_id, alt, width, height, variants, is_cover
         FROM room_photos WHERE room_type_id = ANY($1) AND is_cover`,
      [rooms.map((r) => r.id)],
    );
    const coverByRoom = new Map(covers.map((c) => [c.room_type_id, c]));
    response.status(200).json({ rooms: rooms.map((room) => toListing(room, coverByRoom.get(room.id))) });
  } catch (error) {
    next(error);
  }
}

export async function readRoomBySlugController(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { rows } = await pool.query<RoomTypeRow>(
      `SELECT id, slug, name, summary, description, amenities, inclusions,
              max_adults, max_children, max_occupancy, base_price_paise
         FROM room_types WHERE slug = $1 AND is_active`,
      [request.params.slug],
    );
    const room = rows[0];
    if (!room) return next(notFound('Room'));

    const { rows: photos } = await pool.query<PhotoRow>(
      `SELECT alt, width, height, variants, is_cover
         FROM room_photos WHERE room_type_id = $1 ORDER BY sort_order`,
      [room.id],
    );

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
      fromPricePaise: room.base_price_paise,
      photos: photos.map((p) => ({ alt: p.alt, width: p.width, height: p.height, variants: p.variants, isCover: p.is_cover })),
    });
  } catch (error) {
    next(error);
  }
}
