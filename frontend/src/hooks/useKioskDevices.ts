/**
 * Department kiosk devices as server state (TanStack Query).
 *
 * Keyed by department, same rationale as `useGeofences.ts`: the admin screen
 * only ever looks at one department's devices at a time.
 *
 * @author Luca Ostinelli
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { KioskDevice } from '../types';
import {
  getKioskDevices,
  createKioskDevice,
  deleteKioskDevice,
  type CreateKioskDeviceData,
  type CreatedKioskDevice,
} from '../services/departmentService';

const kioskKeys = {
  forDepartment: (departmentId: number | string | null) => ['kioskDevices', departmentId] as const,
};

export function useKioskDevicesQuery(departmentId: number | string | null) {
  return useQuery({
    queryKey: kioskKeys.forDepartment(departmentId),
    queryFn: async (): Promise<KioskDevice[]> => (await getKioskDevices(departmentId as number | string)).data ?? [],
    enabled: departmentId !== null,
  });
}

export function useKioskDeviceMutations(departmentId: number | string | null) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: kioskKeys.forDepartment(departmentId) });

  return {
    create: useMutation({
      mutationFn: (data: CreateKioskDeviceData): Promise<CreatedKioskDevice | undefined> =>
        createKioskDevice(departmentId as number | string, data).then((res) => res.data),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number | string) => deleteKioskDevice(departmentId as number | string, id),
      onSuccess: invalidate,
    }),
  };
}
