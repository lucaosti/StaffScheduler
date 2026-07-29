/**
 * Shift template server-state hooks (TanStack Query).
 *
 * Retiring a template is a soft delete, so the list changes shape rather than
 * losing a row — which is why every mutation invalidates the whole key instead
 * of removing one entry from the cache.
 *
 * @author Luca Ostinelli
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createShiftTemplate,
  deleteShiftTemplate,
  getShiftTemplates,
  ShiftTemplate,
  updateShiftTemplate,
} from '../services/shiftService';

const templateKeys = {
  all: ['shift-templates'] as const,
};

export function useShiftTemplatesQuery(enabled = true) {
  return useQuery({
    queryKey: templateKeys.all,
    queryFn: async (): Promise<ShiftTemplate[]> => (await getShiftTemplates()).data ?? [],
    enabled,
  });
}

export function useShiftTemplateMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: templateKeys.all });

  return {
    create: useMutation({
      mutationFn: (body: Record<string, unknown>) => createShiftTemplate(body as never),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, ...body }: { id: number } & Record<string, unknown>) =>
        updateShiftTemplate(id, body as never),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteShiftTemplate(id),
      onSuccess: invalidate,
    }),
  };
}
