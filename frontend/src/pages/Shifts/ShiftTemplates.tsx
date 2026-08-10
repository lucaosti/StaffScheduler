/**
 * Shift templates — the named patterns shifts are created from.
 *
 * WHY RETIRING SAYS "RETIRE" AND NOT "DELETE". The server marks a template
 * inactive rather than removing it, and that is the right behaviour: shifts
 * already created from a template are ordinary shifts with their own rows, and
 * a template is a pattern used at a moment rather than something those shifts
 * belong to. Calling the button Delete would promise a reach into past
 * schedules that does not happen, and that nobody should want — a shift people
 * have already worked cannot be edited by changing the pattern it came from.
 *
 * The page says as much in a line of its own, because "retire" without an
 * explanation invites the reader to wonder what happened to the shifts.
 *
 * @author Luca Ostinelli
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import QueryState from '../../components/QueryState';
import { useShiftTemplatesQuery, useShiftTemplateMutations } from '../../hooks/useShiftTemplates';
import { useDepartmentsQuery } from '../../hooks/useDepartments';
import { formatTime } from '../../utils/format';
import { useActionFeedback } from '../../hooks/useActionFeedback';

/** The shared formatter, with the dash these tables use for an absent time. */
const shiftTime = (value?: string): string => formatTime(value) || '—';


const ShiftTemplates: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { message, run: act } = useActionFeedback();
  const canManage = (user?.permissions ?? []).includes('shift.manage');

  const [name, setName] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [minStaff, setMinStaff] = useState('1');
  const [maxStaff, setMaxStaff] = useState('1');

  const templates = useShiftTemplatesQuery();
  // Only a manager picks a department here, so the list is not fetched for a
  // reader who can see the templates but not create one.
  const departments = useDepartmentsQuery(canManage);
  const { create, remove } = useShiftTemplateMutations();


  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await act(
      create
        .mutateAsync({
          name,
          departmentId: Number(departmentId),
          startTime,
          endTime,
          minStaff: Number(minStaff),
          maxStaff: Number(maxStaff),
        })
        .then(() => setName(''))
    );
  };

  return (
    <div className="container-fluid py-3">
      <h1 className="h4 mb-1">{t('shiftTemplates.title')}</h1>
      <p className="text-muted">
        {t('shiftTemplates.subtitle')}
      </p>

      {message && (
        <div className="alert alert-warning" role="alert">
          {message}
        </div>
      )}

      {canManage && (
        <form className="row g-2 align-items-end mb-4" onSubmit={submit}>
          <div className="col-md-3">
            <label className="form-label" htmlFor="template-name">{t('shiftTemplates.form.name')}</label>
            <input
              id="template-name"
              className="form-control"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="col-md-3">
            <label className="form-label" htmlFor="template-department">{t('shiftTemplates.form.department')}</label>
            <select
              id="template-department"
              className="form-select"
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              required
            >
              <option value="">{t('shiftTemplates.form.chooseDepartment')}</option>
              {(departments.data ?? []).map((d) => (
                <option key={String(d.id)} value={String(d.id)}>{d.name}</option>
              ))}
            </select>
          </div>
          <div className="col-auto">
            <label className="form-label" htmlFor="template-start">{t('shiftTemplates.form.starts')}</label>
            <input
              id="template-start"
              type="time"
              className="form-control"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              required
            />
          </div>
          <div className="col-auto">
            <label className="form-label" htmlFor="template-end">{t('shiftTemplates.form.ends')}</label>
            <input
              id="template-end"
              type="time"
              className="form-control"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              required
            />
          </div>
          <div className="col-auto">
            <label className="form-label" htmlFor="template-min">{t('shiftTemplates.form.minStaff')}</label>
            <input
              id="template-min"
              type="number"
              min={0}
              className="form-control"
              value={minStaff}
              onChange={(e) => setMinStaff(e.target.value)}
            />
          </div>
          <div className="col-auto">
            <label className="form-label" htmlFor="template-max">{t('shiftTemplates.form.maxStaff')}</label>
            <input
              id="template-max"
              type="number"
              min={1}
              className="form-control"
              value={maxStaff}
              onChange={(e) => setMaxStaff(e.target.value)}
            />
          </div>
          <div className="col-auto">
            <button type="submit" className="btn btn-primary" disabled={create.isPending}>
              {t('shiftTemplates.form.addTemplate')}
            </button>
          </div>
        </form>
      )}

      <QueryState
        isLoading={templates.isLoading}
        isError={templates.isError}
        error={templates.error}
        onRetry={templates.refetch}
        isEmpty={(templates.data?.length ?? 0) === 0}
        loadingMessage={t('shiftTemplates.loading')}
        empty={<p className="text-muted">{t('shiftTemplates.empty')}</p>}
      >
        <table className="table table-sm align-middle">
          <thead>
            <tr>
              <th>{t('shiftTemplates.columns.name')}</th>
              <th>{t('shiftTemplates.columns.department')}</th>
              <th>{t('shiftTemplates.columns.hours')}</th>
              <th>{t('shiftTemplates.columns.staffing')}</th>
              {canManage && <th />}
            </tr>
          </thead>
          <tbody>
            {(templates.data ?? []).map((t2) => (
              <tr key={t2.id}>
                <td>{t2.name}</td>
                <td>{t2.departmentName ?? t2.departmentId}</td>
                <td>
                  {t('common.timeRange', { start: shiftTime(t2.startTime), end: shiftTime(t2.endTime) })}
                </td>
                <td>
                  {t('shiftTemplates.staffingRange', { min: t2.minStaff, max: t2.maxStaff })}
                </td>
                {canManage && (
                  <td className="text-end">
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-danger"
                      onClick={() => act(remove.mutateAsync(t2.id))}
                      disabled={remove.isPending}
                    >
                      {t('shiftTemplates.retire')}
                    </button>
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

export default ShiftTemplates;
