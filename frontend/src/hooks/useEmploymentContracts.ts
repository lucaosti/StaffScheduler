/**
 * Employment contract server-state hooks (TanStack Query).
 *
 * A person's contract history is keyed per user and gated with `enabled`: it
 * is only meaningful once someone has been chosen, and it is the answer to
 * "which limits applied when", not a list anyone browses.
 *
 * Assigning invalidates everything, not just that person's history: the
 * catalogue rows carry no per-person state, but the same manager is usually
 * assigning several people in a row and a stale history is the one thing that
 * makes the overlap refusal look wrong.
 *
 * @author Luca Ostinelli
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  assignContract,
  ContractAssignment,
  createContract,
  EmploymentContract,
  getContracts,
  getUserContracts,
  updateContract,
} from '../services/employmentContractService';

const contractKeys = {
  all: ['employment-contracts'] as const,
  catalogue: ['employment-contracts', 'catalogue'] as const,
  forUser: (userId: number) => ['employment-contracts', 'user', userId] as const,
};

export function useContractsQuery() {
  return useQuery({
    queryKey: contractKeys.catalogue,
    queryFn: async (): Promise<EmploymentContract[]> => (await getContracts()).data ?? [],
  });
}

export function useUserContractsQuery(userId: number | null) {
  return useQuery({
    queryKey: contractKeys.forUser(userId ?? 0),
    queryFn: async (): Promise<ContractAssignment[]> =>
      (await getUserContracts(userId as number)).data ?? [],
    enabled: userId !== null,
  });
}

export function useContractMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: contractKeys.all });

  return {
    create: useMutation({
      mutationFn: (body: Record<string, unknown>) => createContract(body as never),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, ...body }: { id: number } & Record<string, unknown>) =>
        updateContract(id, body as never),
      onSuccess: invalidate,
    }),
    assign: useMutation({
      mutationFn: ({
        userId,
        ...body
      }: { userId: number; contractId: number; effectiveFrom: string; effectiveTo?: string | null }) =>
        assignContract(userId, body as never),
      onSuccess: invalidate,
    }),
  };
}
