import { http, HttpResponse } from 'msw';

const apiUrl = process.env.REACT_APP_API_URL ?? 'http://localhost:3001/api';

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
