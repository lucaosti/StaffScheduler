/**
 * Translation overrides as server state — the admin CRUD side.
 *
 * The caller's-own-organization read (`getMyOverrides`) is not here: it is
 * consumed directly by `AuthContext` on login and on locale change, outside
 * TanStack Query's cache, since it needs to run before most of the rest of
 * the app's data-fetching is relevant.
 *
 * @author Luca Ostinelli
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createTranslationOverride,
  deleteTranslationOverride,
  listTranslationOverrides,
  updateTranslationOverride,
  type TranslationOverride,
} from '../services/translationOverrideService';

const translationOverrideKeys = {
  list: () => ['translation-overrides'] as const,
};

export function useTranslationOverridesQuery() {
  return useQuery({
    queryKey: translationOverrideKeys.list(),
    queryFn: async (): Promise<TranslationOverride[]> => {
      const res = await listTranslationOverrides();
      return res.data ?? [];
    },
  });
}

export function useCreateTranslationOverride() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createTranslationOverride,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: translationOverrideKeys.list() });
    },
  });
}

export function useUpdateTranslationOverride() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, overrides }: { id: number; overrides: Record<string, string> }) =>
      updateTranslationOverride(id, { overrides }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: translationOverrideKeys.list() });
    },
  });
}

export function useDeleteTranslationOverride() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteTranslationOverride(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: translationOverrideKeys.list() });
    },
  });
}
