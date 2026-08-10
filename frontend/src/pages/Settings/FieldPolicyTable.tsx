/**
 * FieldPolicyTable — the list of governable core fields, each with its
 * current rule summary and edit/remove actions. See FieldPolicySection.tsx.
 *
 * @author Luca Ostinelli
 */

import React from 'react';
import type { FieldPolicy } from '../../services/fieldPolicyService';
import { ALWAYS_REQUIRED } from './fieldPolicyDraft';

interface Props {
  fields: string[];
  byKey: Map<string, FieldPolicy>;
  onEdit: (fieldKey: string) => void;
  onDelete: (fieldKey: string) => void;
}

const FieldPolicyTable: React.FC<Props> = ({ fields, byKey, onEdit, onDelete }) => (
  <div className="table-responsive">
    <table className="table table-sm align-middle">
      <thead>
        <tr>
          <th scope="col">Field</th>
          <th scope="col">Required</th>
          <th scope="col">Rule</th>
          <th scope="col">Message shown</th>
          <th scope="col"></th>
        </tr>
      </thead>
      <tbody>
        {fields.map((field) => {
          const policy = byKey.get(field);
          const alwaysRequired = ALWAYS_REQUIRED.has(field);
          return (
            <tr key={field}>
              <td className="fw-semibold">{field}</td>
              <td>
                {alwaysRequired ? (
                  <span
                    className="badge bg-secondary"
                    title="Required by the database and by sign-in; a rule cannot make it optional"
                  >
                    always
                  </span>
                ) : policy?.isRequired ? (
                  <span className="badge bg-primary">yes</span>
                ) : (
                  <span className="text-muted">no</span>
                )}
              </td>
              <td className="small text-muted">
                {policy
                  ? [
                      policy.minLength !== null && `min ${policy.minLength} chars`,
                      policy.maxLength !== null && `max ${policy.maxLength} chars`,
                      policy.minValue !== null && `min ${policy.minValue}`,
                      policy.maxValue !== null && `max ${policy.maxValue}`,
                      policy.pattern && `pattern ${policy.pattern}`,
                      policy.allowedValues && `one of ${policy.allowedValues.join(', ')}`,
                      policy.editPermission && `edit needs ${policy.editPermission}`,
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'no rule'
                  : 'no rule'}
              </td>
              <td className="small">
                {policy?.helpText ?? <span className="text-muted">generated wording</span>}
              </td>
              <td className="text-end">
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary me-2"
                  onClick={() => onEdit(field)}
                >
                  {policy ? 'Edit' : 'Add rule'}
                </button>
                {policy && (
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-danger"
                    onClick={() => onDelete(field)}
                  >
                    Remove
                  </button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);

export default FieldPolicyTable;
