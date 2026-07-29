/**
 * User accounts — who can sign in, and with which roles.
 *
 * WHY THIS IS NOT THE EMPLOYEES PAGE. `/employees` is the staff record used
 * for scheduling; this is the ACCOUNT. They share a person and almost nothing
 * else, and conflating them is how a deactivated account keeps appearing in a
 * roster. The page says which of the two it is, because "user" and "employee"
 * are the same word to most readers.
 *
 * WHY DEACTIVATE AND NOT DELETE. The endpoint is `DELETE`; the effect is to
 * set `is_active = 0`. The row stays, and so does everything hanging off it —
 * assignments worked, decisions made, the audit trail. That is the right
 * behaviour and the wrong word, so the control says what happens rather than
 * what the verb is. An account with history cannot simply disappear, and a
 * button promising it would be lying.
 *
 * WHY INACTIVE ACCOUNTS ARE LISTED. Hiding them would make a deactivated
 * account indistinguishable from one that was never created — which is the
 * question someone is asking when they cannot find a colleague.
 *
 * @author Luca Ostinelli
 */

import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import QueryState from '../../components/QueryState';
import { useUserAccountsQuery, useUserAccountMutations } from '../../hooks/useUserAccounts';
import { useRolesAndPermissionsQuery } from '../../hooks/useRbac';
import type { UserAccount } from '../../services/userAccountService';

const UserAccounts: React.FC = () => {
  const { user } = useAuth();
  const permissions = user?.permissions ?? [];
  const canRead = permissions.includes('user.read') || permissions.includes('user.read_all');
  const canManage = permissions.includes('user.manage');

  const [search, setSearch] = useState('');
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [roleId, setRoleId] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const accounts = useUserAccountsQuery(search ? { search } : {}, canRead);
  const rbac = useRolesAndPermissionsQuery();
  const { create, update, deactivate } = useUserAccountMutations();

  const act = async (run: Promise<unknown>) => {
    setMessage(null);
    try {
      await run;
    } catch (error) {
      // The server refuses privilege escalation through role assignment by
      // name; a generic failure would hide why a role was rejected.
      setMessage(error instanceof Error ? error.message : 'The request failed');
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await act(
      create
        .mutateAsync({
          email,
          firstName,
          lastName,
          // No password field: an account is created and its holder sets their
          // own credential through the reset flow. Typing someone else's
          // password into a form is how a shared secret stops being theirs.
          ...(roleId ? { roleIds: [Number(roleId)] } : {}),
        })
        .then(() => {
          setEmail('');
          setFirstName('');
          setLastName('');
        })
    );
  };

  if (!canRead) {
    return (
      <div className="container-fluid py-3">
        <h1 className="h4">User accounts</h1>
        <p className="text-muted">You do not have permission to view accounts.</p>
      </div>
    );
  }

  return (
    <div className="container-fluid py-3">
      <h1 className="h4 mb-1">User accounts</h1>
      <p className="text-muted">
        Who can sign in, and with which roles. Separate from the employee record used for
        scheduling.
      </p>

      {message && (
        <div className="alert alert-warning" role="alert">
          {message}
        </div>
      )}

      {canManage && (
        <form className="row g-2 align-items-end mb-4" onSubmit={submit}>
          <div className="col-md-3">
            <label className="form-label" htmlFor="account-email">Email</label>
            <input
              id="account-email"
              type="email"
              className="form-control"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="col-md-2">
            <label className="form-label" htmlFor="account-first">First name</label>
            <input
              id="account-first"
              className="form-control"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
            />
          </div>
          <div className="col-md-2">
            <label className="form-label" htmlFor="account-last">Last name</label>
            <input
              id="account-last"
              className="form-control"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
            />
          </div>
          <div className="col-md-2">
            <label className="form-label" htmlFor="account-role">Role</label>
            <select
              id="account-role"
              className="form-select"
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
            >
              <option value="">No role</option>
              {(rbac.data?.roles ?? []).map((r) => (
                <option key={String(r.id)} value={String(r.id)}>{r.name}</option>
              ))}
            </select>
          </div>
          <div className="col-auto">
            <button type="submit" className="btn btn-primary" disabled={create.isPending}>
              Create account
            </button>
          </div>
        </form>
      )}

      <div className="mb-3">
        <label className="form-label" htmlFor="account-search">Search</label>
        <input
          id="account-search"
          className="form-control"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Name or email"
        />
      </div>

      <QueryState
        isLoading={accounts.isLoading}
        isError={accounts.isError}
        error={accounts.error}
        onRetry={accounts.refetch}
        isEmpty={(accounts.data?.length ?? 0) === 0}
        loadingMessage="Loading accounts…"
        empty={<p className="text-muted">No accounts match.</p>}
      >
        <table className="table table-sm align-middle">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Roles</th>
              <th>Status</th>
              {canManage && <th />}
            </tr>
          </thead>
          <tbody>
            {(accounts.data ?? []).map((a: UserAccount) => (
              <tr key={a.id}>
                <td>{[a.firstName, a.lastName].filter(Boolean).join(' ')}</td>
                <td>{a.email}</td>
                <td>{(a.roles ?? []).map((r) => r.name).join(', ') || '—'}</td>
                <td>
                  <span className={`badge ${a.isActive ? 'bg-success' : 'bg-secondary'}`}>
                    {a.isActive ? 'Active' : 'Deactivated'}
                  </span>
                </td>
                {canManage && (
                  <td className="text-end">
                    {a.isActive ? (
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-danger"
                        onClick={() => act(deactivate.mutateAsync(a.id))}
                        disabled={deactivate.isPending}
                      >
                        Deactivate
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-secondary"
                        onClick={() => act(update.mutateAsync({ id: a.id, isActive: true }))}
                        disabled={update.isPending}
                      >
                        Reactivate
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </QueryState>
    </div>
  );
};

export default UserAccounts;
