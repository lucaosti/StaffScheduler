/**
 * Enabled two-factor methods for the current user (TanStack Query).
 *
 * Only the list is a query. Enrollment and disable are multi-step ceremonies
 * (a server-issued challenge chained through a browser WebAuthn API call,
 * then a second server round trip) rather than a single request a
 * `useMutation` models cleanly, and nothing else in the app reads this list,
 * so there is no shared-cache benefit to wrapping each step — the page
 * calls the service functions directly and invalidates this query on
 * success, the same reasoning `usePendingApprovals.ts` documents for its
 * on-demand chain-of-command panel.
 *
 * @author Luca Ostinelli
 */

import { useQuery } from '@tanstack/react-query';
import { listTwoFactorMethods, type TwoFactorMethodType } from '../services/twoFactorService';

export const twoFactorMethodsKey = ['two-factor-methods'] as const;

/** The current user's enabled 2FA methods. */
export function useTwoFactorMethodsQuery() {
  return useQuery({
    queryKey: twoFactorMethodsKey,
    queryFn: async (): Promise<TwoFactorMethodType[]> => {
      const res = await listTwoFactorMethods();
      return res.data?.methods ?? [];
    },
  });
}
