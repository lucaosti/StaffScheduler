/**
 * Tenant resolver middleware (F13).
 *
 * Reads `X-Tenant-Id` from the request, validates it against the `tenants`
 * table, and attaches the tenant id to `req.tenantId`. Falls back to the
 * default tenant (id=1) when the header is absent.
 *
 * This is the entry point for the multi-tenant story; downstream services
 * still need to add a `tenant_id` column to their tables and start
 * filtering by it. Tracked under R??? in PLAN.md.
 *
 * @author Luca Ostinelli
 */

import { NextFunction, Request, Response } from 'express';
import { Pool, RowDataPacket } from 'mysql2/promise';

declare module 'express-serve-static-core' {
  interface Request {
    tenantId?: number;
  }
}

export const DEFAULT_TENANT_ID = 1;

export const resolveTenant = (pool: Pool) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const headerValue = req.header('x-tenant-id');
    if (!headerValue) {
      req.tenantId = DEFAULT_TENANT_ID;
      return next();
    }
    const tenantId = Number(headerValue);
    if (!Number.isFinite(tenantId) || tenantId <= 0) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_TENANT', message: 'X-Tenant-Id must be a positive integer' },
      });
      return;
    }
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT id FROM tenants WHERE id = ? AND is_active = 1 LIMIT 1`,
      [tenantId]
    );
    if (rows.length === 0) {
      res.status(404).json({
        success: false,
        error: { code: 'TENANT_NOT_FOUND', message: 'Unknown or inactive tenant' },
      });
      return;
    }
    req.tenantId = tenantId;
    next();
  };
};
