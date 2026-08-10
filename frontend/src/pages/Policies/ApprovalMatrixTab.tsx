/**
 * ApprovalMatrixTab (admin-only) — tweak which scope approves which change
 * type and toggle the auto-approve-for-owner shortcut. See Policies.tsx.
 *
 * @author Luca Ostinelli
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ApprovalMatrixRow } from '../../services/policyService';
import type { Role } from '../../types';

// Kept as identifiers (not JSX literals) so the option `value`s stay the raw
// enum the backend expects while the visible label goes through `t()`.
const MATRIX_SCOPES: ApprovalMatrixRow['approverScope'][] = [
  'policy_owner',
  'unit_manager',
  'unit_manager_chain',
  'company_role',
  'company_user',
];

const MATRIX_SCOPE_LABEL_KEYS: Record<ApprovalMatrixRow['approverScope'], string> = {
  policy_owner: 'policies.matrix.scopes.policyOwner',
  unit_manager: 'policies.matrix.scopes.unitManager',
  unit_manager_chain: 'policies.matrix.scopes.unitManagerChain',
  company_role: 'policies.matrix.scopes.companyRole',
  company_user: 'policies.matrix.scopes.companyUser',
};

interface Props {
  matrix: ApprovalMatrixRow[];
  roles: Role[];
  busy: boolean;
  onChange: (row: ApprovalMatrixRow, patch: Partial<ApprovalMatrixRow>) => void;
}

const ApprovalMatrixTab: React.FC<Props> = ({ matrix, roles, busy, onChange }) => {
  const { t } = useTranslation();

  return (
    <div className="card">
      <div className="card-body">
        <p className="text-muted">
          {t('policies.matrix.description')}
        </p>
        <table className="table">
          <thead>
            <tr>
              <th scope="col">{t('policies.matrix.columns.changeType')}</th>
              <th scope="col">{t('policies.matrix.columns.approverScope')}</th>
              <th scope="col">{t('policies.matrix.columns.role')}</th>
              <th scope="col">{t('policies.matrix.columns.user')}</th>
              <th scope="col">{t('policies.matrix.columns.autoApprove')}</th>
            </tr>
          </thead>
          <tbody>
            {matrix.map((row) => (
              <tr key={row.changeType}>
                <td>{row.changeType}</td>
                <td>
                  <select
                    className="form-select form-select-sm"
                    value={row.approverScope}
                    onChange={(e) =>
                      onChange(row, {
                        approverScope: e.target.value as ApprovalMatrixRow['approverScope'],
                      })
                    }
                    disabled={busy}
                  >
                    {MATRIX_SCOPES.map((scope) => (
                      <option key={scope} value={scope}>
                        {t(MATRIX_SCOPE_LABEL_KEYS[scope])}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    className="form-select form-select-sm"
                    value={row.approverRoleId ?? ''}
                    onChange={(e) =>
                      onChange(row, {
                        approverRoleId: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                    disabled={busy}
                  >
                    <option value="">{t('common.emptyValue')}</option>
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="number"
                    className="form-control form-control-sm"
                    value={row.approverUserId ?? ''}
                    onChange={(e) =>
                      onChange(row, {
                        approverUserId: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                    disabled={busy}
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    className="form-check-input"
                    checked={row.autoApproveForOwner}
                    onChange={(e) =>
                      onChange(row, { autoApproveForOwner: e.target.checked })
                    }
                    disabled={busy}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ApprovalMatrixTab;
