/**
 * Directory server-state hooks (TanStack Query).
 *
 * "My profile" and "someone else's profile" are separate queries with separate
 * keys: the first needs only authentication, the second `user.read`, and a
 * person may well hold the first without the second. One key would make one
 * query's permission decide the other's.
 *
 * @author Luca Ostinelli
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DirectoryProfile,
  getMyProfile,
  getProfile,
  importVcard,
  previewVcardImport,
  removeProfileField,
  saveProfileFields,
} from '../services/directoryService';

const directoryKeys = {
  all: ['directory'] as const,
  me: ['directory', 'me'] as const,
  profile: (id: number) => ['directory', 'profile', id] as const,
};

export function useMyProfileQuery() {
  return useQuery({
    queryKey: directoryKeys.me,
    queryFn: async (): Promise<DirectoryProfile | null> => (await getMyProfile()).data ?? null,
  });
}

export function useProfileQuery(id: number | null, enabled = true) {
  return useQuery({
    queryKey: directoryKeys.profile(id ?? 0),
    queryFn: async (): Promise<DirectoryProfile | null> =>
      (await getProfile(id as number)).data ?? null,
    enabled: id !== null && enabled,
  });
}

export function useDirectoryMutations() {
  const queryClient = useQueryClient();
  // Both keys: an administrator editing their own profile would otherwise see
  // the other view go stale, and which view they are on is not something the
  // mutation knows.
  const invalidate = () => queryClient.invalidateQueries({ queryKey: directoryKeys.all });

  return {
    saveFields: useMutation({
      mutationFn: ({ id, fields }: { id: number; fields: Array<{ key: string; value: unknown }> }) =>
        saveProfileFields(id, fields),
      onSuccess: invalidate,
    }),
    removeField: useMutation({
      mutationFn: ({ id, key }: { id: number; key: string }) => removeProfileField(id, key),
      onSuccess: invalidate,
    }),
    // Not invalidated on success: a preview writes nothing, and the import
    // mutation below invalidates the employee/directory lists it actually
    // changes.
    previewImport: useMutation({
      mutationFn: (vcf: string) => previewVcardImport(vcf),
    }),
    runImport: useMutation({
      mutationFn: ({ vcf, defaultPassword }: { vcf: string; defaultPassword: string }) =>
        importVcard(vcf, defaultPassword),
      onSuccess: invalidate,
    }),
  };
}
