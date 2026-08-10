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
// while this shape has always been `pageSize`/`pages`. Consumed below by
// `sendPaginated` and not re-exported — nothing imports it from this module,
// and @staff-scheduler/shared is the one place to get it from.

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

  // parseInt('0') is 0, which `|| fallback` would treat as "not given" — that
  // silently promoted pageSize=0 to the 25-row default instead of clamping it
  // to 1, so NaN is checked explicitly rather than relying on truthiness.
  const parsedPage = parseInt(String(rawPage ?? '1'), 10);
  const page = Math.max(1, Number.isNaN(parsedPage) ? 1 : parsedPage);
  const parsedSize = parseInt(String(rawSize ?? DEFAULT_PAGE_SIZE), 10);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number.isNaN(parsedSize) ? DEFAULT_PAGE_SIZE : parsedSize)
  );
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
