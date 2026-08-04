/**
 * Runs an async operation once per input row, collecting one outcome per row
 * instead of aborting the whole batch on the first failure (#316).
 *
 * A row's own error is caught here rather than left to `asyncHandler`: an
 * `AppError` reports its stable code/message, and anything else — a bug, not
 * an expected domain outcome — is logged and folded into a generic
 * `INTERNAL_ERROR` per row, the same distinction `errorHandler` draws for the
 * response as a whole.
 *
 * @author Luca Ostinelli
 */

import { BatchResult, BatchRowResult } from '@staff-scheduler/shared';
import { AppError } from '../errors';
import { logger } from '../config/logger';

export const runBatch = async <TIn, TOut>(
  items: TIn[],
  fn: (item: TIn, index: number) => Promise<TOut>
): Promise<BatchResult<TOut>> => {
  const results: BatchRowResult<TOut>[] = [];
  let succeeded = 0;
  let failed = 0;

  for (let index = 0; index < items.length; index++) {
    try {
      const data = await fn(items[index], index);
      results.push({ index, success: true, data });
      succeeded++;
    } catch (error) {
      if (error instanceof AppError) {
        results.push({ index, success: false, error: { code: error.code, message: error.message } });
      } else {
        logger.error(`Batch row ${index} failed with an unexpected error:`, error);
        results.push({ index, success: false, error: { code: 'INTERNAL_ERROR', message: 'An internal error occurred' } });
      }
      failed++;
    }
  }

  return { results, succeeded, failed };
};
