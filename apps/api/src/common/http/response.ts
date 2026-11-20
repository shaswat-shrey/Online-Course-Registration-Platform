import type { Response } from 'express';
import { buildPaginationMeta, type ApiSuccess, type CursorMeta } from '@ucrams/shared';

/** Sends the standard success envelope (docs/API.md §3). */
export function sendOk<T>(res: Response, data: T, message = 'OK', status = 200): Response {
  const body: ApiSuccess<T> = { success: true, message, data };
  return res.status(status).json(body);
}

export function sendCreated<T>(res: Response, data: T, message = 'Created'): Response {
  return sendOk(res, data, message, 201);
}

export function sendPaginated<T>(
  res: Response,
  items: T[],
  page: { page: number; limit: number; total: number },
  message = 'OK',
): Response {
  const body: ApiSuccess<T[]> = {
    success: true,
    message,
    data: items,
    meta: buildPaginationMeta(page.page, page.limit, page.total),
  };
  return res.status(200).json(body);
}

export function sendCursorPage<T>(
  res: Response,
  items: T[],
  meta: CursorMeta,
  message = 'OK',
): Response {
  const body: ApiSuccess<T[]> = { success: true, message, data: items, meta };
  return res.status(200).json(body);
}
