/**
 * Unit tests for directoryService.
 *
 * @author Luca Ostinelli
 */

import { ApiError } from './apiUtils';
import {
  getMyProfile,
  getProfile,
  saveProfileFields,
  removeProfileField,
  vcardUrl,
  previewVcardImport,
  importVcard,
} from './directoryService';

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
  global.fetch = jest.fn().mockResolvedValue(okJson({ success: true, data: {} })) as jest.Mock;
  localStorage.clear();
  localStorage.setItem('token', 'jwt-token');
});

afterEach(() => jest.resetAllMocks());

const fetchMock = () => global.fetch as jest.Mock;

describe('getMyProfile', () => {
  it('GETs /directory/me', async () => {
    await getMyProfile();
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/directory\/me$/);
    expect(init?.method ?? 'GET').toBe('GET');
  });

  it('propagates ApiError on failure', async () => {
    global.fetch = jest.fn().mockResolvedValue(errJson(401, 'UNAUTHORIZED', 'no session'));
    await expect(getMyProfile()).rejects.toBeInstanceOf(ApiError);
  });
});

describe('getProfile', () => {
  it('GETs /directory/users/:id', async () => {
    await getProfile(9);
    const [url] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/directory\/users\/9$/);
  });
});

describe('saveProfileFields', () => {
  it('PUTs the fields to /directory/users/:id/fields', async () => {
    const fields = [{ key: 'phone', value: '555-1234' }];
    await saveProfileFields(9, fields);
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/directory\/users\/9\/fields$/);
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(String(init?.body))).toEqual({ fields });
  });
});

describe('removeProfileField', () => {
  it('DELETEs /directory/users/:id/fields/:key', async () => {
    await removeProfileField(9, 'phone');
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/directory\/users\/9\/fields\/phone$/);
    expect(init?.method).toBe('DELETE');
  });
});

describe('vcardUrl', () => {
  it('builds the per-user vcard download path', () => {
    expect(vcardUrl(9)).toBe('/api/directory/users/9/vcard');
  });
});

describe('previewVcardImport', () => {
  it('POSTs the vcf text to the preview endpoint', async () => {
    await previewVcardImport('BEGIN:VCARD...');
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/directory\/import-vcard\/preview$/);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ vcf: 'BEGIN:VCARD...' });
  });
});

describe('importVcard', () => {
  it('POSTs the vcf and default password to the import endpoint', async () => {
    await importVcard('BEGIN:VCARD...', 'Temp1234!');
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/directory\/import-vcard$/);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      vcf: 'BEGIN:VCARD...',
      defaultPassword: 'Temp1234!',
    });
  });

  it('propagates ApiError on failure', async () => {
    global.fetch = jest.fn().mockResolvedValue(errJson(400, 'VALIDATION_ERROR', 'malformed vcf'));
    await expect(importVcard('bad', 'pw')).rejects.toBeInstanceOf(ApiError);
  });
});
