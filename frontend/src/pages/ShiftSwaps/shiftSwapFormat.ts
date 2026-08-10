/**
 * Shared one-line summaries for a shift, a swap candidate, and an open
 * offer — used across ShiftSwaps.tsx and its section components so the same
 * assignment reads identically wherever it appears.
 *
 * @author Luca Ostinelli
 */

import type { ShiftAssignment } from '../../types';
import type { SwapCandidate, ShiftSwapOffer } from '../../services/shiftSwapService';
import { formatTime } from '../../utils/format';

// Module-private: only the describe* helpers below call it directly; nothing
// outside this file needs the bare time formatter.
const shiftTime = (value?: string): string => formatTime(value) || '—';

export const describe = (a: ShiftAssignment): string =>
  `${String(a.shiftDate ?? '').slice(0, 10)} ${shiftTime(a.startTime)}–${shiftTime(a.endTime)}`;

export const describeCandidate = (c: SwapCandidate): string =>
  `${c.date} ${shiftTime(c.startTime)}–${shiftTime(c.endTime)}`;

export const describeOffer = (o: ShiftSwapOffer): string =>
  `${o.date} ${shiftTime(o.startTime)}–${shiftTime(o.endTime)}`;
