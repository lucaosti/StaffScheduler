/**
 * Skills catalogue server-state hooks (TanStack Query).
 *
 * Every mutation invalidates the whole catalogue key rather than patching the
 * cached row: creating or retiring a skill changes what the *other* rows mean
 * to a reader (which are still offered, which are usable), and a surgical
 * update would leave the list telling a half-true story.
 *
 * @author Luca Ostinelli
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createSkill,
  deleteSkill,
  getSkills,
  updateSkill,
  Skill,
  SkillFilters,
} from '../services/skillService';

const skillKeys = {
  all: ['skills'] as const,
  list: (filters: SkillFilters) => ['skills', filters] as const,
};

export function useSkillsQuery(filters: SkillFilters = {}) {
  return useQuery({
    queryKey: skillKeys.list(filters),
    queryFn: async (): Promise<Skill[]> => (await getSkills(filters)).data ?? [],
  });
}

export function useSkillMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: skillKeys.all });

  return {
    create: useMutation({
      mutationFn: (body: { name: string; description?: string | null }) => createSkill(body),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({
        id,
        ...body
      }: { id: number; name?: string; description?: string | null; isActive?: boolean }) =>
        updateSkill(id, body),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteSkill(id),
      onSuccess: invalidate,
    }),
  };
}
