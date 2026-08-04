/**
 * MSW request handlers: the default HTTP responses unit tests render against.
 *
 * WHY INTERCEPT AT THE NETWORK LAYER RATHER THAN MOCKING THE SERVICE MODULES.
 * `jest.mock('../services/xService')` replaces the module, so the test exercises
 * neither the URL the service builds nor the response parsing in
 * `handleResponse` — the two places frontend/backend contract drift actually
 * shows up. Intercepting the request instead keeps the whole client path under
 * test and means a service that starts calling the wrong endpoint fails here
 * rather than passing against its own stub.
 *
 * It also avoids a failure mode this codebase hit for real: a module mock that
 * lists only the functions a test needs silently drops the module's other
 * exports, so a component calling a newly-added pure helper gets `undefined`
 * and throws for reasons unrelated to what is being tested.
 *
 * WHY THE HANDLERS ARE PERMISSIVE DEFAULTS. They return well-formed success
 * envelopes with plausible data so a page renders without each test restating
 * the whole API. A test that cares about a specific response overrides the one
 * handler it needs with `server.use(...)`; anything not overridden should be
 * background rather than a reason for the test to fail.
 *
 * The base URL is read from `REACT_APP_API_URL`, which `setupTests` pins to an
 * absolute value — Node's fetch rejects the relative `/api` the app uses at
 * runtime, so handlers must be registered against the same absolute base.
 *
 * @author Luca Ostinelli
 */

import { http, HttpResponse } from 'msw';

const apiUrl = process.env.REACT_APP_API_URL ?? 'http://localhost:3001/api/v1';

const ok = <T>(data: T) =>
  () => HttpResponse.json({ success: true, data });

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
  http.get(`${apiUrl}/dashboard/stats`, ok(defaultDashboardStats)),
  http.get(`${apiUrl}/audit-logs`, ok([])),
  http.get(`${apiUrl}/system/info`, ok({ mode: 'demo', appVersion: 'test', features: {} })),
  http.get(`${apiUrl}/auth/me`, ok({ id: 1, email: 'admin@demo.staffscheduler.local', role: 'admin' })),
  http.get(`${apiUrl}/employees`, ok([])),
  http.get(`${apiUrl}/schedules`, ok([])),
  http.get(`${apiUrl}/shifts`, ok([])),
  http.get(`${apiUrl}/notifications`, ok([])),
];
