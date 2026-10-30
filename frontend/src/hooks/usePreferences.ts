/**
 * Current-user preferences hook (TanStack Query).
 *
 * The Settings → Work tab shows the caller's working-time limits read-only
 * from this query. There is deliberately no self-service save hook: the
 * limits are set by a manager (`preferences.manage`), and the fields the tab
 * once "saved" had nowhere to be stored (#843). Failure is tolerated: the
 * query yields null and the tab says no limits are on record.
 *
 * @author Luca Ostinelli
 */

import { useQuery } from '@tanstack/react-query';
import {
  getMyPreferences,
  type UserPreferences,
} from '../services/preferencesService';

// Module-private: nothing outside this file invalidates a preferences
// query directly.
const myPreferencesKey = ['my-preferences'] as const;

/** The current user's saved preferences (null when none/failed). */
export function useMyPreferencesQuery() {
  return useQuery({
    queryKey: myPreferencesKey,
    queryFn: async (): Promise<UserPreferences | null> => {
      const res = await getMyPreferences();
      return res?.success && res?.data ? (res.data as UserPreferences) : null;
    },
  });
}
