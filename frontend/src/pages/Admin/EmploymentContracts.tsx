/**
 * Employment contracts — the working-time limits, and who is on which.
 *
 * WHY THIS IS PLAINLY A MANAGER'S SCREEN. These limits are hard constraints
 * the optimizer enforces and are legally bounded in most jurisdictions. They
 * used to live on `user_preferences`, which is how an employee came to be able
 * to raise their own legal maximums — the defect the whole entity exists to
 * make impossible. Nothing here is self-service, and the page says so rather
 * than relying on the reader inferring it from a permission they cannot see.
 *
 * WHY A BLANK LIMIT IS SHOWN AS "not constrained" RATHER THAN AS ZERO OR A
 * DASH. `null` means this contract does not bound that limit, and the caller
 * falls back to their historical default — which is a different statement from
 * "zero hours" and from "unknown". Getting that wrong in a form is how someone
 * accidentally caps a colleague at no hours at all.
 *
 * WHY THE HISTORY IS THE POINT. Effective dating exists so that last month's
 * schedule can be judged against the limits that applied last month. A screen
 * showing only the current contract would answer the easy question and hide
 * the one the entity was built for.
 *
 * @author Luca Ostinelli
 */

import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import QueryState from '../../components/QueryState';
import { useContractsQuery, useUserContractsQuery, useContractMutations } from '../../hooks/useEmploymentContracts';
import { useEmployeesQuery } from '../../hooks/useEmployees';
import type { EmploymentContract } from '../../services/employmentContractService';
import { useActionFeedback } from '../../hooks/useActionFeedback';
import { todayIso } from '../../utils/format';

const LIMITS: Array<{ key: keyof EmploymentContract; label: string }> = [
  { key: 'maxHoursPerWeek', label: 'Max hours / week' },
  { key: 'minHoursPerWeek', label: 'Min hours / week' },
  { key: 'maxHoursPerDay', label: 'Max hours / day' },
  { key: 'maxConsecutiveDays', label: 'Max consecutive days' },
  { key: 'minHoursBetweenShifts', label: 'Min rest between shifts' },
  { key: 'minConsecutiveDaysOff', label: 'Min consecutive days off' },
  { key: 'minDaysOffPerPeriod', label: 'Min days off per 7-day period' },
];


const EmploymentContracts: React.FC = () => {
  const { user } = useAuth();
  const { message, run: act } = useActionFeedback();
  const canManage = (user?.permissions ?? []).includes('preferences.manage');

  const [name, setName] = useState('');
  const [limits, setLimits] = useState<Record<string, string>>({});
  const [personId, setPersonId] = useState('');
  const [contractId, setContractId] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso());
  const [effectiveTo, setEffectiveTo] = useState('');

  const contracts = useContractsQuery();
  const employees = useEmployeesQuery('', '', canManage);
  const history = useUserContractsQuery(personId ? Number(personId) : null);
  const { create, assign } = useContractMutations();


  const submitContract = async (e: React.FormEvent) => {
    e.preventDefault();
    // An empty field means "this contract does not constrain it", so it is
    // omitted rather than sent as 0 — which would cap someone at nothing.
    const body: Record<string, unknown> = { name };
    for (const { key } of LIMITS) {
      const raw = limits[key as string];
      if (raw !== undefined && raw !== '') body[key as string] = Number(raw);
    }
    await act(
      create.mutateAsync(body).then(() => {
        setName('');
        setLimits({});
      })
    );
  };

  const submitAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    await act(
      assign.mutateAsync({
        userId: Number(personId),
        contractId: Number(contractId),
        effectiveFrom,
        // Empty means open-ended — in force until something replaces it — and
        // that is a different statement from a period ending today.
        effectiveTo: effectiveTo || null,
      })
    );
  };

  return (
    <div className="container-fluid py-3">
      <h1 className="h4 mb-1">Employment contracts</h1>
      <p className="text-muted">
        Working-time limits the scheduler enforces. Set by managers, never by the person they
        apply to.
      </p>

      {message && (
        <div className="alert alert-warning" role="alert">
          {message}
        </div>
      )}

      {canManage && (
        <form className="row g-2 align-items-end mb-4" onSubmit={submitContract}>
          <div className="col-md-3">
            <label className="form-label" htmlFor="contract-name">Name</label>
            <input
              id="contract-name"
              className="form-control"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          {LIMITS.map(({ key, label }) => (
            <div className="col-auto" key={String(key)}>
              <label className="form-label" htmlFor={`contract-${String(key)}`}>{label}</label>
              <input
                id={`contract-${String(key)}`}
                type="number"
                min={0}
                className="form-control"
                placeholder="—"
                value={limits[key as string] ?? ''}
                onChange={(e) => setLimits({ ...limits, [key as string]: e.target.value })}
              />
            </div>
          ))}
          <div className="col-auto">
            <button type="submit" className="btn btn-primary" disabled={create.isPending}>
              Add contract
            </button>
          </div>
        </form>
      )}

      <QueryState
        isLoading={contracts.isLoading}
        isError={contracts.isError}
        error={contracts.error}
        onRetry={contracts.refetch}
        isEmpty={(contracts.data?.length ?? 0) === 0}
        loadingMessage="Loading contracts…"
        empty={<p className="text-muted">No contracts defined yet.</p>}
      >
        <table className="table table-sm align-middle mb-4">
          <thead>
            <tr>
              <th>Name</th>
              {LIMITS.map(({ key, label }) => (
                <th key={String(key)}>{label}</th>
              ))}
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {(contracts.data ?? []).map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                {LIMITS.map(({ key }) => (
                  <td key={String(key)}>
                    {c[key] === null || c[key] === undefined ? (
                      // Not "0" and not "—": the contract does not bound this,
                      // and the caller falls back to their default.
                      <span className="text-muted">not constrained</span>
                    ) : (
                      String(c[key])
                    )}
                  </td>
                ))}
                <td>
                  <span className={`badge ${c.isActive ? 'bg-success' : 'bg-secondary'}`}>
                    {c.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </QueryState>

      {canManage && (
        <>
          <h2 className="h6">Who is on which contract</h2>
          <form className="row g-2 align-items-end mb-3" onSubmit={submitAssignment}>
            <div className="col-md-3">
              <label className="form-label" htmlFor="contract-person">Person</label>
              <select
                id="contract-person"
                className="form-select"
                value={personId}
                onChange={(e) => setPersonId(e.target.value)}
                required
              >
                <option value="">Choose someone…</option>
                {(employees.data ?? []).map((e) => (
                  <option key={String(e.id)} value={String(e.id)}>
                    {[e.firstName, e.lastName].filter(Boolean).join(' ') || e.email}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-3">
              <label className="form-label" htmlFor="contract-choice">Contract</label>
              <select
                id="contract-choice"
                className="form-select"
                value={contractId}
                onChange={(e) => setContractId(e.target.value)}
                required
              >
                <option value="">Choose a contract…</option>
                {(contracts.data ?? []).map((c) => (
                  <option key={c.id} value={String(c.id)}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="col-auto">
              <label className="form-label" htmlFor="contract-from">In force from</label>
              <input
                id="contract-from"
                type="date"
                className="form-control"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
                required
              />
            </div>
            <div className="col-auto">
              <label className="form-label" htmlFor="contract-to">Until (optional)</label>
              <input
                id="contract-to"
                type="date"
                className="form-control"
                value={effectiveTo}
                onChange={(e) => setEffectiveTo(e.target.value)}
              />
            </div>
            <div className="col-auto">
              <button type="submit" className="btn btn-primary" disabled={assign.isPending}>
                Assign
              </button>
            </div>
          </form>

          {personId && (
            <QueryState
              isLoading={history.isLoading}
              isError={history.isError}
              error={history.error}
              onRetry={history.refetch}
              isEmpty={(history.data?.length ?? 0) === 0}
              loadingMessage="Loading contract history…"
              empty={<p className="text-muted">This person has no contract on record.</p>}
            >
              <table className="table table-sm align-middle">
                <thead>
                  <tr>
                    <th>Contract</th>
                    <th>From</th>
                    <th>Until</th>
                  </tr>
                </thead>
                <tbody>
                  {(history.data ?? []).map((a) => (
                    <tr key={a.id}>
                      <td>{a.contractName}</td>
                      <td>{a.effectiveFrom}</td>
                      {/* Open-ended is not "no end date is known": it is in
                          force until something replaces it. */}
                      <td>{a.effectiveTo ?? <span className="text-muted">still in force</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </QueryState>
          )}
        </>
      )}
    </div>
  );
};

export default EmploymentContracts;
