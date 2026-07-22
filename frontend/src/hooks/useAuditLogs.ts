/**
 * Audit-logs query hook (TanStack Query).
 *
 * The page is read-only and paginated/filtered server-side. Keying the query by
 * the applied filters + page means each filter/page combination is cached and a
 * repeated view is served instantly; changing filters or page refetches without
 * the page managing a loading flag or a load effect.
 *
 * @author Luca Ostinelli
 */

import { useQuery } from '@tanstack/react-query';
import { listAuditLogs, type AuditLogFilters } from '../services/auditLogService';
import type { AuditLogEntry } from '../types';

interface AuditLogsPage {
  entries: AuditLogEntry[];
  total: number;
}

/** A page of audit-log entries for the given API filters. */
export function useAuditLogsQuery(apiFilters: AuditLogFilters) {
  return useQuery({
    queryKey: ['audit-logs', apiFilters],
    queryFn: async (): Promise<AuditLogsPage> => {
      const res = await listAuditLogs(apiFilters);
      return { entries: res.data ?? [], total: res.meta?.total ?? 0 };
    },
  });
}
