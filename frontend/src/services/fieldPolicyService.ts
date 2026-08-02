/**
 * Per-organization employee field policies.
 *
 * `governableCoreFields` travels in the read response and is used as the list of
 * fields the UI offers — deliberately not a constant here. The allowlist is a
 * security boundary: it is what stops a policy naming `password_hash`, and a
 * second copy in the frontend would drift from the one that enforces, showing an
 * administrator a field the server will refuse (or, worse, going stale in the
 * other direction and hiding one that works).
 *
 * @author Luca Ostinelli
 */

import type { ApiResponse } from '../types';
import { apiClient } from '../api/client';

export interface FieldPolicy {
  fieldKey: string;
  isRequired: boolean;
  visiblePermission: string | null;
  editPermission: string | null;
  minLength: number | null;
  maxLength: number | null;
  minValue: number | null;
  maxValue: number | null;
  pattern: string | null;
  allowedValues: string[] | null;
  helpText: string | null;
}

export interface FieldPolicySet {
  policies: FieldPolicy[];
  governableCoreFields: string[];
}

/** What a save sends. `organizationName` null is the global fallback row. */
export interface FieldPolicyInput extends FieldPolicy {
  organizationName: string | null;
}

export const listFieldPolicies = (organizationName?: string): Promise<ApiResponse<FieldPolicySet>> =>
  apiClient.get<FieldPolicySet, '/employee-field-policies'>('/employee-field-policies', {
    ...(organizationName ? { query: { organizationName } } : {}),
  });

export const saveFieldPolicy = (input: FieldPolicyInput): Promise<ApiResponse<void>> =>
  apiClient.put<void, '/employee-field-policies'>('/employee-field-policies', input);

export const deleteFieldPolicy = (
  fieldKey: string,
  organizationName: string | null
): Promise<ApiResponse<void>> =>
  apiClient.delete<void, '/employee-field-policies'>('/employee-field-policies', {
    query: { fieldKey, ...(organizationName ? { organizationName } : {}) },
  });
