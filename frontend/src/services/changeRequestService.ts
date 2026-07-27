/**
 * Change requests API client.
 *
 * Routed through the generated client so path, method, body and query are all
 * checked against the OpenAPI contract at compile time; filters and request
 * bodies are derived from it rather than retyped. See `departmentService` for
 * the full rationale.
 *
 * WHY THE FILTERS ARE DERIVED: the hand-written filter object omitted
 * `targetEntityType`, which `GET /change-requests` accepts — so the queue could
 * not be narrowed to one kind of proposal, and the manual `URLSearchParams`
 * ladder below it was the thing actually deciding what reached the wire. Same
 * omission class as the audit log's missing `onBehalfOfUserId`.
 *
 * `ChangeRequest` stays hand-written: it is not among the entities declared in
 * `packages/shared/src/domain.ts`, so there is nothing to derive the response
 * shape from yet.
 *
 * @author Luca Ostinelli
 */

import { ApiResponse } from '../types';
import type { paths } from '../api/schema';
import { apiClient } from '../api/client';

export type ChangeRequestStatus = 'pending' | 'approved' | 'rejected' | 'applied' | 'cancelled';

export interface ChangeRequest {
  id: number;
  changeType: string;
  proposerUserId: number;
  targetEntityType: string;
  targetEntityId: number | null;
  proposedPayload: Record<string, unknown>;
  justification: string | null;
  status: ChangeRequestStatus;
  approverUserId: number | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  appliedAt: string | null;
  onBehalfOfUserId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChangeRequestPage {
  total: number;
  items: ChangeRequest[];
}

export type ChangeRequestFilters = NonNullable<
  paths['/change-requests']['get']['parameters']['query']
>;
export type CreateChangeRequestInput =
  paths['/change-requests']['post']['requestBody']['content']['application/json'];

type JustificationBody = NonNullable<
  paths['/change-requests/{id}/approve']['post']['requestBody']
>['content']['application/json'];
type RejectBody = NonNullable<
  paths['/change-requests/{id}/reject']['post']['requestBody']
>['content']['application/json'];

export const listChangeRequests = (
  filters: ChangeRequestFilters = {}
): Promise<ApiResponse<ChangeRequestPage>> =>
  apiClient.get<ChangeRequestPage, '/change-requests'>('/change-requests', { query: filters });

export const createChangeRequest = (
  input: CreateChangeRequestInput
): Promise<ApiResponse<ChangeRequest>> =>
  apiClient.post<ChangeRequest, '/change-requests'>('/change-requests', input);

export const approveChangeRequest = (
  id: number,
  justification?: string | null
): Promise<ApiResponse<ChangeRequest>> =>
  apiClient.post<ChangeRequest, '/change-requests/{id}/approve'>(
    '/change-requests/{id}/approve',
    { justification } satisfies JustificationBody,
    { params: { id } }
  );

export const rejectChangeRequest = (
  id: number,
  rejectionReason: string
): Promise<ApiResponse<ChangeRequest>> =>
  apiClient.post<ChangeRequest, '/change-requests/{id}/reject'>(
    '/change-requests/{id}/reject',
    { rejectionReason } satisfies RejectBody,
    { params: { id } }
  );

export const applyChangeRequest = (
  id: number,
  justification?: string | null
): Promise<ApiResponse<ChangeRequest>> =>
  apiClient.post<ChangeRequest, '/change-requests/{id}/apply'>(
    '/change-requests/{id}/apply',
    { justification },
    { params: { id } }
  );

export const cancelChangeRequest = (id: number): Promise<ApiResponse<ChangeRequest>> =>
  apiClient.post<ChangeRequest, '/change-requests/{id}/cancel'>(
    '/change-requests/{id}/cancel',
    undefined,
    { params: { id } }
  );
