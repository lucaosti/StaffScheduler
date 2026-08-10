/**
 * Unit tests for approvalWorkflowService.
 *
 * @author Luca Ostinelli
 */

import { ApiError } from './apiUtils';
import {
  listWorkflows,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
} from './approvalWorkflowService';

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

describe('listWorkflows', () => {
  it('GETs /approval-workflows', async () => {
    await listWorkflows();
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/approval-workflows$/);
    expect(init?.method ?? 'GET').toBe('GET');
  });

  it('propagates ApiError on failure', async () => {
    global.fetch = jest.fn().mockResolvedValue(errJson(500, 'INTERNAL_ERROR', 'boom'));
    await expect(listWorkflows()).rejects.toBeInstanceOf(ApiError);
  });
});

describe('createWorkflow', () => {
  it('POSTs the body to /approval-workflows', async () => {
    const body = { changeType: 'TimeOff.Request', requireAll: false, steps: [] } as never;
    await createWorkflow(body);
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/approval-workflows$/);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual(body);
  });
});

describe('updateWorkflow', () => {
  it('PUTs to /approval-workflows/:id', async () => {
    const body = { requireAll: true, steps: [] } as never;
    await updateWorkflow(5, body);
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/approval-workflows\/5$/);
    expect(init?.method).toBe('PUT');
  });

  it('propagates ApiError on a 404', async () => {
    global.fetch = jest.fn().mockResolvedValue(errJson(404, 'NOT_FOUND', 'not found'));
    await expect(updateWorkflow(99, { steps: [] } as never)).rejects.toBeInstanceOf(ApiError);
  });
});

describe('deleteWorkflow', () => {
  it('DELETEs /approval-workflows/:id', async () => {
    await deleteWorkflow(5);
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/approval-workflows\/5$/);
    expect(init?.method).toBe('DELETE');
  });
});
