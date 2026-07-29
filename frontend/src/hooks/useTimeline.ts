/**
 * Timeline server-state hooks (TanStack Query).
 *
 * The range is part of the key, so moving the window is a cache lookup rather
 * than a refetch of something already held, and stepping back to last week is
 * instant.
 *
 * The source list is a separate query because it changes far less often than
 * the data: it belongs to the deployment, not to the week being looked at, and
 * folding it into the timeline response would re-send it with every step.
 *
 * @author Luca Ostinelli
 */

import { useQuery } from '@tanstack/react-query';
import { getTimeline, getTimelineSources, Timeline } from '../services/timelineService';

const timelineKeys = {
  all: ['timeline'] as const,
  range: (from: string, to: string, sources?: string) =>
    ['timeline', from, to, sources ?? 'all'] as const,
  sources: ['timeline', 'sources'] as const,
};

export function useTimelineQuery(from: string, to: string, sources?: string) {
  return useQuery({
    queryKey: timelineKeys.range(from, to, sources),
    queryFn: async (): Promise<Timeline> => {
      const res = await getTimeline({ from, to, ...(sources ? { sources } : {}) });
      return (
        res.data ?? { from, to, lanes: [], bars: [], sources: [] }
      );
    },
    enabled: Boolean(from && to),
  });
}

export function useTimelineSourcesQuery() {
  return useQuery({
    queryKey: timelineKeys.sources,
    queryFn: async (): Promise<string[]> => (await getTimelineSources()).data ?? [],
    // The set of sources is a property of the deployment; re-asking on every
    // window change would be a request that can never have a different answer
    // within a session.
    staleTime: 60 * 60 * 1000,
  });
}
