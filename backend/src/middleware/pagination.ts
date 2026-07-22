/**
 * Pagination helpers for list endpoints.
 *
 * Provides a consistent contract:
 *   ?page=1&pageSize=25
 *
 * Response shape when paginated:
 *   { success: true, data: [...], meta: { total, page, pageSize, pages } }
 *
 * When `page` / `pageSize` are absent the endpoint returns the plain
 * `{ success: true, data: [...] }` shape (backward compatible).
 *
 * @author Luca Ostinelli
 */

import { Request, Response } from 'express';
import type { PaginationMeta } from '@staff-scheduler/shared';

// Declared once in the shared package, from which the OpenAPI component is
// generated: the hand-written component had drifted to `limit`/`totalPages`
// while this shape has always been `pageSize`/`pages`.
export type { PaginationMeta };

export interface PaginationParams {
  page: number;
  pageSize: number;
  offset: number;
}

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 200;

/** Parses `?page` and `?pageSize` from the query string. Returns null if neither is present. */
export const parsePagination = (req: Request): PaginationParams | null => {
  const rawPage = req.query.page;
  const rawSize = req.query.pageSize;

  if (rawPage === undefined && rawSize === undefined) return null;

  const page = Math.max(1, parseInt(String(rawPage ?? '1'), 10) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(String(rawSize ?? DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE));
  const offset = (page - 1) * pageSize;

  return { page, pageSize, offset };
};

/** Sends a paginated response. */
export const sendPaginated = <T>(
  res: Response,
  data: T[],
  total: number,
  params: PaginationParams
): void => {
  const meta: PaginationMeta = {
    total,
    page: params.page,
    pageSize: params.pageSize,
    pages: Math.ceil(total / params.pageSize),
  };
  res.json({ success: true, data, meta });
};
