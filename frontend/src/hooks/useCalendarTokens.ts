/**
 * Personal calendar-feed token server-state hooks (TanStack Query).
 *
 * Several named tokens, each revocable on its own — see calendarService's
 * own header for why. Every mutation invalidates the list so it stays the
 * one place a caller checks "did I already revoke the lost phone?".
 *
 * @author Luca Ostinelli
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createCalendarToken,
  listCalendarTokens,
  revokeCalendarToken,
  type CalendarToken,
  type CreatedCalendarToken,
} from '../services/calendarService';

export const calendarTokensKey = ['calendar-tokens'] as const;

/** The caller's own calendar-feed tokens. */
export function useCalendarTokensQuery() {
  return useQuery({
    queryKey: calendarTokensKey,
    queryFn: (): Promise<CalendarToken[]> => listCalendarTokens(),
  });
}

/** Create / revoke a calendar token. Each invalidates the token list. */
export function useCalendarTokenMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: calendarTokensKey });

  return {
    create: useMutation<CreatedCalendarToken, Error, string>({
      mutationFn: (label: string) => createCalendarToken(label),
      onSuccess: invalidate,
    }),
    revoke: useMutation({
      mutationFn: (id: number) => revokeCalendarToken(id),
      onSuccess: invalidate,
    }),
  };
}
