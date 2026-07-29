/**
 * User account server-state hooks (TanStack Query).
 *
 * Deactivation is a soft delete, so the list changes shape rather than losing
 * a row — which is why every mutation invalidates the key instead of removing
 * an entry from the cache.
 *
 * @author Luca Ostinelli
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createUserAccount,
  deactivateUserAccount,
  getUserAccounts,
  UserAccount,
  UserFilters,
  updateUserAccount,
} from '../services/userAccountService';

const accountKeys = {
  all: ['user-accounts'] as const,
  list: (filters: UserFilters) => ['user-accounts', filters] as const,
};

export function useUserAccountsQuery(filters: UserFilters = {}, enabled = true) {
  return useQuery({
    queryKey: accountKeys.list(filters),
    queryFn: async (): Promise<UserAccount[]> => (await getUserAccounts(filters)).data ?? [],
    enabled,
  });
}

export function useUserAccountMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: accountKeys.all });

  return {
    create: useMutation({
      mutationFn: (body: Record<string, unknown>) => createUserAccount(body as never),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, ...body }: { id: number } & Record<string, unknown>) =>
        updateUserAccount(id, body as never),
      onSuccess: invalidate,
    }),
    deactivate: useMutation({
      mutationFn: (id: number) => deactivateUserAccount(id),
      onSuccess: invalidate,
    }),
  };
}
