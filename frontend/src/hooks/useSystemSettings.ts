/**
 * System-wide settings hooks (TanStack Query).
 *
 * Currency and default time period are the two fields the System tab
 * exposes; both save together as one action, matching how the form always
 * submitted them (`Promise.all`), so a caller sees one pending/error state
 * for the whole save rather than two independent ones.
 *
 * @author Luca Ostinelli
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getSystemSettings,
  updateCurrency,
  updateTimePeriod,
  type Currency,
  type SystemSetting,
  type TimePeriod,
} from '../services/settingsService';

// Module-private: nothing outside this file invalidates a system-settings
// query directly.
const systemSettingsKey = ['system-settings'] as const;

/** All system settings rows, as-stored (a free-text key/value table). */
export function useSystemSettingsQuery() {
  return useQuery({
    queryKey: systemSettingsKey,
    queryFn: async (): Promise<SystemSetting[]> => {
      const res = await getSystemSettings();
      return res.success && res.data ? res.data : [];
    },
  });
}

/** Saves currency and default time period together; invalidates the settings list. */
export function useSaveSystemSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ currency, timePeriod }: { currency: Currency; timePeriod: TimePeriod }) =>
      Promise.all([updateCurrency(currency), updateTimePeriod(timePeriod)]),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: systemSettingsKey }),
  });
}
