/**
 * SecuritySection — Hierarchy settings tab for the Settings page.
 *
 * Shows default scheduling constraints for each role in the hospital hierarchy.
 * Users with the system.hierarchy.manage permission can edit subordinate roles;
 * everyone can view their own role.
 *
 * @author Luca Ostinelli
 */

import React from 'react';

interface DefaultSettings {
  maxHoursPerWeek: number;
  maxConsecutiveDays: number;
  minRestHours: number;
  preferredShifts: string[];
  notifications: {
    scheduleChanges: boolean;
    shiftReminders: boolean;
    overtimeAlerts: boolean;
  };
}

export interface HospitalHierarchy {
  level: number;
  role: string;
  permissions: string[];
  canManageRoles: string[];
  defaultSettings: DefaultSettings;
}

interface Props {
  hierarchySettings: Record<string, HospitalHierarchy>;
  currentUserRole: string | undefined;
  canManageAll: boolean;
  onUpdateDefault: (roleKey: string, patch: Partial<DefaultSettings>) => void;
}

const SecuritySection: React.FC<Props> = ({
  hierarchySettings,
  currentUserRole,
  canManageAll,
  onUpdateDefault,
}) => {
  const canManageRole = (targetRole: string): boolean => {
    if (canManageAll) return true;
    const userRoleKey = currentUserRole?.toLowerCase().replace(' ', '-');
    const userHierarchy = userRoleKey ? hierarchySettings[userRoleKey] : undefined;
    return userHierarchy?.canManageRoles.includes(targetRole) ?? false;
  };

  return (
    <div className="row">
      <div className="col-12">
        <div className="card">
          <div className="card-header">
            <h5 className="mb-0">Hospital Hierarchy Settings</h5>
            <small className="text-muted">
              Configure default settings for each role level. Higher roles can modify settings for
              subordinates.
            </small>
          </div>
          <div className="card-body">
            <div className="row">
              {Object.entries(hierarchySettings)
                .sort(([, a], [, b]) => a.level - b.level)
                .map(([roleKey, hierarchy]) => {
                  const canManage = canManageRole(roleKey);
                  const isOwnRole =
                    currentUserRole?.toLowerCase().replace(' ', '-') === roleKey;

                  return (
                    <div key={roleKey} className="col-lg-6 mb-4">
                      <div className={`card ${!canManage && !isOwnRole ? 'bg-body-tertiary' : ''}`}>
                        <div className="card-header d-flex justify-content-between align-items-center">
                          <div>
                            <h6 className="mb-0">{hierarchy.role}</h6>
                            <small className="text-muted">Level {hierarchy.level}</small>
                          </div>
                          {isOwnRole && (
                            <span className="badge bg-primary">Your Role</span>
                          )}
                          {!canManage && !isOwnRole && (
                            <span className="badge bg-secondary">View Only</span>
                          )}
                        </div>
                        <div className="card-body">
                          <div className="mb-3">
                            <strong>Permissions:</strong>
                            <div className="mt-1">
                              {hierarchy.permissions.map((perm) => (
                                <span key={perm} className="badge bg-info me-1 mb-1">
                                  {perm.replace('-', ' ')}
                                </span>
                              ))}
                            </div>
                          </div>

                          {hierarchy.canManageRoles.length > 0 && (
                            <div className="mb-3">
                              <strong>Can Manage:</strong>
                              <div className="mt-1">
                                {hierarchy.canManageRoles.map((role) => (
                                  <span key={role} className="badge bg-warning me-1 mb-1">
                                    {role.replace('-', ' ')}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          <div className="mb-3">
                            <strong>Default Settings:</strong>
                            <div className="row g-2 mt-1">
                              <div className="col-6">
                                <label className="form-label text-sm">Max Hours/Week</label>
                                <input
                                  type="number"
                                  className="form-control form-control-sm"
                                  value={hierarchy.defaultSettings.maxHoursPerWeek}
                                  disabled={!canManage && !isOwnRole}
                                  onChange={(e) =>
                                    canManage &&
                                    onUpdateDefault(roleKey, {
                                      maxHoursPerWeek: parseInt(e.target.value),
                                    })
                                  }
                                />
                              </div>
                              <div className="col-6">
                                <label className="form-label text-sm">Max Consecutive Days</label>
                                <input
                                  type="number"
                                  className="form-control form-control-sm"
                                  value={hierarchy.defaultSettings.maxConsecutiveDays}
                                  disabled={!canManage && !isOwnRole}
                                  onChange={(e) =>
                                    canManage &&
                                    onUpdateDefault(roleKey, {
                                      maxConsecutiveDays: parseInt(e.target.value),
                                    })
                                  }
                                />
                              </div>
                              <div className="col-6">
                                <label className="form-label text-sm">Min Rest Hours</label>
                                <input
                                  type="number"
                                  className="form-control form-control-sm"
                                  value={hierarchy.defaultSettings.minRestHours}
                                  disabled={!canManage && !isOwnRole}
                                  onChange={(e) =>
                                    canManage &&
                                    onUpdateDefault(roleKey, {
                                      minRestHours: parseInt(e.target.value),
                                    })
                                  }
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SecuritySection;
