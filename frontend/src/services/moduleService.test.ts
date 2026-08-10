/**
 * Unit tests for moduleService.
 *
 * @author Luca Ostinelli
 */

import { ApiError } from './apiUtils';
import {
  listModules,
  listModulesForOrg,
  setModuleEnabled,
  setModuleOrgOverride,
  removeModuleOrgOverride,
} from './moduleService';

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

describe('listModules', () => {
  it('GETs /modules', async () => {
    await listModules();
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/modules$/);
    expect(init?.method ?? 'GET').toBe('GET');
  });

  it('propagates ApiError on failure', async () => {
    global.fetch = jest.fn().mockResolvedValue(errJson(500, 'INTERNAL_ERROR', 'boom'));
    await expect(listModules()).rejects.toBeInstanceOf(ApiError);
  });
});

describe('listModulesForOrg', () => {
  it('GETs /modules/org/:org, escaping the org string', async () => {
    await listModulesForOrg('acme/co');
    const [url] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/modules\/org\/acme%2Fco$/);
  });
});

describe('setModuleEnabled', () => {
  it('PUTs isEnabled and justification to /modules/:code', async () => {
    await setModuleEnabled('attendance', true, 'rollout');
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/modules\/attendance$/);
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(String(init?.body))).toEqual({ isEnabled: true, justification: 'rollout' });
  });

  it('sends null justification when none is given', async () => {
    await setModuleEnabled('attendance', false);
    const [, init] = fetchMock().mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({ isEnabled: false, justification: null });
  });
});

describe('setModuleOrgOverride', () => {
  it('PUTs to /modules/:code/org/:org', async () => {
    await setModuleOrgOverride('attendance', 'acme', true, 'pilot');
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/modules\/attendance\/org\/acme$/);
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(String(init?.body))).toEqual({ isEnabled: true, justification: 'pilot' });
  });

  it('sends null justification when none is given', async () => {
    await setModuleOrgOverride('attendance', 'acme', false);
    const [, init] = fetchMock().mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({ isEnabled: false, justification: null });
  });
});

describe('removeModuleOrgOverride', () => {
  it('DELETEs /modules/:code/org/:org', async () => {
    await removeModuleOrgOverride('attendance', 'acme');
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/modules\/attendance\/org\/acme$/);
    expect(init?.method).toBe('DELETE');
  });
});
