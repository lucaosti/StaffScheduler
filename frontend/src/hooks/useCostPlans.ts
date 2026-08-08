/**
 * Cost plans as server state.
 *
 * @author Luca Ostinelli
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createCostPlan,
  deleteCostPlan,
  listCostPlans,
  updateCostPlan,
  type CostPlan,
} from '../services/costPlanService';

const costPlanKeys = {
  list: () => ['cost-plans'] as const,
};

export function useCostPlansQuery() {
  return useQuery({
    queryKey: costPlanKeys.list(),
    queryFn: async (): Promise<CostPlan[]> => {
      const res = await listCostPlans();
      return res.data ?? [];
    },
  });
}

export function useCreateCostPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createCostPlan,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: costPlanKeys.list() });
      // The dashboard's own comparison figure changed too.
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useUpdateCostPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, targetAmount }: { id: number; targetAmount: number }) =>
      updateCostPlan(id, { targetAmount }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: costPlanKeys.list() });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useDeleteCostPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteCostPlan(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: costPlanKeys.list() });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}
