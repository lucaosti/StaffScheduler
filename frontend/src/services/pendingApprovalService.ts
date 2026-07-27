/**
 * Pending approval service — wraps the `/api/pending-approvals` endpoints.
 *
 * Routed through the generated client so path, method, body and query are all
 * checked against the OpenAPI contract at compile time; filters and request
 * bodies are derived from it rather than retyped. See `departmentService` for
 * the full rationale.
 *
 * WHY THIS MODULE IS WORTH THE CARE: these calls are decisions. Approve,
 * reject, keep, delegate and open-to-structure each move an item through the
 * ApprovalStateMachine, which is the single authority on legal transitions and
 * throws on an illegal one. A wrong path or a dropped body field here does not
 * produce a cosmetic bug — it produces a decision attributed to the wrong
 * person, or a note that never reached the audit row explaining why.
 *
 * The response types stay hand-written: pending approvals are not among the
 * entities declared in `packages/shared/src/domain.ts`, so there is nothing to
 * derive them from yet. `PendingApprovalItem` in particular carries joined
 * context fields (`changeType`, `proposedPayload`, `proposerUserId`) that are
 * a projection rather than a table.
 *
 * @author Luca Ostinelli
 */

import { ApiResponse } from '../types';
import type { paths } from '../api/schema';
import { apiClient } from '../api/client';

type PendingApprovalStatus = 'pending' | 'approved' | 'rejected' | 'escalated';

export interface PendingApprovalItem {
  id: number;
  changeRequestId: number | null;
  timeOffRequestId: number | null;
  employeeLoanId: number | null;
  shiftSwapRequestId: number | null;
  workflowId: number;
  stepId: number;
  stepOrder: number;
  assignedToUserId: number | null;
  assignedToOrgUnitId: number | null;
  openToStructure: boolean;
  decidedByUserId: number | null;
  status: PendingApprovalStatus;
  decidedAt: string | null;
  decisionNote: string | null;
  escalatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // Context fields
  changeType: string;
  targetEntityType: 'change_request' | 'time_off_request' | 'employee_loan' | 'shift_swap_request';
  targetEntityId: number | null;
  proposedPayload: Record<string, unknown>;
  justification: string | null;
  proposerUserId: number;
}

export interface PendingApprovalListResponse {
  items: PendingApprovalItem[];
  total: number;
}

type DecisionReassignmentAction = 'kept' | 'delegated_to_person' | 'opened_to_structure';

export interface DecisionChain {
  pendingApprovalId: number;
  status: PendingApprovalStatus;
  assignedToOrgUnit: { id: number; name: string; headUserId: number | null; headName: string | null } | null;
  reassignments: Array<{
    id: number;
    action: DecisionReassignmentAction;
    actorUserId: number;
    targetUserId: number | null;
    createdAt: string;
    actorName: string;
    targetName: string | null;
  }>;
  currentAssigneeUserId: number | null;
  openToStructure: boolean;
  decidedByUserId: number | null;
  decidedByName: string | null;
}

export type PendingApprovalFilters = NonNullable<
  paths['/pending-approvals']['get']['parameters']['query']
>;

type NoteBody = NonNullable<
  paths['/pending-approvals/{id}/approve']['post']['requestBody']
>['content']['application/json'];
type DelegateBody = NonNullable<
  paths['/pending-approvals/{id}/delegate']['post']['requestBody']
>['content']['application/json'];

export const listPendingApprovals = (
  status: PendingApprovalFilters['status'] = 'pending'
): Promise<ApiResponse<PendingApprovalListResponse>> =>
  apiClient.get<PendingApprovalListResponse, '/pending-approvals'>('/pending-approvals', {
    query: { status },
  });

export const approvePendingItem = (
  id: number,
  note?: string
): Promise<ApiResponse<PendingApprovalItem>> =>
  apiClient.post<PendingApprovalItem, '/pending-approvals/{id}/approve'>(
    '/pending-approvals/{id}/approve',
    { note: note ?? null } satisfies NoteBody,
    { params: { id } }
  );

export const rejectPendingItem = (
  id: number,
  note?: string
): Promise<ApiResponse<PendingApprovalItem>> =>
  apiClient.post<PendingApprovalItem, '/pending-approvals/{id}/reject'>(
    '/pending-approvals/{id}/reject',
    { note: note ?? null },
    { params: { id } }
  );

// -------- Structure delegation (entity-agnostic) --------
// Three ways to answer "this decision is not mine to make alone": keep it,
// hand it to a named person, or open it to everyone in the structure. Each is
// recorded as a reassignment so the chain stays reconstructable.

export const keepPendingItem = (id: number): Promise<ApiResponse<PendingApprovalItem>> =>
  apiClient.post<PendingApprovalItem, '/pending-approvals/{id}/keep'>(
    '/pending-approvals/{id}/keep',
    undefined,
    { params: { id } }
  );

export const delegatePendingItem = (
  id: number,
  targetUserId: number
): Promise<ApiResponse<PendingApprovalItem>> =>
  apiClient.post<PendingApprovalItem, '/pending-approvals/{id}/delegate'>(
    '/pending-approvals/{id}/delegate',
    { targetUserId } satisfies DelegateBody,
    { params: { id } }
  );

export const openPendingItemToStructure = (
  id: number
): Promise<ApiResponse<PendingApprovalItem>> =>
  apiClient.post<PendingApprovalItem, '/pending-approvals/{id}/open-to-structure'>(
    '/pending-approvals/{id}/open-to-structure',
    undefined,
    { params: { id } }
  );

export const getDecisionChain = (id: number): Promise<ApiResponse<DecisionChain>> =>
  apiClient.get<DecisionChain, '/pending-approvals/{id}/chain'>('/pending-approvals/{id}/chain', {
    params: { id },
  });
