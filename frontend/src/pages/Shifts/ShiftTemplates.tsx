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
import { useAuth } from '../../contexts/AuthContext';
import QueryState from '../../components/QueryState';
import { useShiftTemplatesQuery, useShiftTemplateMutations } from '../../hooks/useShiftTemplates';
import { useDepartmentsQuery } from '../../hooks/useDepartments';
import { formatTime } from '../../utils/format';
import { useActionFeedback } from '../../hooks/useActionFeedback';

/** The shared formatter, with the dash these tables use for an absent time. */
const shiftTime = (value?: string): string => formatTime(value) || '—';


const ShiftTemplates: React.FC = () => {
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
      <h1 className="h4 mb-1">Shift templates</h1>
      <p className="text-muted">
        Patterns shifts are created from. Retiring one stops it being offered; shifts already
        created from it are unaffected.
      </p>

      {message && (
        <div className="alert alert-warning" role="alert">
          {message}
        </div>
      )}

      {canManage && (
        <form className="row g-2 align-items-end mb-4" onSubmit={submit}>
          <div className="col-md-3">
            <label className="form-label" htmlFor="template-name">Name</label>
            <input
              id="template-name"
              className="form-control"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="col-md-3">
            <label className="form-label" htmlFor="template-department">Department</label>
            <select
              id="template-department"
              className="form-select"
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              required
            >
              <option value="">Choose a department…</option>
              {(departments.data ?? []).map((d) => (
                <option key={String(d.id)} value={String(d.id)}>{d.name}</option>
              ))}
            </select>
          </div>
          <div className="col-auto">
            <label className="form-label" htmlFor="template-start">Starts</label>
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
            <label className="form-label" htmlFor="template-end">Ends</label>
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
            <label className="form-label" htmlFor="template-min">Min staff</label>
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
            <label className="form-label" htmlFor="template-max">Max staff</label>
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
              Add template
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
        loadingMessage="Loading templates…"
        empty={<p className="text-muted">No shift templates defined yet.</p>}
      >
        <table className="table table-sm align-middle">
          <thead>
            <tr>
              <th>Name</th>
              <th>Department</th>
              <th>Hours</th>
              <th>Staffing</th>
              {canManage && <th />}
            </tr>
          </thead>
          <tbody>
            {(templates.data ?? []).map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td>{t.departmentName ?? t.departmentId}</td>
                <td>
                  {shiftTime(t.startTime)}–{shiftTime(t.endTime)}
                </td>
                <td>
                  {t.minStaff}–{t.maxStaff}
                </td>
                {canManage && (
                  <td className="text-end">
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-danger"
                      onClick={() => act(remove.mutateAsync(t.id))}
                      disabled={remove.isPending}
                    >
                      Retire
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
