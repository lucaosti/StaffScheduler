/**
 * Shared error-message-to-HTTP-status mapping for the "service throws a
 * plain Error, route maps it to a status code" pattern used across
 * timeOff.ts, shiftSwap.ts, org.ts (loan routes), attendance.ts and
 * pendingApprovals.ts. Every one of those routes had its own copy of this
 * exact 404/403/409 ladder; this is the single source of truth for it.
 *
 * @author Luca Ostinelli
 */

export interface MappedError {
  status: number;
  code: 'NOT_FOUND' | 'FORBIDDEN' | 'CONFLICT';
  message: string;
}

/**
 * Maps a thrown Error's message to a status: "not found" → 404, a
 * forbidden/not-authorized message → 403, anything else → 409 (the
 * message is assumed to describe a business-rule conflict, e.g. "Cannot
 * approve request in status 'approved'").
 */
export function mapServiceError(error: unknown): MappedError {
  const msg = error instanceof Error ? error.message : String(error);
  if (msg.toLowerCase().includes('not found')) {
    return { status: 404, code: 'NOT_FOUND', message: msg };
  }
  if (msg.toLowerCase().includes('forbidden') || msg.includes('Not authorized')) {
    return { status: 403, code: 'FORBIDDEN', message: msg };
  }
  return { status: 409, code: 'CONFLICT', message: msg };
}
