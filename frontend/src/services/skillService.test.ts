/**
 * Unit tests for skillService.
 *
 * @author Luca Ostinelli
 */

import { ApiError } from './apiUtils';
import { getSkills, createSkill, updateSkill, deleteSkill } from './skillService';

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

describe('getSkills', () => {
  it('GETs /skills with filters', async () => {
    await getSkills({ isActive: true } as never);
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/skills\?/);
    expect(url).toContain('isActive=true');
    expect(init?.method ?? 'GET').toBe('GET');
  });

  it('propagates ApiError on failure', async () => {
    global.fetch = jest.fn().mockResolvedValue(errJson(500, 'INTERNAL_ERROR', 'boom'));
    await expect(getSkills()).rejects.toBeInstanceOf(ApiError);
  });
});

describe('createSkill', () => {
  it('POSTs the body to /skills', async () => {
    const body = { name: 'First Aid' } as never;
    await createSkill(body);
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/skills$/);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual(body);
  });
});

describe('updateSkill', () => {
  it('PUTs to /skills/:id', async () => {
    await updateSkill(4, { name: 'Advanced First Aid' } as never);
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/skills\/4$/);
    expect(init?.method).toBe('PUT');
  });
});

describe('deleteSkill', () => {
  it('DELETEs /skills/:id', async () => {
    await deleteSkill(4);
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/skills\/4$/);
    expect(init?.method).toBe('DELETE');
  });

  it('propagates ApiError when the skill is still in use', async () => {
    global.fetch = jest.fn().mockResolvedValue(errJson(409, 'CONFLICT', 'skill in use'));
    await expect(deleteSkill(4)).rejects.toBeInstanceOf(ApiError);
  });
});
