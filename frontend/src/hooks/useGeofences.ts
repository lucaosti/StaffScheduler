/**
 * Department geofences as server state (TanStack Query).
 *
 * Keyed by department, not global: the admin screen only ever looks at one
 * department's fences at a time, and scoping the query key that way means
 * switching departments doesn't discard and refetch data for the one just
 * left.
 *
 * @author Luca Ostinelli
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Geofence } from '../types';
import {
  getGeofences,
  createGeofence,
  updateGeofence,
  deleteGeofence,
  type CreateGeofenceData,
  type UpdateGeofenceData,
} from '../services/departmentService';

const geofenceKeys = {
  forDepartment: (departmentId: number | string | null) => ['geofences', departmentId] as const,
};

export function useGeofencesQuery(departmentId: number | string | null) {
  return useQuery({
    queryKey: geofenceKeys.forDepartment(departmentId),
    queryFn: async (): Promise<Geofence[]> => (await getGeofences(departmentId as number | string)).data ?? [],
    enabled: departmentId !== null,
  });
}

export function useGeofenceMutations(departmentId: number | string | null) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: geofenceKeys.forDepartment(departmentId) });

  return {
    create: useMutation({
      mutationFn: (data: CreateGeofenceData) => createGeofence(departmentId as number | string, data),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, data }: { id: number | string; data: UpdateGeofenceData }) =>
        updateGeofence(departmentId as number | string, id, data),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number | string) => deleteGeofence(departmentId as number | string, id),
      onSuccess: invalidate,
    }),
  };
}
