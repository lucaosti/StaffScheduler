/**
 * Policies, exception requests, and approval-matrix client.
 *
 * Routed through the generated client so path, method, body and query are all
 * checked against the OpenAPI contract at compile time; filters and request
 * bodies are derived from it rather than retyped. See `departmentService` for
 * the full rationale.
 *
 * WHY THE UNIONS ARE NOW DERIVED: `PolicyScope`, the exception status and the
 * approver scope were three hand-written unions repeating enums the schemas
 * already declare — `Policy.scopeType` in particular is the field whose
 * hand-written OpenAPI component once described an entirely different model
 * (`key`/`label`/`value`/`valueType`/`category`) before it was generated from
 * `policySchema`. Taking them from `paths` means a value the endpoint rejects
 * cannot be constructed here, and a scope added server-side shows up as a
 * compile error at every place that switches on it rather than as a silently
 * unhandled case.
 *
 * The response types stay hand-written: policies ARE in
 * `packages/shared/src/domain.ts`, but its `Policy` describes the wire row
 * while these local shapes carry what this UI reads, and merging the two is a
 * separate change from routing the calls. `PolicyExceptionRequest`,
 * `ApprovalMatrixRow` and `PolicyViolation` have no shared declaration at all.
 *
 * @author Luca Ostinelli
 */

import { ApiResponse } from '../types';
import type { paths } from '../api/schema';
import { apiClient } from '../api/client';

export type CreatePolicyInput =
  paths['/policies']['post']['requestBody']['content']['application/json'];
export type UpdatePolicyInput = NonNullable<
  paths['/policies/{id}']['put']['requestBody']
>['content']['application/json'];
export type ExceptionFilters = NonNullable<
  paths['/policies/exceptions']['get']['parameters']['query']
>;
export type CreateExceptionInput =
  paths['/policies/exceptions']['post']['requestBody']['content']['application/json'];
export type UpdateMatrixInput = NonNullable<
  paths['/policies/approval-matrix/{changeType}']['put']['requestBody']
>['content']['application/json'];
export type ValidateAssignmentInput =
  paths['/policies/validate/assignment']['post']['requestBody']['content']['application/json'];

type ExceptionNotesBody = NonNullable<
  paths['/policies/exceptions/{id}/approve']['post']['requestBody']
>['content']['application/json'];

export type PolicyScope = CreatePolicyInput['scopeType'];
type ExceptionStatus = NonNullable<ExceptionFilters['status']>;
type ApproverScope = NonNullable<UpdateMatrixInput['approverScope']>;

export interface Policy {
  id: number;
  scopeType: PolicyScope;
  scopeId: number | null;
  policyKey: string;
  policyValue: unknown;
  description: string | null;
  imposedByUserId: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PolicyExceptionRequest {
  id: number;
  policyId: number;
  targetType: string;
  targetId: number;
  reason: string | null;
  status: ExceptionStatus;
  requestedByUserId: number;
  reviewerUserId: number | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalMatrixRow {
  id: number;
  changeType: string;
  approverScope: ApproverScope;
  // FK to roles.id — matches the backend's approval_matrix.approver_role_id.
  approverRoleId: number | null;
  approverUserId: number | null;
  autoApproveForOwner: boolean;
  description: string | null;
}

interface PolicyViolation {
  policyId: number;
  policyKey: string;
  scopeType: PolicyScope;
  scopeId: number | null;
  message: string;
  hasApprovedException: boolean;
  imposedByUserId: number;
}

// -------- Policies --------

export const listPolicies = (): Promise<ApiResponse<Policy[]>> =>
  apiClient.get<Policy[], '/policies'>('/policies');

export const getPolicy = (id: number): Promise<ApiResponse<Policy>> =>
  apiClient.get<Policy, '/policies/{id}'>('/policies/{id}', { params: { id } });

export const createPolicy = (input: CreatePolicyInput): Promise<ApiResponse<Policy>> =>
  apiClient.post<Policy, '/policies'>('/policies', input);

export const updatePolicy = (
  id: number,
  patch: UpdatePolicyInput
): Promise<ApiResponse<Policy>> =>
  apiClient.put<Policy, '/policies/{id}'>('/policies/{id}', patch, { params: { id } });

export const deletePolicy = (id: number): Promise<ApiResponse<void>> =>
  apiClient.delete<void, '/policies/{id}'>('/policies/{id}', { params: { id } });

// -------- Exceptions --------

export const listExceptions = (
  filters: ExceptionFilters = {}
): Promise<ApiResponse<PolicyExceptionRequest[]>> =>
  apiClient.get<PolicyExceptionRequest[], '/policies/exceptions'>('/policies/exceptions', {
    query: filters,
  });

export const createException = (
  input: CreateExceptionInput
): Promise<ApiResponse<PolicyExceptionRequest>> =>
  apiClient.post<PolicyExceptionRequest, '/policies/exceptions'>('/policies/exceptions', input);

export const approveException = (
  id: number,
  notes?: string
): Promise<ApiResponse<PolicyExceptionRequest>> =>
  apiClient.post<PolicyExceptionRequest, '/policies/exceptions/{id}/approve'>(
    '/policies/exceptions/{id}/approve',
    { notes: notes ?? null } satisfies ExceptionNotesBody,
    { params: { id } }
  );

export const rejectException = (
  id: number,
  notes?: string
): Promise<ApiResponse<PolicyExceptionRequest>> =>
  apiClient.post<PolicyExceptionRequest, '/policies/exceptions/{id}/reject'>(
    '/policies/exceptions/{id}/reject',
    { notes: notes ?? null },
    { params: { id } }
  );

export const cancelException = (id: number): Promise<ApiResponse<PolicyExceptionRequest>> =>
  apiClient.post<PolicyExceptionRequest, '/policies/exceptions/{id}/cancel'>(
    '/policies/exceptions/{id}/cancel',
    undefined,
    { params: { id } }
  );

// -------- Approval matrix --------

export const listMatrix = (): Promise<ApiResponse<ApprovalMatrixRow[]>> =>
  apiClient.get<ApprovalMatrixRow[], '/policies/approval-matrix'>('/policies/approval-matrix');

/**
 * `changeType` is a string path parameter, so it is passed through uncoerced;
 * the client escapes it, which is what the removed `encodeURIComponent` was
 * doing by hand.
 */
export const updateMatrix = (
  changeType: string,
  patch: UpdateMatrixInput
): Promise<ApiResponse<ApprovalMatrixRow>> =>
  apiClient.put<ApprovalMatrixRow, '/policies/approval-matrix/{changeType}'>(
    '/policies/approval-matrix/{changeType}',
    patch,
    { params: { changeType } }
  );

// -------- Validation --------

export const validateAssignment = (
  input: ValidateAssignmentInput
): Promise<ApiResponse<{ ok: boolean; violations: PolicyViolation[] }>> =>
  apiClient.post<{ ok: boolean; violations: PolicyViolation[] }, '/policies/validate/assignment'>(
    '/policies/validate/assignment',
    input
  );
