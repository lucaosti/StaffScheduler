/**
 * Default MSW request handlers for tests (MSW v1 API).
 *
 * Each handler returns the same envelope shape (`{ success, data }`)
 * the real backend uses (see `backend/src/app.ts` and the OpenAPI
 * contract). Tests can override individual handlers per-test by
 * calling `server.use(...)`.
 *
 * @author Luca Ostinelli
 */

import { rest, RestRequest, ResponseComposition, RestContext } from 'msw';

const apiUrl = process.env.REACT_APP_API_URL ?? 'http://localhost:3001/api';

const ok =
  <T>(data: T) =>
  (_req: RestRequest, res: ResponseComposition, ctx: RestContext) =>
    res(ctx.status(200), ctx.json({ success: true, data }));

export const defaultDashboardStats = {
  totalEmployees: 12,
  activeSchedules: 3,
  todayShifts: 7,
  pendingApprovals: 2,
  monthlyHours: 1280,
  monthlyCost: 24600,
  coverageRate: 92.0,
  employeeSatisfaction: 4.4,
};

export const handlers = [
  rest.get(`${apiUrl}/dashboard/stats`, ok(defaultDashboardStats)),
  rest.get(`${apiUrl}/system/info`, ok({ mode: 'demo', appVersion: 'test', features: {} })),
  rest.get(
    `${apiUrl}/auth/me`,
    ok({ id: 1, email: 'admin@demo.staffscheduler.local', role: 'admin' })
  ),
  rest.get(`${apiUrl}/employees`, ok([])),
  rest.get(`${apiUrl}/schedules`, ok([])),
  rest.get(`${apiUrl}/shifts`, ok([])),
  rest.get(`${apiUrl}/notifications`, ok([])),
];
