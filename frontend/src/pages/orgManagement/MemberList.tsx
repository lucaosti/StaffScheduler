/**
 * MemberList — Department members list with add/make-primary/remove actions.
 *
 * @author Luca Ostinelli
 */

import React from 'react';
import type { OrgUnit, UserOrgUnit } from '../../services/orgService';
import EmptyState from '../../components/EmptyState';

interface Props {
  units: OrgUnit[];
  selectedUnitId: number | null;
  members: UserOrgUnit[];
  busy: boolean;
  canManage: boolean;
  memberForm: { userId: string; isPrimary: boolean };
  onUnitSelect: (id: number | null) => void;
  onMemberFormChange: (v: { userId: string; isPrimary: boolean }) => void;
  onAddMember: (e: React.FormEvent) => void;
  onSetPrimary: (userId: number) => void;
  onRemoveMember: (userId: number) => void;
}

const MemberList: React.FC<Props> = ({
  units,
  selectedUnitId,
  members,
  busy,
  canManage,
  memberForm,
  onUnitSelect,
  onMemberFormChange,
  onAddMember,
  onSetPrimary,
  onRemoveMember,
}) => (
  <div className="card">
    <div className="card-body">
      <div className="row g-2 mb-3">
        <div className="col-md-6">
          <label className="form-label">Org unit</label>
          <select
            className="form-select"
            value={selectedUnitId ?? ''}
            onChange={(e) => onUnitSelect(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Select…</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {selectedUnitId !== null && (
        <>
          {canManage && (
            <form className="row g-2 mb-3" onSubmit={onAddMember}>
              <div className="col-md-3">
                <input
                  type="number"
                  className="form-control"
                  placeholder="User id"
                  value={memberForm.userId}
                  onChange={(e) => onMemberFormChange({ ...memberForm, userId: e.target.value })}
                  required
                />
              </div>
              <div className="col-md-3 d-flex align-items-center">
                <div className="form-check">
                  <input
                    type="checkbox"
                    id="memberPrimary"
                    className="form-check-input"
                    checked={memberForm.isPrimary}
                    onChange={(e) =>
                      onMemberFormChange({ ...memberForm, isPrimary: e.target.checked })
                    }
                  />
                  <label className="form-check-label" htmlFor="memberPrimary">
                    Primary
                  </label>
                </div>
              </div>
              <div className="col-md-2">
                <button className="btn btn-primary w-100" disabled={busy}>
                  Add member
                </button>
              </div>
            </form>
          )}

          {members.length === 0 ? (
            <EmptyState
              icon="bi-people"
              title="No members"
              message="Add members to this unit using the form above."
            />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Primary</th>
                  <th>Assigned</th>
                  <th className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id}>
                    <td>{m.userId}</td>
                    <td>
                      {m.isPrimary ? (
                        <span className="badge bg-primary">primary</span>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td>{m.assignedAt}</td>
                    <td className="text-end">
                      {!m.isPrimary && canManage && (
                        <button
                          className="btn btn-sm btn-outline-primary me-1"
                          onClick={() => onSetPrimary(m.userId)}
                          disabled={busy}
                        >
                          Make primary
                        </button>
                      )}
                      {canManage && (
                        <button
                          className="btn btn-sm btn-outline-danger"
                          onClick={() => onRemoveMember(m.userId)}
                          disabled={busy}
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  </div>
);

export default MemberList;
