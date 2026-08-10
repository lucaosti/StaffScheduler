/**
 * Unit tests for fieldPolicyService.
 *
 * @author Luca Ostinelli
 */

import { ApiError } from './apiUtils';
import { listFieldPolicies, saveFieldPolicy, deleteFieldPolicy } from './fieldPolicyService';

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
  global.fetch = jest.fn().mockResolvedValue(
    okJson({ success: true, data: { policies: [], governableCoreFields: [] } })
  ) as jest.Mock;
  localStorage.clear();
  localStorage.setItem('token', 'jwt-token');
});

afterEach(() => jest.resetAllMocks());

const fetchMock = () => global.fetch as jest.Mock;

describe('listFieldPolicies', () => {
  it('GETs /employee-field-policies without a query when no org is given', async () => {
    await listFieldPolicies();
    const [url] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/employee-field-policies$/);
  });

  it('includes organizationName when given', async () => {
    await listFieldPolicies('acme');
    const [url] = fetchMock().mock.calls[0];
    expect(url).toContain('organizationName=acme');
  });

  it('propagates ApiError on failure', async () => {
    global.fetch = jest.fn().mockResolvedValue(errJson(403, 'FORBIDDEN', 'no access'));
    await expect(listFieldPolicies()).rejects.toBeInstanceOf(ApiError);
  });
});

describe('saveFieldPolicy', () => {
  it('PUTs the input to /employee-field-policies', async () => {
    const input = {
      fieldKey: 'phone',
      isRequired: false,
      visiblePermission: null,
      editPermission: null,
      minLength: null,
      maxLength: null,
      minValue: null,
      maxValue: null,
      pattern: null,
      allowedValues: null,
      helpText: null,
      organizationName: null,
    };
    await saveFieldPolicy(input);
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/employee-field-policies$/);
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(String(init?.body))).toEqual(input);
  });
});

describe('deleteFieldPolicy', () => {
  it('DELETEs with fieldKey and organizationName as query params', async () => {
    await deleteFieldPolicy('phone', 'acme');
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/employee-field-policies\?/);
    expect(url).toContain('fieldKey=phone');
    expect(url).toContain('organizationName=acme');
    expect(init?.method).toBe('DELETE');
  });

  it('omits organizationName when null (the global fallback row)', async () => {
    await deleteFieldPolicy('phone', null);
    const [url] = fetchMock().mock.calls[0];
    expect(url).toContain('fieldKey=phone');
    expect(url).not.toContain('organizationName');
  });
});
