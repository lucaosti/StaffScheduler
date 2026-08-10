/**
 * RBAC-management server-state hooks (TanStack Query).
 *
 * The RBAC admin page reads four independent things: the roles+permissions
 * catalog, the org-unit list (for scoping grants), an employee search, and the
 * roles held by a selected user. Each becomes a query so the page drops its
 * loading flags, debounce effect and manual reloads. The employee search and
 * the user-roles query are gated (`enabled`) on there being a search term / a
 * selected user; role and user-role mutations invalidate the relevant key.
 *
 * @author Luca Ostinelli
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Permission, Role, UserRoleAssignment, Employee } from '../types';
import { listUnits, type OrgUnit } from '../services/orgService';
import {
  assignRole,
  createRole,
  deleteRole,
  getUserRoles,
  getUserRoleTimeline,
  getRoleTimeline,
  listPermissions,
  listRoles,
  removeRole,
  updateRole,
  type AssignRoleBody,
  type CreateRoleBody,
  type RoleTimeline,
  type UpdateRoleBody,
} from '../services/rbacService';
import { getEmployees } from '../services/employeeService';

export const rbacKeys = {
  rolesAndPerms: ['rbac', 'roles-and-permissions'] as const,
  orgUnits: ['rbac', 'org-units'] as const,
  employeeSearch: (q: string) => ['rbac', 'employee-search', q] as const,
  userRoles: (userId: number | null) => ['rbac', 'user-roles', userId] as const,
};

interface RolesAndPermissions {
  roles: Role[];
  permissions: Permission[];
}

/** The roles catalog and the full permission list, loaded together. */
export function useRolesAndPermissionsQuery() {
  return useQuery({
    queryKey: rbacKeys.rolesAndPerms,
    queryFn: async (): Promise<RolesAndPermissions> => {
      const [rolesRes, permsRes] = await Promise.all([listRoles(), listPermissions()]);
      return {
        roles: rolesRes.success && rolesRes.data ? rolesRes.data : [],
        permissions: permsRes.success && permsRes.data ? permsRes.data : [],
      };
    },
  });
}

/** Org units available as grant scopes. */
export function useRbacOrgUnitsQuery() {
  return useQuery({
    queryKey: rbacKeys.orgUnits,
    queryFn: async (): Promise<OrgUnit[]> => {
      const res = await listUnits();
      return res.success && res.data ? res.data : [];
    },
  });
}

/** Employee search; only runs for a non-empty query. */
export function useEmployeeSearchQuery(query: string) {
  const q = query.trim();
  return useQuery({
    queryKey: rbacKeys.employeeSearch(q),
    queryFn: async (): Promise<Employee[]> => {
      const res = await getEmployees({ search: q });
      return res.success && res.data ? res.data : [];
    },
    enabled: q.length > 0,
  });
}

/** Roles held by a selected user; only runs once a user is selected. */
export function useUserRolesQuery(userId: number | null) {
  return useQuery({
    queryKey: rbacKeys.userRoles(userId),
    queryFn: async (): Promise<UserRoleAssignment[]> => {
      const res = await getUserRoles(userId as number);
      return res.success && res.data ? res.data : [];
    },
    enabled: userId !== null,
  });
}

/**
 * The grant/revoke history for a person or a role.
 *
 * `subject` is discriminated rather than two hooks: the two endpoints return the
 * same envelope and the page shows it the same way, so one query key with the
 * kind in it keeps the two histories from evicting each other in the cache.
 */
export function useRoleTimelineQuery(subject: { kind: 'user' | 'role'; id: number } | null) {
  return useQuery({
    queryKey: ['rbac', 'timeline', subject?.kind ?? null, subject?.id ?? null] as const,
    queryFn: async (): Promise<RoleTimeline> => {
      const res =
        subject!.kind === 'user'
          ? await getUserRoleTimeline(subject!.id)
          : await getRoleTimeline(subject!.id);
      return res.data as RoleTimeline;
    },
    enabled: subject !== null,
  });
}

/** Create / update / delete a role. Each invalidates the roles+permissions catalog. */
export function useRoleMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: rbacKeys.rolesAndPerms });

  return {
    create: useMutation({
      mutationFn: (body: CreateRoleBody) => createRole(body),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, ...body }: { id: number } & UpdateRoleBody) => updateRole(id, body),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteRole(id),
      onSuccess: invalidate,
    }),
  };
}

/**
 * Grant / revoke a role for a user. Each invalidates the whole `user-roles`
 * family (every selected-user variant), matching `rbacKeys.userRoles`'s own
 * prefix — the page only ever has one user selected at a time, but this
 * keeps the invalidation correct regardless of which one it was.
 */
export function useUserRoleMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['rbac', 'user-roles'] });

  return {
    grant: useMutation({
      mutationFn: ({ userId, ...body }: { userId: number } & AssignRoleBody) => assignRole(userId, body),
      onSuccess: invalidate,
    }),
    revoke: useMutation({
      mutationFn: ({
        userId,
        roleId,
        scopeOrgUnitId,
        justification,
      }: {
        userId: number;
        roleId: number;
        scopeOrgUnitId?: number | null;
        justification?: string;
      }) => removeRole(userId, roleId, scopeOrgUnitId, justification),
      onSuccess: invalidate,
    }),
  };
}
