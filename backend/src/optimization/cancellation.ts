/**
 * The cancellation signal of the optimization run in progress (#966).
 *
 * WHY ASYNCLOCALSTORAGE AND NOT A PARAMETER. Cancelling a running job has to
 * reach two places far apart: the queue worker that learns of the request,
 * and the engines that must stop — the CP-SAT child process to kill, and the
 * greedy loop to abandon — four calls down through the orchestrator and the
 * auto-schedule service. Threading an `AbortSignal` parameter through every
 * signature in between would change the public shape of each layer for a
 * concern only the queued path has (the synchronous path cannot be
 * cancelled at all). The signal travels with the async context instead, the
 * way the request id does (middleware/requestContext.ts): set once by the
 * worker, read where it matters, absent — so every check is a no-op —
 * everywhere else.
 *
 * WHAT A CANCELLED RUN DOES. The engines reject with
 * `OptimizationCancelledError` rather than returning, and in particular
 * never fall back to greedy: a fallback would produce, and let the caller
 * persist, the very schedule the planner just cancelled. Rejecting before the
 * persistence step is what guarantees nothing is written. A run whose solve
 * has already finished when the request arrives is past that point and
 * completes; cancellation is cooperative, not a rollback.
 *
 * @author Luca Ostinelli
 */

import { AsyncLocalStorage } from 'async_hooks';
import { OptimizationCancelledError } from '../errors';

const storage = new AsyncLocalStorage<AbortSignal>();

/** Runs `work` with `signal` as the cancellation signal of everything it awaits. */
export const runWithCancellation = <T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> =>
  storage.run(signal, work);

/** The signal of the run in progress, or undefined outside a cancellable run. */
export const currentCancellationSignal = (): AbortSignal | undefined => storage.getStore();

/** Throws `OptimizationCancelledError` when the run in progress has been cancelled. */
export const throwIfCancelled = (): void => {
  if (storage.getStore()?.aborted) throw new OptimizationCancelledError();
};
