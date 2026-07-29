/**
 * Timeline service — wraps `/api/timeline`.
 *
 * Routed through the generated client, so the query parameters are checked
 * against the OpenAPI contract at compile time rather than assembled by hand.
 *
 * The response types are declared here because the timeline is not a domain
 * entity in `packages/shared/src/domain.ts`: it is a projection assembled per
 * request from whichever sources were asked for, and it has no table. Adding
 * it there would suggest it were a thing the system stores.
 *
 * @author Luca Ostinelli
 */

import { ApiResponse } from '../types';
import type { paths } from '../api/schema';
import { apiClient } from '../api/client';

export type TimelineParams = NonNullable<paths['/timeline']['get']['parameters']['query']>;

interface TimelineLane {
  id: string;
  label: string;
  kind: 'employee';
}

export interface TimelineBar {
  laneId: string;
  /** Absolute instants: an overnight bar is one interval, not two fragments. */
  start: string;
  end: string;
  label: string;
  source: string;
  status: string;
}

export interface Timeline {
  from: string;
  to: string;
  lanes: TimelineLane[];
  bars: TimelineBar[];
  sources: string[];
}

export const getTimeline = (params: TimelineParams): Promise<ApiResponse<Timeline>> =>
  apiClient.get<Timeline, '/timeline'>('/timeline', { query: params });

export const getTimelineSources = (): Promise<ApiResponse<string[]>> =>
  apiClient.get<string[], '/timeline/sources'>('/timeline/sources');
