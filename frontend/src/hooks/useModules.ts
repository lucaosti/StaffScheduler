/**
 * Runtime feature-module server-state hooks (TanStack Query).
 *
 * The global module list is a cached query; the per-organisation override
 * view is looked up on demand (an admin types an org name and clicks Load)
 * rather than a query, the same reasoning `usePendingApprovals.ts` documents
 * for its on-demand chain-of-command panel — it is imperative detail
 * requested for one org at a time, not the mount-load-refetch boilerplate
 * this migration targets.
 *
 * @author Luca Ostinelli
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listModules,
  removeModuleOrgOverride,
  setModuleEnabled,
  setModuleOrgOverride,
} from '../services/moduleService';
import type { Module } from '../types';

// Module-private: nothing outside this file invalidates a modules query
// directly.
const modulesKey = ['modules'] as const;

/** The global module list. */
export function useModulesQuery() {
  return useQuery({
    queryKey: modulesKey,
    queryFn: async (): Promise<Module[]> => {
      const res = await listModules();
      return res.success && res.data ? res.data : [];
    },
  });
}

/**
 * Toggle a module globally, or set/remove a per-organisation override. Each
 * invalidates the global list; the org-scoped view is a plain fetch the
 * page re-runs itself after a successful org-scope mutation, since it isn't
 * a cached query.
 */
export function useModuleMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: modulesKey });

  return {
    setGlobal: useMutation({
      mutationFn: ({ code, isEnabled, justification }: { code: string; isEnabled: boolean; justification?: string }) =>
        setModuleEnabled(code, isEnabled, justification),
      onSuccess: invalidate,
    }),
    setOrgOverride: useMutation({
      mutationFn: ({
        code,
        org,
        isEnabled,
        justification,
      }: {
        code: string;
        org: string;
        isEnabled: boolean;
        justification?: string;
      }) => setModuleOrgOverride(code, org, isEnabled, justification),
    }),
    removeOrgOverride: useMutation({
      mutationFn: ({ code, org }: { code: string; org: string }) => removeModuleOrgOverride(code, org),
    }),
  };
}
