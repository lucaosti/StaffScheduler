/**
 * Approval workflow service — wraps the `/api/approval-workflows` endpoints.
 *
 * Routed through the generated client so path, method and body are checked
 * against the OpenAPI contract at compile time; the request bodies are derived
 * from it rather than retyped. See `departmentService` for the full rationale.
 *
 * WHY THE REQUEST STEP AND THE RESPONSE STEP ARE NOW DIFFERENT TYPES: the
 * hand-written `ApprovalStep` served as both, declaring `id` and `workflowId`
 * as optional. Neither exists in the request schema — the server assigns them —
 * so a caller could construct a step carrying an `id`, have it silently
 * stripped, and reasonably believe it had updated that specific step rather
 * than replaced the list. Deriving the body type makes the request shape
 * exactly what the endpoint accepts; `ApprovalWorkflow`/`ApprovalStep` remain
 * hand-written as the response shapes, since approval workflows are not among
 * the entities declared in `packages/shared/src/domain.ts`.
 *
 * @author Luca Ostinelli
 */

import { ApiResponse } from '../types';
import type { paths } from '../api/schema';
import { apiClient } from '../api/client';

export type CreateWorkflowBody =
  paths['/approval-workflows']['post']['requestBody']['content']['application/json'];
export type UpdateWorkflowBody = NonNullable<
  paths['/approval-workflows/{id}']['put']['requestBody']
>['content']['application/json'];

/** A step as sent to the API — no server-assigned identifiers. */
type ApprovalStepInput = CreateWorkflowBody['steps'][number];

/** The approver scopes the contract accepts, rather than a parallel union. */
export type ApproverScope = ApprovalStepInput['approverScope'];

/** A step as returned by the API: the input plus the identifiers it assigns. */
export interface ApprovalStep extends ApprovalStepInput {
  id?: number;
  workflowId?: number;
}

export interface ApprovalWorkflow {
  id: number;
  changeType: string;
  requireAll: boolean;
  description: string | null;
  steps: ApprovalStep[];
  createdAt: string;
  updatedAt: string;
}

export const listWorkflows = (): Promise<ApiResponse<ApprovalWorkflow[]>> =>
  apiClient.get<ApprovalWorkflow[], '/approval-workflows'>('/approval-workflows');

export const createWorkflow = (
  body: CreateWorkflowBody
): Promise<ApiResponse<ApprovalWorkflow>> =>
  apiClient.post<ApprovalWorkflow, '/approval-workflows'>('/approval-workflows', body);

export const updateWorkflow = (
  id: number,
  body: UpdateWorkflowBody
): Promise<ApiResponse<ApprovalWorkflow>> =>
  apiClient.put<ApprovalWorkflow, '/approval-workflows/{id}'>('/approval-workflows/{id}', body, {
    params: { id },
  });

export const deleteWorkflow = (id: number): Promise<ApiResponse<void>> =>
  apiClient.delete<void, '/approval-workflows/{id}'>('/approval-workflows/{id}', {
    params: { id },
  });
