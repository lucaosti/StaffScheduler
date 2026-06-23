/**
 * Delegation service — wraps /api/delegations endpoints.
 *
 * @author Luca Ostinelli
 */

import { ApiResponse } from '../types';
import { getAuthHeaders, handleResponse, API_BASE_URL } from './apiUtils';

const BASE = `${API_BASE_URL}/delegations`;

export interface Delegation {
  id: number;
  delegatorId: number;
  delegateeId: number;
  permissionCodes: string[];
  scopeOrgUnitId: number | null;
  startsAt: string;
  expiresAt: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDelegationBody {
  delegateeId: number;
  permissionCodes: string[];
  expiresAt: string;
  scopeOrgUnitId?: number | null;
  justification?: string | null;
}

export const listDelegations = async (): Promise<ApiResponse<Delegation[]>> => {
  const res = await fetch(BASE, { method: 'GET', ...getAuthHeaders() });
  return handleResponse<Delegation[]>(res);
};

export const createDelegation = async (
  body: CreateDelegationBody
): Promise<ApiResponse<Delegation>> => {
  const res = await fetch(BASE, {
    method: 'POST',
    ...getAuthHeaders(),
    body: JSON.stringify(body),
  });
  return handleResponse<Delegation>(res);
};

export const revokeDelegation = async (
  id: number,
  justification?: string | null
): Promise<ApiResponse<void>> => {
  const res = await fetch(`${BASE}/${id}`, {
    method: 'DELETE',
    ...getAuthHeaders(),
    body: JSON.stringify({ justification: justification ?? null }),
  });
  return handleResponse<void>(res);
};
