/**
 * GustoProvider unit tests — the parts PayrollExportWorker's own tests don't
 * reach directly: the abort timeout, a response body that fails to parse,
 * and a well-formed-but-incomplete response.
 */

import { GustoProvider, isGustoConfigured } from '../services/GustoProvider';
import { config } from '../config';

const originalFetch = global.fetch;

const batch = {
  rangeStart: '2026-05-01',
  rangeEnd: '2026-05-31',
  lines: [{ userId: 1, fullName: 'Anna Demo', email: 'anna@example.com', hours: 40, grossPay: 800 }],
};

beforeEach(() => {
  global.fetch = jest.fn();
  config.gusto.apiKey = 'test-key';
  config.gusto.companyId = 'test-company';
});

afterEach(() => {
  global.fetch = originalFetch;
  config.gusto.apiKey = undefined;
  config.gusto.companyId = undefined;
});

describe('isGustoConfigured', () => {
  it('is false when either the api key or the company id is missing', () => {
    config.gusto.apiKey = undefined;
    expect(isGustoConfigured()).toBe(false);
    config.gusto.apiKey = 'test-key';
    config.gusto.companyId = undefined;
    expect(isGustoConfigured()).toBe(false);
  });

  it('is true once both are set', () => {
    expect(isGustoConfigured()).toBe(true);
  });
});

describe('GustoProvider.export', () => {
  it('refuses to run when not configured, without making a request', async () => {
    config.gusto.apiKey = undefined;
    await expect(new GustoProvider().export(batch)).rejects.toThrow(/not configured/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns the provider reference on success', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 'run_1' }),
    });
    const result = await new GustoProvider().export(batch);
    expect(result).toEqual({ providerReference: 'run_1' });
  });

  it('throws when the response body has no id, even though the request succeeded', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    });
    await expect(new GustoProvider().export(batch)).rejects.toThrow(/did not include an import id/);
  });

  it('falls back to an empty object when the success body fails to parse as JSON', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.reject(new Error('not json')),
    });
    // No id survives an unparseable body, so this is the same "no id" failure,
    // reached through the .catch(() => ({})) fallback rather than a real body.
    await expect(new GustoProvider().export(batch)).rejects.toThrow(/did not include an import id/);
  });

  it('includes the response body text in the error when the request fails', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 422,
      text: () => Promise.resolve('invalid pay period'),
    });
    await expect(new GustoProvider().export(batch)).rejects.toThrow(/422: invalid pay period/);
  });

  it('still reports the status when the failure body cannot be read', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.reject(new Error('stream closed')),
    });
    await expect(new GustoProvider().export(batch)).rejects.toThrow(/^Gusto responded 500$/);
  });

  it('aborts the request once the timeout elapses', async () => {
    jest.useFakeTimers();
    try {
      (global.fetch as jest.Mock).mockImplementationOnce(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(new Error('This operation was aborted')));
          })
      );
      const resultPromise = new GustoProvider().export(batch);
      const assertion = expect(resultPromise).rejects.toThrow(/aborted/);
      await jest.advanceTimersByTimeAsync(15_000);
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });
});
