import type { NextFunction, Request, Response } from 'express';
import { pool } from '../../../db.ts';

/** GM-editable content is always read live — never baked into a build artifact (CR-11). */
export async function readResortContentController(
  _request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { rows } = await pool.query<{ key: string; title: string; body: string; version: number }>(
      `SELECT key, title, body, version FROM resort_info WHERE is_current ORDER BY key`,
    );
    response.status(200).json({ content: rows });
  } catch (error) {
    next(error);
  }
}
