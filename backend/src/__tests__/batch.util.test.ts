/**
 * runBatch unit tests.
 */

import { runBatch } from '../utils/batch';
import { ConflictError } from '../errors';

describe('runBatch', () => {
  it('returns an empty result for an empty input', async () => {
    const result = await runBatch<number, number>([], async (n) => n);
    expect(result).toEqual({ results: [], succeeded: 0, failed: 0 });
  });

  it('reports every row as successful when none fail', async () => {
    const result = await runBatch([1, 2, 3], async (n) => n * 2);
    expect(result.succeeded).toBe(3);
    expect(result.failed).toBe(0);
    expect(result.results).toEqual([
      { index: 0, success: true, data: 2 },
      { index: 1, success: true, data: 4 },
      { index: 2, success: true, data: 6 },
    ]);
  });

  it('continues past a failing row and reports its AppError code/message', async () => {
    const result = await runBatch([1, 2, 3], async (n) => {
      if (n === 2) throw new ConflictError('duplicate row');
      return n;
    });

    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.results).toEqual([
      { index: 0, success: true, data: 1 },
      { index: 1, success: false, error: { code: 'CONFLICT', message: 'duplicate row' } },
      { index: 2, success: true, data: 3 },
    ]);
  });

  it('folds a non-AppError into a generic INTERNAL_ERROR without leaking its message', async () => {
    const result = await runBatch([1], async () => {
      throw new Error('a raw driver error with sensitive detail');
    });

    expect(result.failed).toBe(1);
    expect(result.results[0]).toEqual({
      index: 0,
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An internal error occurred' },
    });
  });

  it('preserves input order in the results array regardless of failure position', async () => {
    const result = await runBatch(['a', 'b', 'c', 'd'], async (s, i) => {
      if (i % 2 === 0) throw new ConflictError(`bad ${s}`);
      return s.toUpperCase();
    });

    expect(result.results.map((r) => r.index)).toEqual([0, 1, 2, 3]);
    expect(result.results.map((r) => r.success)).toEqual([false, true, false, true]);
  });
});
