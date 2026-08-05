/**
 * Reports routes (F08). Manager only.
 *
 * @author Luca Ostinelli
 */

import { Pool } from 'mysql2/promise';
import { Router, Request, Response } from 'express';
import { authenticate, requirePermission, requireModuleForUser } from '../middleware/auth';
import { validateParams, validateQuery } from '../middleware/validation';
import { scheduleIdParam, reportRangeQuery, fairnessExportQuery } from '../schemas';
import { ReportsService } from '../services/ReportsService';
import { AuditLogService } from '../services/AuditLogService';
import { ExportService } from '../services/ExportService';
import { costByDepartmentColumns, hoursWorkedColumns } from '../services/exportColumns';

const respondError = (res: Response, status: number, code: string, message: string): void => {
  res.status(status).json({ success: false, error: { code, message } });
};


export const createReportsRouter = (pool: Pool, readPool: Pool = pool): Router => {
  const router = Router();
  const service = new ReportsService(readPool);
  const exporter = new ExportService(new AuditLogService(pool));

  /**
   * The range both report endpoints take, resolved once.
   *
   * The export variants must apply the SAME range resolution as the JSON ones,
   * including the legacy `start`/`end` aliases — an export that only understood
   * the documented pair would return a different window to a caller still using
   * the old names, which is worse than refusing it.
   */
  const resolveRange = (query: Record<string, unknown>): { start?: string; end?: string } => ({
    start: (query.startDate ?? query.start) as string | undefined,
    end: (query.endDate ?? query.end) as string | undefined,
  });

  router.use(authenticate, requireModuleForUser('reporting'), requirePermission('report.read'));

  // The spec published startDate/endDate while the code read start/end, so a
  // client following the documentation got a 400. Both names are accepted; the
  // documented pair wins.
  router.get('/hours-worked', validateQuery(reportRangeQuery), async (_req: Request, res: Response) => {
    const { start, end } = resolveRange(res.locals.query);
    const { departmentId } = res.locals.query;
    if (!start || !end) {
      return respondError(res, 400, 'VALIDATION_ERROR', 'startDate and endDate are required');
    }
    const data = await service.hoursWorkedByUser(start, end, departmentId);
    res.json({ success: true, data });
  });

  router.get('/hours-worked/export', validateQuery(reportRangeQuery), async (req: Request, res: Response) => {
    const { start, end } = resolveRange(res.locals.query);
    const { departmentId, format } = res.locals.query;
    if (!start || !end) {
      return respondError(res, 400, 'VALIDATION_ERROR', 'startDate and endDate are required');
    }
    // The same service call as the JSON endpoint above, so the two can never
    // disagree about what the report contains.
    const rows = await service.hoursWorkedByUser(start, end, departmentId);
    await exporter.send(res, {
      actorId: req.user?.id ?? null,
      dataset: 'hours-worked',
      rows,
      columns: hoursWorkedColumns,
      filters: { start, end, departmentId },
      format,
    });
  });

  router.get('/cost-by-department', validateQuery(reportRangeQuery), async (_req: Request, res: Response) => {
    const { start, end } = resolveRange(res.locals.query);
    if (!start || !end) {
      return respondError(res, 400, 'VALIDATION_ERROR', 'startDate and endDate are required');
    }
    const data = await service.costByDepartment(start, end);
    res.json({ success: true, data });
  });

  router.get('/cost-by-department/export', validateQuery(reportRangeQuery), async (req: Request, res: Response) => {
    const { start, end } = resolveRange(res.locals.query);
    if (!start || !end) {
      return respondError(res, 400, 'VALIDATION_ERROR', 'startDate and endDate are required');
    }
    const rows = await service.costByDepartment(start, end);
    await exporter.send(res, {
      actorId: req.user?.id ?? null,
      dataset: 'cost-by-department',
      rows,
      columns: costByDepartmentColumns,
      filters: { start, end },
      format: res.locals.query.format,
    });
  });

  // Registered before `/fairness/:scheduleId` would otherwise be tried, so the
  // literal "export" segment is never read as a schedule id.
  router.get(
    '/fairness/:scheduleId/export',
    validateParams(scheduleIdParam),
    validateQuery(fairnessExportQuery),
    async (req: Request, res: Response) => {
      const scheduleId = res.locals.params.scheduleId;
      const report = await service.fairnessForSchedule(scheduleId);
      await exporter.send(res, {
        actorId: req.user?.id ?? null,
        // The dataset name stays constant and the schedule id travels in the
        // filters: it is the audit entry's entity type, and a per-schedule value
        // there would make "show me every fairness export" unanswerable.
        dataset: 'fairness',
        rows: report.perUser,
        // Hours per user IS the fairness breakdown — see exportColumns.
        columns: hoursWorkedColumns,
        filters: { scheduleId },
        format: res.locals.query.format,
      });
    }
  );

  router.get('/fairness/:scheduleId', validateParams(scheduleIdParam), async (_req: Request, res: Response) => {
    const data = await service.fairnessForSchedule(res.locals.params.scheduleId);
    res.json({ success: true, data });
  });

  // No `/export` sibling yet and no frontend chart: this is the backend shape
  // for the decision-support dashboard's compliance-trend slice, landing on
  // its own before anything is built to consume it.
  router.get('/compliance-violations-trend', validateQuery(reportRangeQuery), async (_req: Request, res: Response) => {
    const { start, end } = resolveRange(res.locals.query);
    if (!start || !end) {
      return respondError(res, 400, 'VALIDATION_ERROR', 'startDate and endDate are required');
    }
    const data = await service.complianceViolationsTrend(start, end);
    res.json({ success: true, data });
  });

  return router;
};
