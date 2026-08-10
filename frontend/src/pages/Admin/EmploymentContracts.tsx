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
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import QueryState from '../../components/QueryState';
import { useContractsQuery, useUserContractsQuery, useContractMutations } from '../../hooks/useEmploymentContracts';
import { useEmployeesQuery } from '../../hooks/useEmployees';
import type { EmploymentContract } from '../../services/employmentContractService';
import { useActionFeedback } from '../../hooks/useActionFeedback';
import { todayIso } from '../../utils/format';

const LIMIT_KEYS: Array<{ key: keyof EmploymentContract; labelKey: string }> = [
  { key: 'maxHoursPerWeek', labelKey: 'admin.employmentContracts.limits.maxHoursPerWeek' },
  { key: 'minHoursPerWeek', labelKey: 'admin.employmentContracts.limits.minHoursPerWeek' },
  { key: 'maxHoursPerDay', labelKey: 'admin.employmentContracts.limits.maxHoursPerDay' },
  { key: 'maxConsecutiveDays', labelKey: 'admin.employmentContracts.limits.maxConsecutiveDays' },
  { key: 'minHoursBetweenShifts', labelKey: 'admin.employmentContracts.limits.minHoursBetweenShifts' },
  { key: 'minConsecutiveDaysOff', labelKey: 'admin.employmentContracts.limits.minConsecutiveDaysOff' },
  { key: 'minDaysOffPerPeriod', labelKey: 'admin.employmentContracts.limits.minDaysOffPerPeriod' },
];


const EmploymentContracts: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { message, run: act } = useActionFeedback();
  const canManage = (user?.permissions ?? []).includes('preferences.manage');

  const LIMITS = LIMIT_KEYS.map(({ key, labelKey }) => ({ key, label: t(labelKey) }));

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
      <h1 className="h4 mb-1">{t('admin.employmentContracts.title')}</h1>
      <p className="text-muted">
        {t('admin.employmentContracts.subtitle')}
      </p>

      {message && (
        <div className="alert alert-warning" role="alert">
          {message}
        </div>
      )}

      {canManage && (
        <form className="row g-2 align-items-end mb-4" onSubmit={submitContract}>
          <div className="col-md-3">
            <label className="form-label" htmlFor="contract-name">{t('admin.employmentContracts.form.name')}</label>
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
                placeholder={t('common.emptyValue')}
                value={limits[key as string] ?? ''}
                onChange={(e) => setLimits({ ...limits, [key as string]: e.target.value })}
              />
            </div>
          ))}
          <div className="col-auto">
            <button type="submit" className="btn btn-primary" disabled={create.isPending}>
              {t('admin.employmentContracts.form.addContract')}
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
        loadingMessage={t('admin.employmentContracts.loadingContracts')}
        empty={<p className="text-muted">{t('admin.employmentContracts.emptyContracts')}</p>}
      >
        <table className="table table-sm align-middle mb-4">
          <thead>
            <tr>
              <th>{t('admin.employmentContracts.form.name')}</th>
              {LIMITS.map(({ key, label }) => (
                <th key={String(key)}>{label}</th>
              ))}
              <th>{t('admin.employmentContracts.table.status')}</th>
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
                      <span className="text-muted">{t('admin.employmentContracts.notConstrained')}</span>
                    ) : (
                      String(c[key])
                    )}
                  </td>
                ))}
                <td>
                  <span className={`badge ${c.isActive ? 'bg-success' : 'bg-secondary'}`}>
                    {c.isActive ? t('admin.employmentContracts.status.active') : t('admin.employmentContracts.status.inactive')}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </QueryState>

      {canManage && (
        <>
          <h2 className="h6">{t('admin.employmentContracts.assignment.title')}</h2>
          <form className="row g-2 align-items-end mb-3" onSubmit={submitAssignment}>
            <div className="col-md-3">
              <label className="form-label" htmlFor="contract-person">{t('admin.employmentContracts.assignment.person')}</label>
              <select
                id="contract-person"
                className="form-select"
                value={personId}
                onChange={(e) => setPersonId(e.target.value)}
                required
              >
                <option value="">{t('admin.employmentContracts.assignment.choosePerson')}</option>
                {(employees.data ?? []).map((e) => (
                  <option key={String(e.id)} value={String(e.id)}>
                    {[e.firstName, e.lastName].filter(Boolean).join(' ') || e.email}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-3">
              <label className="form-label" htmlFor="contract-choice">{t('admin.employmentContracts.assignment.contract')}</label>
              <select
                id="contract-choice"
                className="form-select"
                value={contractId}
                onChange={(e) => setContractId(e.target.value)}
                required
              >
                <option value="">{t('admin.employmentContracts.assignment.chooseContract')}</option>
                {(contracts.data ?? []).map((c) => (
                  <option key={c.id} value={String(c.id)}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="col-auto">
              <label className="form-label" htmlFor="contract-from">{t('admin.employmentContracts.assignment.inForceFrom')}</label>
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
              <label className="form-label" htmlFor="contract-to">{t('admin.employmentContracts.assignment.until')}</label>
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
                {t('admin.employmentContracts.assignment.assign')}
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
              loadingMessage={t('admin.employmentContracts.history.loading')}
              empty={<p className="text-muted">{t('admin.employmentContracts.history.empty')}</p>}
            >
              <table className="table table-sm align-middle">
                <thead>
                  <tr>
                    <th>{t('admin.employmentContracts.history.columns.contract')}</th>
                    <th>{t('admin.employmentContracts.history.columns.from')}</th>
                    <th>{t('admin.employmentContracts.history.columns.until')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(history.data ?? []).map((a) => (
                    <tr key={a.id}>
                      <td>{a.contractName}</td>
                      <td>{a.effectiveFrom}</td>
                      {/* Open-ended is not "no end date is known": it is in
                          force until something replaces it. */}
                      <td>{a.effectiveTo ?? <span className="text-muted">{t('admin.employmentContracts.history.stillInForce')}</span>}</td>
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
