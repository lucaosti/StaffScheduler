/**
 * Employee field policies as server state.
 *
 * @author Luca Ostinelli
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  deleteFieldPolicy,
  listFieldPolicies,
  saveFieldPolicy,
  type FieldPolicyInput,
  type FieldPolicySet,
} from '../services/fieldPolicyService';

// Module-private: nothing outside this file invalidates a field-policy query
// directly (unlike rbacKeys, which a related page reaches for after a role
// mutation). Exporting it now would be a public surface with no caller.
const fieldPolicyKeys = {
  // Keyed by organization: an administrator switching between their own
  // organization and the global fallback must not read one from the other's
  // cache entry, which is exactly the confusion the two rows already invite.
  list: (organizationName: string | null) => ['field-policies', organizationName] as const,
};

export function useFieldPoliciesQuery(organizationName: string | null) {
  return useQuery({
    queryKey: fieldPolicyKeys.list(organizationName),
    queryFn: async (): Promise<FieldPolicySet> => {
      const res = await listFieldPolicies(organizationName ?? undefined);
      return (res.data as FieldPolicySet) ?? { policies: [], governableCoreFields: [] };
    },
  });
}

export function useSaveFieldPolicy(organizationName: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: FieldPolicyInput) => saveFieldPolicy(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: fieldPolicyKeys.list(organizationName) });
    },
  });
}

export function useDeleteFieldPolicy(organizationName: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (fieldKey: string) => deleteFieldPolicy(fieldKey, organizationName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: fieldPolicyKeys.list(organizationName) });
    },
  });
}
