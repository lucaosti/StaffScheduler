/**
 * Organisation server-state hooks (TanStack Query).
 *
 * Shared by the OrgChart (read-only tree view) and OrgManagement pages. The org
 * tree and the current user's manager chain are cached queries; a unit's member
 * list is a query gated on a unit being selected (`enabled`), so clicking a node
 * fetches its members on demand and re-selecting a previously-viewed node is
 * served from cache instead of re-fetching.
 *
 * @author Luca Ostinelli
 */

import { useQuery } from '@tanstack/react-query';
import {
  getTree,
  getManagerChain,
  listMembersDetailed,
  listUnits,
  listMembers,
  listLoans,
  type OrgUnit,
  type OrgUnitNode,
  type ManagerChainLink,
  type OrgUnitMemberDetail,
  type UserOrgUnit,
  type EmployeeLoan,
} from '../services/orgService';

export const orgKeys = {
  tree: ['org', 'tree'] as const,
  managerChain: ['org', 'manager-chain'] as const,
  members: (unitId: number | null) => ['org', 'members', unitId] as const,
  units: ['org', 'units'] as const,
  unitMembers: (unitId: number | null) => ['org', 'unit-members', unitId] as const,
  loans: ['org', 'loans'] as const,
};

/** The full org-unit tree (roots with nested children). */
export function useOrgTreeQuery() {
  return useQuery({
    queryKey: orgKeys.tree,
    queryFn: async (): Promise<OrgUnitNode[]> => {
      const res = await getTree();
      return res.data ?? [];
    },
  });
}

/** The current user's upward manager chain; tolerant of failure (empty on error). */
export function useManagerChainQuery() {
  return useQuery({
    queryKey: orgKeys.managerChain,
    queryFn: async (): Promise<ManagerChainLink[]> => {
      const res = await getManagerChain();
      return res.data ?? [];
    },
  });
}

/** Detailed members of a unit; only fetched once a unit is selected. */
export function useUnitMembersQuery(unitId: number | null) {
  return useQuery({
    queryKey: orgKeys.members(unitId),
    queryFn: async (): Promise<OrgUnitMemberDetail[]> => {
      const res = await listMembersDetailed(unitId as number);
      return res.data ?? [];
    },
    enabled: unitId !== null,
  });
}

interface OrgUnitsData {
  units: OrgUnit[];
  tree: OrgUnitNode[];
}

/** Flat unit list + nested tree, loaded together (both derive from the same edit). */
export function useOrgUnitsQuery() {
  return useQuery({
    queryKey: orgKeys.units,
    queryFn: async (): Promise<OrgUnitsData> => {
      const [list, t] = await Promise.all([listUnits(), getTree()]);
      return { units: list.data ?? [], tree: t.data ?? [] };
    },
  });
}

/** A unit's membership rows (OrgManagement's member tab); gated on a selection. */
export function useOrgUnitMembersQuery(unitId: number | null) {
  return useQuery({
    queryKey: orgKeys.unitMembers(unitId),
    queryFn: async (): Promise<UserOrgUnit[]> => {
      const res = await listMembers(unitId as number);
      return res.data ?? [];
    },
    enabled: unitId !== null,
  });
}

/** All employee loans (the loans inbox). */
export function useOrgLoansQuery() {
  return useQuery({
    queryKey: orgKeys.loans,
    queryFn: async (): Promise<EmployeeLoan[]> => {
      const res = await listLoans();
      return res.data ?? [];
    },
  });
}
