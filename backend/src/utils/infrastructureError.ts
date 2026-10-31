/**
 * Telling an infrastructure failure apart from everything else (#968).
 *
 * WHY. When MySQL is unreachable, every query rejects — and the code that
 * catches it cannot otherwise tell "the database is down" from "this request
 * hit a bug". Rendered as a 500, an outage looks like a defect: clients do not
 * retry it, and the auth middleware's 500 AUTH_ERROR read to the frontend like
 * a broken session. Classifying the failure lets those paths answer what is
 * true — 503, retry later — while a genuine fault (a bad column, a constraint)
 * keeps its 500.
 *
 * WHY BY DRIVER CODE AND `fatal`, NOT BY MESSAGE. mysql2 marks every error
 * that killed its connection with `fatal: true`, and connection failures carry
 * a stable socket or protocol code. Both are part of the driver's error
 * contract; messages are prose and change between versions (and dispatching
 * on them is banned in routes for that reason). The list is deliberately the
 * connectivity failures only: a lock-wait timeout or a deadlock is contention,
 * handled by `withTransaction`'s retry, and must not be reported as an outage.
 *
 * @author Luca Ostinelli
 */

/** Seconds a client is told to wait before retrying during an outage. */
export const OUTAGE_RETRY_AFTER_SECONDS = 5;

const INFRASTRUCTURE_CODES = new Set([
  // Socket-level: the server is not there, or stopped answering.
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  // mysql2 protocol: the connection died under the query.
  'PROTOCOL_CONNECTION_LOST',
  'PROTOCOL_SEQUENCE_TIMEOUT',
  // Server-side refusals that are about capacity or availability.
  'ER_CON_COUNT_ERROR',
  'ER_SERVER_SHUTDOWN',
]);

/** True when `error` says a dependency could not be reached, not that the request or the code is wrong. */
export const isInfrastructureError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const { code, fatal } = error as { code?: unknown; fatal?: unknown };
  return fatal === true || (typeof code === 'string' && INFRASTRUCTURE_CODES.has(code));
};
