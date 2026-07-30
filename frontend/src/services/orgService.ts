/**
 * Org tree, memberships, and employee loans client.
 *
 * Routed through the generated client so path, method, body and query are all
 * checked against the OpenAPI contract at compile time; filters and request
 * bodies are derived from it rather than retyped. See `departmentService` for
 * the full rationale.
 *
 * WHY THE LOCAL `OrgUnit` IS GONE: it duplicated `orgUnitSchema` in
 * `@staff-scheduler/shared` field for field. That is the same second-copy
 * pattern that let `Department` here declare five of ten fields — harmless
 * only until the two drift, at which point the type says a field is absent
 * while the response carries it. The shared entity is re-exported by the type
 * barrel, so importers keep the same name.
 *
 * The remaining response types (`UserOrgUnit`, `OrgUnitMemberDetail`,
 * `ManagerChainLink`, `EmployeeLoan`) have no shared declaration yet and stay
 * hand-written. `EmployeeLoan` is worth flagging: #329 is reviewing whether a
 * loan is better modelled as a temporal multi-affiliation, so this shape is
 * expected to change rather than being settled.
 *
 * @author Luca Ostinelli
 */

import type { ApiResponse, OrgUnit } from '../types';
import type { paths } from '../api/schema';
import { apiClient } from '../api/client';

export type { OrgUnit };

export interface OrgUnitNode extends OrgUnit {
  children: OrgUnitNode[];
}

export interface UserOrgUnit {
  id: number;
  userId: number;
  orgUnitId: number;
  isPrimary: boolean;
  assignedAt: string;
}

export interface OrgUnitMemberDetail {
  userId: number;
  firstName: string;
  lastName: string;
  email: string;
  position: string | null;
  isPrimary: boolean;
}

interface ManagerRef {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
}

export interface ManagerChainLink {
  unitId: number;
  unitName: string;
  manager: ManagerRef | null;
}

export type CreateUnitInput =
  paths['/org/units']['post']['requestBody']['content']['application/json'];
export type UpdateUnitInput = NonNullable<
  paths['/org/units/{id}']['put']['requestBody']
>['content']['application/json'];
export type AddMemberInput = NonNullable<
  paths['/org/units/{id}/members']['post']['requestBody']
>['content']['application/json'];
export type LoanFilters = NonNullable<paths['/org/loans']['get']['parameters']['query']>;
export type CreateLoanInput =
  paths['/org/loans']['post']['requestBody']['content']['application/json'];

type LoanNotesBody = NonNullable<
  paths['/org/loans/{id}/approve']['post']['requestBody']
>['content']['application/json'];

type LoanStatus = NonNullable<LoanFilters['status']>;

export interface EmployeeLoan {
  id: number;
  userId: number;
  fromOrgUnitId: number;
  toOrgUnitId: number;
  startDate: string;
  endDate: string;
  reason: string | null;
  status: LoanStatus;
  requestedBy: number;
  approverUserId: number | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

// -------- Org units --------

export const listUnits = (): Promise<ApiResponse<OrgUnit[]>> =>
  apiClient.get<OrgUnit[], '/org/units'>('/org/units');

export const getTree = (): Promise<ApiResponse<OrgUnitNode[]>> =>
  apiClient.get<OrgUnitNode[], '/org/units/tree'>('/org/units/tree');

export const getUnit = (id: number): Promise<ApiResponse<OrgUnit>> =>
  apiClient.get<OrgUnit, '/org/units/{id}'>('/org/units/{id}', { params: { id } });

export const createUnit = (input: CreateUnitInput): Promise<ApiResponse<OrgUnit>> =>
  apiClient.post<OrgUnit, '/org/units'>('/org/units', input);

export const updateUnit = (id: number, patch: UpdateUnitInput): Promise<ApiResponse<OrgUnit>> =>
  apiClient.put<OrgUnit, '/org/units/{id}'>('/org/units/{id}', patch, { params: { id } });

export const deleteUnit = (id: number): Promise<ApiResponse<void>> =>
  apiClient.delete<void, '/org/units/{id}'>('/org/units/{id}', { params: { id } });

// -------- Memberships --------

export const listMembers = (orgUnitId: number): Promise<ApiResponse<UserOrgUnit[]>> =>
  apiClient.get<UserOrgUnit[], '/org/units/{id}/members'>('/org/units/{id}/members', {
    params: { id: orgUnitId },
  });

export const listMembersDetailed = (
  orgUnitId: number
): Promise<ApiResponse<OrgUnitMemberDetail[]>> =>
  apiClient.get<OrgUnitMemberDetail[], '/org/units/{id}/members/detailed'>(
    '/org/units/{id}/members/detailed',
    { params: { id: orgUnitId } }
  );

/**
 * The caller's own chain, or another user's.
 *
 * These are two distinct operations in the contract, not one path with an
 * optional segment — `/org/manager-chain` answers for the authenticated user
 * and `/org/manager-chain/{userId}` for someone else, which is also the
 * authorization boundary between them. The old template-literal concatenation
 * hid that distinction; branching makes it explicit and lets each call be
 * checked against its own operation.
 */
export const getManagerChain = (userId?: number): Promise<ApiResponse<ManagerChainLink[]>> =>
  userId === undefined
    ? apiClient.get<ManagerChainLink[], '/org/manager-chain'>('/org/manager-chain')
    : apiClient.get<ManagerChainLink[], '/org/manager-chain/{userId}'>(
        '/org/manager-chain/{userId}',
        { params: { userId } }
      );

/**
 * Who has authority over one person.
 *
 * Two operations for the same reason `getManagerChain` has two: the no-argument
 * form answers for the caller and needs no permission, while the one naming a
 * user requires `org_unit.read`. That is the authorization boundary, and a
 * single concatenated path would hide it.
 *
 * The response is typed here rather than derived from the schema: the endpoint
 * publishes a composed view, not a domain entity, so there is no shared Zod
 * schema behind it to generate from — `object` is all the spec can honestly say.
 */
export interface AuthorityPerson {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
}

interface AuthorityApprovalStep {
  stepOrder: number;
  approverScope: string;
  permissionCode: string | null;
  approvers: AuthorityPerson[];
  /** The scope resolved to nobody — requests of this kind have no decider. */
  unresolved: boolean;
}

interface AuthorityWorkflow {
  changeType: string;
  description: string | null;
  steps: AuthorityApprovalStep[];
}

export interface AuthorityProfile {
  subject: AuthorityPerson;
  managerChain: ManagerChainLink[];
  roleAdministrators: Array<AuthorityPerson & { via: 'responsibility_rule' | 'permission' }>;
  approvals: AuthorityWorkflow[];
}

export const getAuthorityProfile = (userId?: number): Promise<ApiResponse<AuthorityProfile>> =>
  userId === undefined
    ? apiClient.get<AuthorityProfile, '/org/authority'>('/org/authority')
    : apiClient.get<AuthorityProfile, '/org/authority/{userId}'>('/org/authority/{userId}', {
        params: { userId },
      });

export const addMember = (
  orgUnitId: number,
  userId: number,
  isPrimary = false
): Promise<ApiResponse<UserOrgUnit>> =>
  apiClient.post<UserOrgUnit, '/org/units/{id}/members'>(
    '/org/units/{id}/members',
    { userId, isPrimary } satisfies AddMemberInput,
    { params: { id: orgUnitId } }
  );

export const setPrimaryMember = (orgUnitId: number, userId: number): Promise<ApiResponse<void>> =>
  apiClient.patch<void, '/org/units/{id}/members/{userId}/primary'>(
    '/org/units/{id}/members/{userId}/primary',
    undefined,
    { params: { id: orgUnitId, userId } }
  );

export const removeMember = (orgUnitId: number, userId: number): Promise<ApiResponse<void>> =>
  apiClient.delete<void, '/org/units/{id}/members/{userId}'>('/org/units/{id}/members/{userId}', {
    params: { id: orgUnitId, userId },
  });

// -------- Loans --------

export const listLoans = (filters: LoanFilters = {}): Promise<ApiResponse<EmployeeLoan[]>> =>
  apiClient.get<EmployeeLoan[], '/org/loans'>('/org/loans', { query: filters });

export const createLoan = (input: CreateLoanInput): Promise<ApiResponse<EmployeeLoan>> =>
  apiClient.post<EmployeeLoan, '/org/loans'>('/org/loans', input);

export const approveLoan = (id: number, notes?: string): Promise<ApiResponse<EmployeeLoan>> =>
  apiClient.post<EmployeeLoan, '/org/loans/{id}/approve'>(
    '/org/loans/{id}/approve',
    { notes: notes ?? null } satisfies LoanNotesBody,
    { params: { id } }
  );

export const rejectLoan = (id: number, notes?: string): Promise<ApiResponse<EmployeeLoan>> =>
  apiClient.post<EmployeeLoan, '/org/loans/{id}/reject'>(
    '/org/loans/{id}/reject',
    { notes: notes ?? null },
    { params: { id } }
  );

export const cancelLoan = (id: number): Promise<ApiResponse<EmployeeLoan>> =>
  apiClient.post<EmployeeLoan, '/org/loans/{id}/cancel'>('/org/loans/{id}/cancel', undefined, {
    params: { id },
  });
