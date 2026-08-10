/**
 * "Who decides about me?" — one screen, four answers.
 *
 * WHY THIS PAGE EXISTS. The authority model was complete and correctly enforced,
 * and completely invisible. There was no way to learn who would approve your
 * time off except to file it and watch where it went — and no way at all to learn
 * that nobody would, which is the case that matters. Every fact here already
 * existed inside the server; none of it was reachable by the person it applied
 * to.
 *
 * WHY IT OPENS ON YOURSELF. The question is asked in the first person far more
 * often than the third, and it is the form that needs no permission. Looking
 * someone else up is a second step behind `org_unit.read`, which is also where
 * the server draws the line.
 *
 * WHY AN UNRESOLVED STEP IS THE LOUDEST THING ON THE PAGE. A workflow step whose
 * approver resolves to nobody means requests of that kind cannot be decided at
 * all — an org unit with no manager, or a responsibility rule pointing at an
 * empty unit. It is a configuration fault, it is silent everywhere else, and this
 * is the only screen that can show it. Rendering it as a plain empty row would
 * bury the single most useful thing here.
 *
 * WHY THE SCOPE IS SHOWN NEXT TO EVERY NAME. "Anna decides this" is less useful
 * than "Anna decides this because she manages your unit": the first invites the
 * question the second answers, and when the answer is wrong the scope is what
 * tells you which rule to go and fix.
 *
 * @author Luca Ostinelli
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import QueryState from '../../components/QueryState';
import { useAuthorityQuery } from '../../hooks/useOrg';
import type { AuthorityPerson } from '../../services/orgService';

const fullName = (p: AuthorityPerson) => `${p.firstName} ${p.lastName}`;

/** A change type as a person would say it: `time_off` → "Time off". */
const changeTypeLabel = (changeType: string): string => {
  const words = changeType.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const Authority: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  // The same gate the server applies to another person's profile; the check here
  // only decides whether to offer the field, never whether the answer is given.
  const canLookUpOthers = (user?.permissions ?? []).includes('org_unit.read');

  /** How an approver was chosen, in words rather than in the enum's spelling. */
  const SCOPE_LABEL_KEYS: Record<string, string> = {
    unit_manager: 'authority.scope.unitManager',
    unit_manager_chain: 'authority.scope.unitManagerChain',
    policy_owner: 'authority.scope.policyOwner',
    company_role: 'authority.scope.companyRole',
    company_user: 'authority.scope.companyUser',
    responsibility_rule: 'authority.scope.responsibilityRule',
  };

  const scopeLabel = (scope: string, permissionCode: string | null): string => {
    const base = SCOPE_LABEL_KEYS[scope] ? t(SCOPE_LABEL_KEYS[scope]) : scope;
    return scope === 'responsibility_rule' && permissionCode
      ? t('authority.scopeWithPermission', { base, code: permissionCode })
      : base;
  };

  // null means "mine", which is a real value here rather than "not chosen yet".
  const [subjectId, setSubjectId] = useState<number | null>(null);
  const [lookup, setLookup] = useState('');

  const query = useAuthorityQuery(subjectId);
  const profile = query.data ?? null;

  const isSelf = subjectId === null || subjectId === user?.id;

  return (
    <div className="container-fluid py-3">
      <div className="d-flex justify-content-between align-items-start mb-3 flex-wrap gap-3">
        <div>
          <h1 className="h4 mb-0">{t('authority.title')}</h1>
          <p className="text-muted mb-0 small">
            {t('authority.subtitle')}
          </p>
        </div>

        {canLookUpOthers && (
          <form
            className="d-flex align-items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const parsed = Number(lookup);
              setSubjectId(Number.isInteger(parsed) && parsed > 0 ? parsed : null);
            }}
          >
            <div>
              <label className="form-label small mb-1" htmlFor="authority-lookup">
                {t('authority.lookupLabel')}
              </label>
              <input
                id="authority-lookup"
                className="form-control form-control-sm"
                value={lookup}
                onChange={(e) => setLookup(e.target.value)}
                inputMode="numeric"
              />
            </div>
            <button type="submit" className="btn btn-outline-secondary btn-sm">
              {t('authority.show')}
            </button>
            {!isSelf && (
              <button
                type="button"
                className="btn btn-link btn-sm"
                onClick={() => {
                  setSubjectId(null);
                  setLookup('');
                }}
              >
                {t('authority.backToMe')}
              </button>
            )}
          </form>
        )}
      </div>

      <QueryState
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={query.refetch}
        loadingMessage={t('authority.loadingProfile')}
      >
        {profile && (
          <>
            {!isSelf && (
              <div className="alert alert-info py-2" role="note">
                {t('authority.showingPrefix')} <strong>{fullName(profile.subject)}</strong> ({profile.subject.email}).
              </div>
            )}

            <div className="row g-4">
              <div className="col-lg-6">
                <div className="card h-100">
                  <div className="card-header">{t('authority.dependsOn.title')}</div>
                  <div className="card-body">
                    {profile.managerChain.length === 0 ? (
                      // Not a cosmetic emptiness: with no unit there is no
                      // manager, and several approval scopes resolve through one.
                      <p className="text-muted mb-0">
                        {t('authority.dependsOn.noManagerChain')}
                      </p>
                    ) : (
                      <ol className="list-unstyled mb-0">
                        {profile.managerChain.map((link, index) => (
                          <li key={link.unitId} className="mb-2">
                            <div className="d-flex align-items-baseline gap-2">
                              <span className="badge bg-secondary">{index + 1}</span>
                              <div>
                                <div className="fw-semibold">
                                  {link.manager ? fullName(link.manager) : (
                                    <span className="text-danger">{t('authority.dependsOn.noManagerSet')}</span>
                                  )}
                                </div>
                                <div className="text-muted small">{link.unitName}</div>
                              </div>
                            </div>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                </div>
              </div>

              <div className="col-lg-6">
                <div className="card h-100">
                  <div className="card-header">{t('authority.roleAdmins.title')}</div>
                  <div className="card-body">
                    {profile.roleAdministrators.length === 0 ? (
                      <p className="text-muted mb-0">{t('authority.roleAdmins.nobody')}</p>
                    ) : (
                      <ul className="list-unstyled mb-0">
                        {profile.roleAdministrators.map((admin) => (
                          <li key={admin.id} className="mb-2">
                            <div className="fw-semibold">{fullName(admin)}</div>
                            <div className="text-muted small">
                              {admin.via === 'responsibility_rule'
                                ? t('authority.roleAdmins.viaRule')
                                : t('authority.roleAdmins.viaPermission')}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="card mt-4">
              <div className="card-header">{t('authority.decisions.title')}</div>
              <div className="card-body p-0">
                {profile.approvals.length === 0 ? (
                  <p className="text-muted m-3 mb-0">{t('authority.decisions.noWorkflows')}</p>
                ) : (
                  <div className="table-responsive">
                    <table className="table table-sm mb-0 align-middle">
                      <thead>
                        <tr>
                          <th scope="col">{t('authority.decisions.columns.request')}</th>
                          <th scope="col">{t('authority.decisions.columns.step')}</th>
                          <th scope="col">{t('authority.decisions.columns.decidedBy')}</th>
                          <th scope="col">{t('authority.decisions.columns.because')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {profile.approvals.flatMap((workflow) =>
                          workflow.steps.map((step, index) => (
                            <tr
                              key={`${workflow.changeType}-${step.stepOrder}`}
                              className={step.unresolved ? 'table-warning' : undefined}
                            >
                              <td>{index === 0 ? changeTypeLabel(workflow.changeType) : ''}</td>
                              <td>{step.stepOrder}</td>
                              <td>
                                {step.unresolved ? (
                                  <span className="text-danger fw-semibold">
                                    <i className="bi bi-exclamation-triangle me-1" aria-hidden="true"></i>
                                    {t('authority.decisions.nobody')}
                                  </span>
                                ) : (
                                  step.approvers.map((p) => fullName(p)).join(', ')
                                )}
                              </td>
                              <td className="text-muted small">
                                {scopeLabel(step.approverScope, step.permissionCode)}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              {profile.approvals.some((w) => w.steps.some((s) => s.unresolved)) && (
                <div className="card-footer small text-muted">
                  {t('authority.decisions.footerPrefix')} <strong>{t('authority.decisions.footerNobody')}</strong> {t('authority.decisions.footerSuffix')}
                </div>
              )}
            </div>
          </>
        )}
      </QueryState>
    </div>
  );
};

export default Authority;
