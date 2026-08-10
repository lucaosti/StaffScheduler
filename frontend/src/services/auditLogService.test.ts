/**
 * Unit tests for auditLogService.
 *
 * @author Luca Ostinelli
 */

import { ApiError } from './apiUtils';
import { API_BASE_URL } from './apiUtils';
import { listAuditLogs, buildExportUrl } from './auditLogService';

const okJson = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const errJson = (status: number, code: string, message: string): Response =>
  new Response(JSON.stringify({ success: false, error: { code, message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue(okJson({ success: true, data: [] })) as jest.Mock;
  localStorage.clear();
  localStorage.setItem('token', 'jwt-token');
});

afterEach(() => jest.resetAllMocks());

const fetchMock = () => global.fetch as jest.Mock;

describe('listAuditLogs', () => {
  it('GETs /audit-logs with filters', async () => {
    await listAuditLogs({ entityType: 'shift', page: 2 } as never);
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/audit-logs\?/);
    expect(url).toContain('entityType=shift');
    expect(init?.method ?? 'GET').toBe('GET');
  });

  it('defaults to no filters', async () => {
    await listAuditLogs();
    const [url] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/audit-logs/);
  });

  it('propagates ApiError on failure', async () => {
    global.fetch = jest.fn().mockResolvedValue(errJson(403, 'FORBIDDEN', 'no access'));
    await expect(listAuditLogs()).rejects.toBeInstanceOf(ApiError);
  });
});

describe('buildExportUrl', () => {
  it('always includes the format', () => {
    const url = buildExportUrl({}, 'csv');
    expect(url).toBe(`${API_BASE_URL}/audit-logs/export?format=csv`);
  });

  it('includes every defined filter', () => {
    const url = buildExportUrl({ entityId: 42, requestId: 'req-1', onBehalfOfUserId: 7 } as never, 'json');
    expect(url).toContain('format=json');
    expect(url).toContain('entityId=42');
    expect(url).toContain('requestId=req-1');
    expect(url).toContain('onBehalfOfUserId=7');
  });

  it('omits undefined/null filters', () => {
    const url = buildExportUrl({ entityId: undefined } as never, 'csv');
    expect(url).not.toContain('entityId');
  });
});
