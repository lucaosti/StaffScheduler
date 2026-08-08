/**
 * Setting the labor-cost target an administrator compares actual spend
 * against, per department per period.
 *
 * WHY A PLAIN LIST + FORM RATHER THAN A DEDICATED PAGE. A cost plan is one
 * number (a target amount) attached to a department and a period; the same
 * proportion `FieldPolicySection` already applies to a comparably small
 * admin surface. The comparison itself lives on the Dashboard, next to the
 * actual-cost figure — this is only where the target gets set.
 *
 * @author Luca Ostinelli
 */

import React, { useState } from 'react';
import QueryState from '../../components/QueryState';
import { useDepartmentsQuery } from '../../hooks/useDepartments';
import {
  useCostPlansQuery,
  useCreateCostPlan,
  useDeleteCostPlan,
  useUpdateCostPlan,
} from '../../hooks/useCostPlans';
import type { CostPlan } from '../../services/costPlanService';
import { formatCurrency } from '../../utils/format';

interface Draft {
  departmentId: string;
  startDate: string;
  endDate: string;
  targetAmount: string;
}

const EMPTY_DRAFT: Draft = { departmentId: '', startDate: '', endDate: '', targetAmount: '' };

const CostPlansSection: React.FC = () => {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const plansQuery = useCostPlansQuery();
  const departmentsQuery = useDepartmentsQuery();
  const create = useCreateCostPlan();
  const update = useUpdateCostPlan();
  const remove = useDeleteCostPlan();

  const departments = departmentsQuery.data ?? [];
  const plans = plansQuery.data ?? [];

  const departmentName = (id: number) =>
    departments.find((d) => Number(d.id) === id)?.name ?? `#${id}`;

  const startEditing = (plan: CostPlan) => {
    setMessage(null);
    setError(null);
    setEditingId(plan.id);
    setDraft({
      departmentId: String(plan.departmentId),
      startDate: plan.startDate,
      endDate: plan.endDate,
      targetAmount: String(plan.targetAmount),
    });
  };

  const resetForm = () => {
    setDraft(EMPTY_DRAFT);
    setEditingId(null);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    const targetAmount = Number(draft.targetAmount);
    try {
      if (editingId !== null) {
        await update.mutateAsync({ id: editingId, targetAmount });
        setMessage('Cost plan updated.');
      } else {
        await create.mutateAsync({
          departmentId: Number(draft.departmentId),
          startDate: draft.startDate,
          endDate: draft.endDate,
          targetAmount,
        });
        setMessage('Cost plan created.');
      }
      resetForm();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to save the cost plan');
    }
  };

  const handleDelete = async (plan: CostPlan) => {
    if (!window.confirm(`Remove the cost plan for ${departmentName(plan.departmentId)}?`)) return;
    setError(null);
    try {
      await remove.mutateAsync(plan.id);
      setMessage('Cost plan removed.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to remove the cost plan');
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <h5 className="mb-0">Cost plans</h5>
      </div>
      <div className="card-body">
        <p className="text-muted small">
          A fixed labor-cost target per department per period, set by hand — not derived from
          headcount or contracted hours. Compared against actual cost on the Dashboard.
        </p>

        {message && (
          <div className="alert alert-success py-2" role="status">
            {message}
          </div>
        )}
        {error && (
          <div className="alert alert-danger py-2" role="alert">
            {error}
          </div>
        )}

        <QueryState
          isLoading={plansQuery.isLoading}
          isError={plansQuery.isError}
          error={plansQuery.error}
          onRetry={plansQuery.refetch}
          loadingMessage="Loading cost plans…"
        >
          <div className="table-responsive">
            <table className="table table-sm align-middle">
              <thead>
                <tr>
                  <th scope="col">Department</th>
                  <th scope="col">Period</th>
                  <th scope="col">Target</th>
                  <th scope="col"></th>
                </tr>
              </thead>
              <tbody>
                {plans.length === 0 && (
                  <tr>
                    <td colSpan={4} className="text-muted text-center">
                      No cost plans set yet.
                    </td>
                  </tr>
                )}
                {plans.map((plan) => (
                  <tr key={plan.id}>
                    <td>{departmentName(plan.departmentId)}</td>
                    <td className="small text-muted">
                      {plan.startDate} – {plan.endDate}
                    </td>
                    <td>{formatCurrency(plan.targetAmount)}</td>
                    <td className="text-end">
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-secondary me-2"
                        onClick={() => startEditing(plan)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-danger"
                        onClick={() => handleDelete(plan)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </QueryState>

        <form className="border rounded p-3 mt-3" onSubmit={handleSubmit}>
          <h6 className="mb-3">{editingId !== null ? 'Edit cost plan' : 'New cost plan'}</h6>
          <div className="row g-3">
            <div className="col-md-3">
              <label className="form-label" htmlFor="cost-plan-department">
                Department
              </label>
              <select
                id="cost-plan-department"
                className="form-select"
                required
                disabled={editingId !== null}
                value={draft.departmentId}
                onChange={(e) => setDraft({ ...draft, departmentId: e.target.value })}
              >
                <option value="" disabled>
                  Select…
                </option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-3">
              <label className="form-label" htmlFor="cost-plan-start">
                Start date
              </label>
              <input
                id="cost-plan-start"
                type="date"
                className="form-control"
                required
                disabled={editingId !== null}
                value={draft.startDate}
                onChange={(e) => setDraft({ ...draft, startDate: e.target.value })}
              />
            </div>
            <div className="col-md-3">
              <label className="form-label" htmlFor="cost-plan-end">
                End date
              </label>
              <input
                id="cost-plan-end"
                type="date"
                className="form-control"
                required
                disabled={editingId !== null}
                value={draft.endDate}
                onChange={(e) => setDraft({ ...draft, endDate: e.target.value })}
              />
            </div>
            <div className="col-md-3">
              <label className="form-label" htmlFor="cost-plan-amount">
                Target amount
              </label>
              <input
                id="cost-plan-amount"
                type="number"
                min={0}
                step="0.01"
                className="form-control"
                required
                value={draft.targetAmount}
                onChange={(e) => setDraft({ ...draft, targetAmount: e.target.value })}
              />
            </div>
          </div>
          <div className="mt-3 d-flex gap-2">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={create.isPending || update.isPending}
            >
              {create.isPending || update.isPending ? 'Saving…' : editingId !== null ? 'Save' : 'Create'}
            </button>
            {editingId !== null && (
              <button type="button" className="btn btn-link" onClick={resetForm}>
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};

export default CostPlansSection;
