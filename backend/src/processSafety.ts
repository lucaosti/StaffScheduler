/**
 * Process-level safety net for promise rejections nobody handled (#825).
 *
 * WHY. Node's default for an unhandled rejection is to terminate the process.
 * In this backend the realistic source of one is a dependency outage reaching
 * code that runs outside a request — a background tick, a fire-and-forget
 * write — and every replica shares those dependencies, so the default turned
 * one MySQL outage into every replica crash-looping at once (the load/chaos
 * harness counted the restarts). Each known path now handles its own failures
 * (see PollingWorker); this net exists for the one nobody has found yet, so
 * that it costs a log line instead of the fleet.
 *
 * WHY ONLY REJECTIONS, NOT `uncaughtException`. A rejected promise is a value
 * that failed: the code that created it has already run to completion, and the
 * process state is whatever it was. A synchronously thrown exception that
 * reached the event loop has unwound an arbitrary stack mid-operation, and
 * Node's guidance is that continuing after one is unsafe — so that one keeps
 * the default (exit, and the orchestrator restarts the replica).
 *
 * @author Luca Ostinelli
 */

import { logger } from './config/logger';

/** Logs an unhandled rejection with what is needed to find its source, and keeps the process up. */
export const handleUnhandledRejection = (reason: unknown): void => {
  const error = reason instanceof Error ? reason : undefined;
  logger.error('Unhandled promise rejection (process kept running)', {
    message: error ? error.message : String(reason),
    code: (reason as { code?: unknown } | null)?.code,
    stack: error?.stack,
  });
};

/** Installs the handler once; calling it again is a no-op. */
export const installProcessSafetyNet = (): void => {
  if (process.listeners('unhandledRejection').includes(handleUnhandledRejection)) return;
  process.on('unhandledRejection', handleUnhandledRejection);
};
