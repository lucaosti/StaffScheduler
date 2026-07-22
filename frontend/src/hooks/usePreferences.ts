/**
 * Current-user preferences hook (TanStack Query).
 *
 * The Settings page hydrates an editable local form from the saved preferences.
 * Fetching them through a cached query (instead of a bespoke mount effect) means
 * the request is deduped and shared, while the page keeps its own editable copy
 * and hydrates it when the query resolves. Failure is tolerated: the caller
 * falls back to defaults, so the query simply yields null on error paths handled
 * by the page.
 *
 * @author Luca Ostinelli
 */

import { useQuery } from '@tanstack/react-query';
import { getMyPreferences, type UserPreferences } from '../services/preferencesService';

/** The current user's saved preferences (null when none/failed). */
export function useMyPreferencesQuery() {
  return useQuery({
    queryKey: ['my-preferences'],
    queryFn: async (): Promise<UserPreferences | null> => {
      const res = await getMyPreferences();
      return res?.success && res?.data ? (res.data as UserPreferences) : null;
    },
  });
}
