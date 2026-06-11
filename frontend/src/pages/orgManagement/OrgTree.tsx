/**
 * OrgTree — Org unit hierarchy display and create/delete actions.
 *
 * @author Luca Ostinelli
 */

import React from 'react';
import type { OrgUnit, OrgUnitNode } from '../../services/orgService';
import EmptyState from '../../components/EmptyState';

interface Props {
  units: OrgUnit[];
  tree: OrgUnitNode[];
  busy: boolean;
  canAdmin: boolean;
  newUnit: { name: string; parentId: string; managerUserId: string };
  onNewUnitChange: (v: { name: string; parentId: string; managerUserId: string }) => void;
  onCreateUnit: (e: React.FormEvent) => void;
  onDeleteUnit: (id: number) => void;
  onViewMembers: (id: number) => void;
}

const renderTree = (
  nodes: OrgUnitNode[],
  depth: number,
  props: Pick<Props, 'canAdmin' | 'busy' | 'onDeleteUnit' | 'onViewMembers'>
): JSX.Element[] => {
  const out: JSX.Element[] = [];
  for (const n of nodes) {
    out.push(
      <tr key={n.id}>
        <td>
          <span style={{ paddingLeft: depth * 16 }}>
            <i className="bi bi-diagram-3 me-2" />
            {n.name}
          </span>
        </td>
        <td>{n.managerUserId ?? '-'}</td>
        <td>
          <span className={`badge ${n.isActive ? 'bg-success' : 'bg-secondary'}`}>
            {n.isActive ? 'active' : 'inactive'}
          </span>
        </td>
        <td className="text-end">
          <button
            className="btn btn-sm btn-outline-primary me-1"
            onClick={() => props.onViewMembers(n.id)}
          >
            Members
          </button>
          {props.canAdmin && (
            <button
              className="btn btn-sm btn-outline-danger"
              onClick={() => props.onDeleteUnit(n.id)}
              disabled={props.busy}
            >
              Delete
            </button>
          )}
        </td>
      </tr>
    );
    if (n.children?.length) {
      out.push(...renderTree(n.children, depth + 1, props));
    }
  }
  return out;
};

const OrgTree: React.FC<Props> = ({
  units,
  tree,
  busy,
  canAdmin,
  newUnit,
  onNewUnitChange,
  onCreateUnit,
  onDeleteUnit,
  onViewMembers,
}) => (
  <div className="card">
    <div className="card-body">
      {canAdmin && (
        <form className="row g-2 mb-3" onSubmit={onCreateUnit}>
          <div className="col-md-4">
            <input
              className="form-control"
              placeholder="Unit name"
              value={newUnit.name}
              onChange={(e) => onNewUnitChange({ ...newUnit, name: e.target.value })}
              required
            />
          </div>
          <div className="col-md-3">
            <select
              className="form-select"
              value={newUnit.parentId}
              onChange={(e) => onNewUnitChange({ ...newUnit, parentId: e.target.value })}
            >
              <option value="">No parent (root)</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
          <div className="col-md-3">
            <input
              type="number"
              className="form-control"
              placeholder="Manager user id"
              value={newUnit.managerUserId}
              onChange={(e) => onNewUnitChange({ ...newUnit, managerUserId: e.target.value })}
            />
          </div>
          <div className="col-md-2">
            <button className="btn btn-primary w-100" disabled={busy}>
              Create
            </button>
          </div>
        </form>
      )}

      {tree.length === 0 ? (
        <EmptyState
          icon="bi-diagram-3"
          title="No org units yet"
          message="Create the first unit using the form above."
        />
      ) : (
        <table className="table table-hover">
          <thead>
            <tr>
              <th scope="col">Unit</th>
              <th scope="col">Manager</th>
              <th scope="col">Status</th>
              <th scope="col" className="text-end">Actions</th>
            </tr>
          </thead>
          <tbody>
            {renderTree(tree, 0, { canAdmin, busy, onDeleteUnit, onViewMembers })}
          </tbody>
        </table>
      )}
    </div>
  </div>
);

export default OrgTree;
