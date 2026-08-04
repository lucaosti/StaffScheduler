/**
 * Shift swap service — wraps `/api/shift-swap`.
 *
 * `GET /shift-swap` is self-scoped server-side: an approver may list anyone's
 * requests, and everyone else is pinned to their own, with a `userId` filter
 * from a non-approver ignored rather than obeyed. So the caller does not pass
 * one, and a page that did would be describing a filter the server does not
 * apply.
 *
 * @author Luca Ostinelli
 */

import { ApiResponse, ShiftSwapRequest } from '../types';
import type { paths } from '../api/schema';
import { apiClient } from '../api/client';

export type SwapFilters = NonNullable<paths['/shift-swap']['get']['parameters']['query']>;
type CreateSwapBody = NonNullable<
  paths['/shift-swap']['post']['requestBody']
>['content']['application/json'];
type DecisionBody = NonNullable<
  paths['/shift-swap/{id}/approve']['post']['requestBody']
>['content']['application/json'];
type RespondBody = NonNullable<
  paths['/shift-swap/{id}/respond']['post']['requestBody']
>['content']['application/json'];

export interface SwapCandidate {
  assignmentId: number;
  userId: number;
  userName: string;
  shiftId: number;
  date: string;
  startTime: string;
  endTime: string;
  departmentName: string;
}

export interface SwapCandidates {
  candidates: SwapCandidate[];
  /** True when more matched than were examined, so the list is a prefix. */
  truncated: boolean;
}

export const getSwapRequests = (
  filters: SwapFilters = {}
): Promise<ApiResponse<ShiftSwapRequest[]>> =>
  apiClient.get<ShiftSwapRequest[], '/shift-swap'>('/shift-swap', { query: filters });

export const createSwapRequest = (
  body: CreateSwapBody
): Promise<ApiResponse<ShiftSwapRequest>> =>
  apiClient.post<ShiftSwapRequest, '/shift-swap'>('/shift-swap', body);

/** The target's own decision on a pending swap (#522) — accept routes it to the manager, decline ends it. */
export const respondToSwap = (
  id: number,
  accepted: boolean,
  notes?: string
): Promise<ApiResponse<ShiftSwapRequest>> =>
  apiClient.post<ShiftSwapRequest, '/shift-swap/{id}/respond'>(
    '/shift-swap/{id}/respond',
    { accepted, notes } satisfies RespondBody,
    { params: { id } }
  );

export const approveSwap = (id: number, notes?: string): Promise<ApiResponse<ShiftSwapRequest>> =>
  apiClient.post<ShiftSwapRequest, '/shift-swap/{id}/approve'>(
    '/shift-swap/{id}/approve',
    { notes } satisfies DecisionBody,
    { params: { id } }
  );

export const declineSwap = (id: number, notes?: string): Promise<ApiResponse<ShiftSwapRequest>> =>
  apiClient.post<ShiftSwapRequest, '/shift-swap/{id}/decline'>(
    '/shift-swap/{id}/decline',
    { notes } satisfies DecisionBody,
    { params: { id } }
  );

export const cancelSwap = (id: number): Promise<ApiResponse<ShiftSwapRequest>> =>
  apiClient.post<ShiftSwapRequest, '/shift-swap/{id}/cancel'>(
    '/shift-swap/{id}/cancel',
    undefined,
    { params: { id } }
  );

export const getSwapCandidates = (assignmentId: number): Promise<ApiResponse<SwapCandidates>> =>
  apiClient.get<SwapCandidates, '/assignments/{id}/swap-candidates'>(
    '/assignments/{id}/swap-candidates',
    { params: { id: assignmentId } }
  );
