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
import { useAuth } from '../../contexts/AuthContext';
import QueryState from '../../components/QueryState';
import { useAuthorityQuery } from '../../hooks/useOrg';
import type { AuthorityPerson } from '../../services/orgService';

const fullName = (p: AuthorityPerson) => `${p.firstName} ${p.lastName}`;

/** How an approver was chosen, in words rather than in the enum's spelling. */
const SCOPE_LABEL: Record<string, string> = {
  unit_manager: 'manages your unit',
  unit_manager_chain: 'nearest manager above your unit',
  policy_owner: 'owns the policy in question',
  company_role: 'holds the required role',
  company_user: 'named directly on this step',
  responsibility_rule: 'made responsible by a rule',
};

const scopeLabel = (scope: string, permissionCode: string | null): string => {
  const base = SCOPE_LABEL[scope] ?? scope;
  return scope === 'responsibility_rule' && permissionCode ? `${base} (${permissionCode})` : base;
};

/** A change type as a person would say it: `time_off` → "Time off". */
const changeTypeLabel = (changeType: string): string => {
  const words = changeType.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const Authority: React.FC = () => {
  const { user } = useAuth();
  // The same gate the server applies to another person's profile; the check here
  // only decides whether to offer the field, never whether the answer is given.
  const canLookUpOthers = (user?.permissions ?? []).includes('org_unit.read');

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
          <h1 className="h4 mb-0">Authority</h1>
          <p className="text-muted mb-0 small">
            Who you depend on, who can change your role, and who decides your requests.
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
                Look up another person (employee ID)
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
              Show
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
                Back to me
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
        loadingMessage="Loading the authority profile…"
      >
        {profile && (
          <>
            {!isSelf && (
              <div className="alert alert-info py-2" role="note">
                Showing <strong>{fullName(profile.subject)}</strong> ({profile.subject.email}).
              </div>
            )}

            <div className="row g-4">
              <div className="col-lg-6">
                <div className="card h-100">
                  <div className="card-header">Who you depend on</div>
                  <div className="card-body">
                    {profile.managerChain.length === 0 ? (
                      // Not a cosmetic emptiness: with no unit there is no
                      // manager, and several approval scopes resolve through one.
                      <p className="text-muted mb-0">
                        No org-unit membership, so there is no manager chain — and any approval
                        routed through a unit manager has nobody to route to.
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
                                    <span className="text-danger">No manager set</span>
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
                  <div className="card-header">Who can change your role</div>
                  <div className="card-body">
                    {profile.roleAdministrators.length === 0 ? (
                      <p className="text-muted mb-0">Nobody — no responsibility rule and no permission holder.</p>
                    ) : (
                      <ul className="list-unstyled mb-0">
                        {profile.roleAdministrators.map((admin) => (
                          <li key={admin.id} className="mb-2">
                            <div className="fw-semibold">{fullName(admin)}</div>
                            <div className="text-muted small">
                              {admin.via === 'responsibility_rule'
                                ? 'made responsible for you by a rule'
                                : 'holds role.manage across the organization'}
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
              <div className="card-header">Who decides your requests</div>
              <div className="card-body p-0">
                {profile.approvals.length === 0 ? (
                  <p className="text-muted m-3 mb-0">No approval workflows are configured.</p>
                ) : (
                  <div className="table-responsive">
                    <table className="table table-sm mb-0 align-middle">
                      <thead>
                        <tr>
                          <th scope="col">Request</th>
                          <th scope="col">Step</th>
                          <th scope="col">Decided by</th>
                          <th scope="col">Because</th>
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
                                    Nobody
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
                  A step decided by <strong>nobody</strong> means requests of that kind cannot be
                  decided at all. Usually an org unit with no manager, or a responsibility rule
                  pointing at a unit with no members.
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
