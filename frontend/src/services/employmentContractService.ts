/**
 * Employment contract service — wraps `/api/employment-contracts`.
 *
 * These carry the working-time limits the optimizer enforces as HARD
 * constraints, and they are legally bounded in most jurisdictions. Reads take
 * `employee.read`, writes `preferences.manage` — the same permission that
 * guards setting someone's limits directly, deliberately, because moving a
 * person onto a different contract IS setting their limits.
 *
 * The types are declared here rather than in the shared package: neither is in
 * `domain.ts` yet, so there is nothing to derive from.
 *
 * @author Luca Ostinelli
 */

import { ApiResponse } from '../types';
import type { paths } from '../api/schema';
import { apiClient } from '../api/client';

/** `null` on a limit means "this contract does not constrain it". */
export interface EmploymentContract {
  id: number;
  name: string;
  description: string | null;
  isActive: boolean;
  maxHoursPerWeek: number | null;
  minHoursPerWeek: number | null;
  maxHoursPerDay: number | null;
  maxConsecutiveDays: number | null;
  minHoursBetweenShifts: number | null;
  minConsecutiveDaysOff: number | null;
}

export interface ContractAssignment {
  id: number;
  userId: number;
  contractId: number;
  contractName: string;
  effectiveFrom: string;
  /** `null` means open-ended: in force until something replaces it. */
  effectiveTo: string | null;
}

type CreateBody = NonNullable<
  paths['/employment-contracts']['post']['requestBody']
>['content']['application/json'];
type UpdateBody = NonNullable<
  paths['/employment-contracts/{id}']['put']['requestBody']
>['content']['application/json'];
type AssignBody = NonNullable<
  paths['/employment-contracts/users/{userId}']['post']['requestBody']
>['content']['application/json'];

export const getContracts = (): Promise<ApiResponse<EmploymentContract[]>> =>
  apiClient.get<EmploymentContract[], '/employment-contracts'>('/employment-contracts');

export const createContract = (body: CreateBody): Promise<ApiResponse<EmploymentContract>> =>
  apiClient.post<EmploymentContract, '/employment-contracts'>('/employment-contracts', body);

export const updateContract = (
  id: number,
  body: UpdateBody
): Promise<ApiResponse<EmploymentContract>> =>
  apiClient.put<EmploymentContract, '/employment-contracts/{id}'>(
    '/employment-contracts/{id}',
    body,
    { params: { id } }
  );

export const getUserContracts = (
  userId: number
): Promise<ApiResponse<ContractAssignment[]>> =>
  apiClient.get<ContractAssignment[], '/employment-contracts/users/{userId}'>(
    '/employment-contracts/users/{userId}',
    { params: { userId } }
  );

export const assignContract = (
  userId: number,
  body: AssignBody
): Promise<ApiResponse<ContractAssignment>> =>
  apiClient.post<ContractAssignment, '/employment-contracts/users/{userId}'>(
    '/employment-contracts/users/{userId}',
    body,
    { params: { userId } }
  );
