/**
 * Delegations server-state hooks (TanStack Query).
 *
 * The page lists active delegations and mutates them (create / revoke); each
 * mutation invalidates the list on success.
 *
 * @author Luca Ostinelli
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createDelegation,
  listDelegations,
  listUnitDelegableCodes,
  revokeDelegation,
  type CreateDelegationBody,
  type Delegation,
} from '../services/delegationService';

export const delegationsKey = ['delegations'] as const;

/** All delegations visible to the current user. */
export function useDelegationsQuery() {
  return useQuery({
    queryKey: delegationsKey,
    queryFn: async (): Promise<Delegation[]> => {
      const res = await listDelegations();
      return res.data ?? [];
    },
  });
}

/** The codes the server accepts in a delegation scoped to one org unit. */
export function useUnitDelegableCodesQuery() {
  return useQuery({
    queryKey: [...delegationsKey, 'delegable-for-unit'] as const,
    queryFn: async (): Promise<string[]> => {
      const res = await listUnitDelegableCodes();
      return res.data?.permissionCodes ?? [];
    },
    staleTime: Infinity,
  });
}

/** Create / revoke a delegation. Each invalidates the whole list. */
export function useDelegationMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: delegationsKey });

  return {
    create: useMutation({
      mutationFn: (body: CreateDelegationBody) => createDelegation(body),
      onSuccess: invalidate,
    }),
    revoke: useMutation({
      mutationFn: ({ id, justification }: { id: number; justification: string | null }) =>
        revokeDelegation(id, justification),
      onSuccess: invalidate,
    }),
  };
}
