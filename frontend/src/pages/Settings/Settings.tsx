/**
 * Settings Page Component for Staff Scheduler
 * 
 * Comprehensive system settings interface providing configuration
 * options for application behavior, user preferences, and system administration.
 * 
 * Features:
 * - User profile and account management
 * - Application preferences and themes
 * - Notification settings and preferences
 * - System configuration for administrators
 * - Security settings and password management
 * - Integration settings and API configuration
 * - Backup and data management options
 * 
 * @author Luca Ostinelli
 */

import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';

interface HospitalHierarchy {
  level: number;
  role: string;
  permissions: string[];
  canManageRoles: string[];
  defaultSettings: {
    maxHoursPerWeek: number;
    maxConsecutiveDays: number;
    minRestHours: number;
    preferredShifts: string[];
    notifications: {
      scheduleChanges: boolean;
      shiftReminders: boolean;
      overtimeAlerts: boolean;
    };
  };
}

interface UserSettings {
  personalSettings: {
    theme: 'light' | 'dark' | 'auto';
    language: 'it' | 'en';
    timezone: string;
    notifications: {
      email: boolean;
      push: boolean;
      sms: boolean;
    };
  };
  workSettings: {
    maxHoursPerWeek: number;
    maxConsecutiveDays: number;
    minRestHours: number;
    preferredShifts: string[];
    availabilitySettings: {
      unavailableDates: string[];
      preferredDepartments: string[];
    };
  };
}

/**
 * Settings page component for system configuration and user preferences
 * @returns JSX element containing the settings and configuration interface
 */
const Settings: React.FC = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'personal' | 'work' | 'hierarchy' | 'system'>('personal');
  const [settings, setSettings] = useState<UserSettings>({
    personalSettings: {
      theme: 'light',
      language: 'it',
      timezone: 'Europe/Rome',
      notifications: {
        email: true,
        push: true,
        sms: false
      }
    },
    workSettings: {
      maxHoursPerWeek: 40,
      maxConsecutiveDays: 5,
      minRestHours: 11,
      preferredShifts: [],
      availabilitySettings: {
        unavailableDates: [],
        preferredDepartments: []
      }
    }
  });

  const [hierarchySettings, setHierarchySettings] = useState<Record<string, HospitalHierarchy>>({
    'direttore-generale': {
      level: 1,
      role: 'Direttore Generale',
      permissions: ['manage-all', 'system-admin', 'reports', 'budget'],
      canManageRoles: ['direttore-sanitario', 'primario', 'caposala', 'medico', 'infermiere', 'oss'],
      defaultSettings: {
        maxHoursPerWeek: 40,
        maxConsecutiveDays: 5,
        minRestHours: 11,
        preferredShifts: [],
        notifications: {
          scheduleChanges: true,
          shiftReminders: true,
          overtimeAlerts: true
        }
      }
    },
    'direttore-sanitario': {
      level: 2,
      role: 'Direttore Sanitario',
      permissions: ['manage-medical', 'quality-control', 'protocols'],
      canManageRoles: ['primario', 'caposala', 'medico', 'infermiere'],
      defaultSettings: {
        maxHoursPerWeek: 40,
        maxConsecutiveDays: 5,
        minRestHours: 11,
        preferredShifts: [],
        notifications: {
          scheduleChanges: true,
          shiftReminders: true,
          overtimeAlerts: true
        }
      }
    },
    'primario': {
      level: 3,
      role: 'Primario',
      permissions: ['manage-department', 'schedule-department', 'evaluate-staff'],
      canManageRoles: ['caposala', 'medico-strutturato', 'medico-specializzando'],
      defaultSettings: {
        maxHoursPerWeek: 48,
        maxConsecutiveDays: 6,
        minRestHours: 11,
        preferredShifts: ['day-shift'],
        notifications: {
          scheduleChanges: true,
          shiftReminders: true,
          overtimeAlerts: true
        }
      }
    },
    'caposala': {
      level: 4,
      role: 'Caposala',
      permissions: ['manage-nursing', 'schedule-nurses', 'quality-nursing'],
      canManageRoles: ['infermiere-coordinatore', 'infermiere', 'oss'],
      defaultSettings: {
        maxHoursPerWeek: 36,
        maxConsecutiveDays: 5,
        minRestHours: 11,
        preferredShifts: ['day-shift', 'afternoon-shift'],
        notifications: {
          scheduleChanges: true,
          shiftReminders: true,
          overtimeAlerts: true
        }
      }
    },
    'medico-strutturato': {
      level: 5,
      role: 'Medico Strutturato',
      permissions: ['patient-care', 'procedures', 'consultation'],
      canManageRoles: ['medico-specializzando'],
      defaultSettings: {
        maxHoursPerWeek: 38,
        maxConsecutiveDays: 5,
        minRestHours: 11,
        preferredShifts: ['day-shift'],
        notifications: {
          scheduleChanges: true,
          shiftReminders: true,
          overtimeAlerts: false
        }
      }
    },
    'infermiere-coordinatore': {
      level: 6,
      role: 'Infermiere Coordinatore',
      permissions: ['coordinate-nursing', 'patient-care', 'training'],
      canManageRoles: ['infermiere', 'oss'],
      defaultSettings: {
        maxHoursPerWeek: 36,
        maxConsecutiveDays: 4,
        minRestHours: 11,
        preferredShifts: ['day-shift', 'afternoon-shift'],
        notifications: {
          scheduleChanges: true,
          shiftReminders: true,
          overtimeAlerts: true
        }
      }
    },
    'infermiere': {
      level: 7,
      role: 'Infermiere',
      permissions: ['patient-care', 'medication', 'documentation'],
      canManageRoles: [],
      defaultSettings: {
        maxHoursPerWeek: 36,
        maxConsecutiveDays: 4,
        minRestHours: 11,
        preferredShifts: ['day-shift', 'afternoon-shift', 'night-shift'],
        notifications: {
          scheduleChanges: true,
          shiftReminders: true,
          overtimeAlerts: false
        }
      }
    },
    'oss': {
      level: 8,
      role: 'OSS (Operatore Socio Sanitario)',
      permissions: ['basic-care', 'assistance', 'hygiene'],
      canManageRoles: [],
      defaultSettings: {
        maxHoursPerWeek: 36,
        maxConsecutiveDays: 5,
        minRestHours: 11,
        preferredShifts: ['day-shift', 'afternoon-shift'],
        notifications: {
          scheduleChanges: true,
          shiftReminders: true,
          overtimeAlerts: false
        }
      }
    }
  });

  const [isSaving, setIsSaving] = useState(false);

  const handleSavePersonalSettings = async () => {
    setIsSaving(true);
    try {
      // Here you would call the API to save personal settings
      await new Promise(resolve => setTimeout(resolve, 1000));
      alert('Personal settings saved successfully!');
    } catch (err) {
      console.error('Save error:', err);
      alert('Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveWorkSettings = async () => {
    setIsSaving(true);
    try {
      // Here you would call the API to save work settings
      await new Promise(resolve => setTimeout(resolve, 1000));
      alert('Work settings saved successfully!');
    } catch (err) {
      console.error('Save error:', err);
      alert('Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateHierarchyDefault = async (roleKey: string, newDefaults: Partial<HospitalHierarchy['defaultSettings']>) => {
    setIsSaving(true);
    try {
      setHierarchySettings(prev => ({
        ...prev,
        [roleKey]: {
          ...prev[roleKey],
          defaultSettings: {
            ...prev[roleKey].defaultSettings,
            ...newDefaults
          }
        }
      }));
      
      // Here you would call the API to update hierarchy settings
      await new Promise(resolve => setTimeout(resolve, 500));
      alert(`Default settings updated for ${hierarchySettings[roleKey].role}`);
    } catch (err) {
      console.error('Update error:', err);
      alert('Failed to update hierarchy settings');
    } finally {
      setIsSaving(false);
    }
  };

  const getUserHierarchyLevel = () => {
    if (!user) return 999;
    const roleKey = user.role?.toLowerCase().replace(' ', '-');
    return hierarchySettings[roleKey]?.level || 999;
  };

  const canManageRole = (targetRole: string) => {
    if (!user) return false;
    const userRoleKey = user.role?.toLowerCase().replace(' ', '-');
    const userHierarchy = hierarchySettings[userRoleKey];
    return userHierarchy?.canManageRoles.includes(targetRole) || false;
  };

  const getManageableRoles = () => {
    if (!user) return [];
    const userRoleKey = user.role?.toLowerCase().replace(' ', '-');
    const userHierarchy = hierarchySettings[userRoleKey];
    return userHierarchy?.canManageRoles || [];
  };

  return (
    <div className="container-fluid py-4">
      {/* Header */}
      <div className="row mb-4">
        <div className="col">
          <h1 className="h3 mb-0">Settings</h1>
          <p className="text-muted mb-0">
            Configure your preferences and manage hospital settings
          </p>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="row mb-4">
        <div className="col">
          <ul className="nav nav-tabs">
            <li className="nav-item">
              <button 
                className={`nav-link ${activeTab === 'personal' ? 'active' : ''}`}
                onClick={() => setActiveTab('personal')}
              >
                <i className="bi bi-person me-2"></i>Personal
              </button>
            </li>
            <li className="nav-item">
              <button 
                className={`nav-link ${activeTab === 'work' ? 'active' : ''}`}
                onClick={() => setActiveTab('work')}
              >
                <i className="bi bi-briefcase me-2"></i>Work Preferences
              </button>
            </li>
            <li className="nav-item">
              <button 
                className={`nav-link ${activeTab === 'hierarchy' ? 'active' : ''}`}
                onClick={() => setActiveTab('hierarchy')}
              >
                <i className="bi bi-diagram-3 me-2"></i>Hierarchy Settings
              </button>
            </li>
            {user?.role === 'admin' && (
              <li className="nav-item">
                <button 
                  className={`nav-link ${activeTab === 'system' ? 'active' : ''}`}
                  onClick={() => setActiveTab('system')}
                >
                  <i className="bi bi-gear me-2"></i>System
                </button>
              </li>
            )}
          </ul>
        </div>
      </div>

      {/* Personal Settings Tab */}
      {activeTab === 'personal' && (
        <div className="row">
          <div className="col-lg-8">
            <div className="card">
              <div className="card-header">
                <h5 className="mb-0">Personal Preferences</h5>
              </div>
              <div className="card-body">
                <form onSubmit={(e) => { e.preventDefault(); handleSavePersonalSettings(); }}>
                  <div className="row">
                    <div className="col-md-6 mb-3">
                      <label htmlFor="theme" className="form-label">Theme</label>
                      <select
                        className="form-select"
                        id="theme"
                        value={settings.personalSettings.theme}
                        onChange={(e) => setSettings(prev => ({
                          ...prev,
                          personalSettings: {
                            ...prev.personalSettings,
                            theme: e.target.value as 'light' | 'dark' | 'auto'
                          }
                        }))}
                      >
                        <option value="light">Light</option>
                        <option value="dark">Dark</option>
                        <option value="auto">Auto (System)</option>
                      </select>
                    </div>
                    <div className="col-md-6 mb-3">
                      <label htmlFor="language" className="form-label">Language</label>
                      <select
                        className="form-select"
                        id="language"
                        value={settings.personalSettings.language}
                        onChange={(e) => setSettings(prev => ({
                          ...prev,
                          personalSettings: {
                            ...prev.personalSettings,
                            language: e.target.value as 'it' | 'en'
                          }
                        }))}
                      >
                        <option value="it">Italiano</option>
                        <option value="en">English</option>
                      </select>
                    </div>
                  </div>

                  <div className="mb-3">
                    <label htmlFor="timezone" className="form-label">Timezone</label>
                    <select
                      className="form-select"
                      id="timezone"
                      value={settings.personalSettings.timezone}
                      onChange={(e) => setSettings(prev => ({
                        ...prev,
                        personalSettings: {
                          ...prev.personalSettings,
                          timezone: e.target.value
                        }
                      }))}
                    >
                      <option value="Europe/Rome">Europe/Rome (GMT+1)</option>
                      <option value="UTC">UTC (GMT+0)</option>
                      <option value="Europe/London">Europe/London (GMT+0)</option>
                    </select>
                  </div>

                  <h6 className="mb-3">Notification Preferences</h6>
                  <div className="row">
                    <div className="col-md-4">
                      <div className="form-check">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          id="emailNotifications"
                          checked={settings.personalSettings.notifications.email}
                          onChange={(e) => setSettings(prev => ({
                            ...prev,
                            personalSettings: {
                              ...prev.personalSettings,
                              notifications: {
                                ...prev.personalSettings.notifications,
                                email: e.target.checked
                              }
                            }
                          }))}
                        />
                        <label className="form-check-label" htmlFor="emailNotifications">
                          Email Notifications
                        </label>
                      </div>
                    </div>
                    <div className="col-md-4">
                      <div className="form-check">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          id="pushNotifications"
                          checked={settings.personalSettings.notifications.push}
                          onChange={(e) => setSettings(prev => ({
                            ...prev,
                            personalSettings: {
                              ...prev.personalSettings,
                              notifications: {
                                ...prev.personalSettings.notifications,
                                push: e.target.checked
                              }
                            }
                          }))}
                        />
                        <label className="form-check-label" htmlFor="pushNotifications">
                          Push Notifications
                        </label>
                      </div>
                    </div>
                    <div className="col-md-4">
                      <div className="form-check">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          id="smsNotifications"
                          checked={settings.personalSettings.notifications.sms}
                          onChange={(e) => setSettings(prev => ({
                            ...prev,
                            personalSettings: {
                              ...prev.personalSettings,
                              notifications: {
                                ...prev.personalSettings.notifications,
                                sms: e.target.checked
                              }
                            }
                          }))}
                        />
                        <label className="form-check-label" htmlFor="smsNotifications">
                          SMS Notifications
                        </label>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4">
                    <button type="submit" className="btn btn-primary" disabled={isSaving}>
                      {isSaving ? (
                        <>
                          <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                          Saving...
                        </>
                      ) : (
                        <>
                          <i className="bi bi-check me-2"></i>
                          Save Personal Settings
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Work Preferences Tab */}
      {activeTab === 'work' && (
        <div className="row">
          <div className="col-lg-8">
            <div className="card">
              <div className="card-header">
                <h5 className="mb-0">Work Preferences</h5>
              </div>
              <div className="card-body">
                <form onSubmit={(e) => { e.preventDefault(); handleSaveWorkSettings(); }}>
                  <h6 className="mb-3">Schedule Constraints</h6>
                  <div className="row">
                    <div className="col-md-4 mb-3">
                      <label htmlFor="maxHoursPerWeek" className="form-label">Max Hours Per Week</label>
                      <input
                        type="number"
                        min="20"
                        max="60"
                        className="form-control"
                        id="maxHoursPerWeek"
                        value={settings.workSettings.maxHoursPerWeek}
                        onChange={(e) => setSettings(prev => ({
                          ...prev,
                          workSettings: {
                            ...prev.workSettings,
                            maxHoursPerWeek: parseInt(e.target.value)
                          }
                        }))}
                      />
                    </div>
                    <div className="col-md-4 mb-3">
                      <label htmlFor="maxConsecutiveDays" className="form-label">Max Consecutive Days</label>
                      <input
                        type="number"
                        min="1"
                        max="14"
                        className="form-control"
                        id="maxConsecutiveDays"
                        value={settings.workSettings.maxConsecutiveDays}
                        onChange={(e) => setSettings(prev => ({
                          ...prev,
                          workSettings: {
                            ...prev.workSettings,
                            maxConsecutiveDays: parseInt(e.target.value)
                          }
                        }))}
                      />
                    </div>
                    <div className="col-md-4 mb-3">
                      <label htmlFor="minRestHours" className="form-label">Min Rest Hours</label>
                      <input
                        type="number"
                        min="8"
                        max="48"
                        className="form-control"
                        id="minRestHours"
                        value={settings.workSettings.minRestHours}
                        onChange={(e) => setSettings(prev => ({
                          ...prev,
                          workSettings: {
                            ...prev.workSettings,
                            minRestHours: parseInt(e.target.value)
                          }
                        }))}
                      />
                    </div>
                  </div>

                  <h6 className="mb-3">Preferred Shifts</h6>
                  <div className="row">
                    <div className="col-md-4">
                      <div className="form-check">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          id="dayShift"
                          checked={settings.workSettings.preferredShifts.includes('day-shift')}
                          onChange={(e) => {
                            const shift = 'day-shift';
                            setSettings(prev => ({
                              ...prev,
                              workSettings: {
                                ...prev.workSettings,
                                preferredShifts: e.target.checked 
                                  ? [...prev.workSettings.preferredShifts, shift]
                                  : prev.workSettings.preferredShifts.filter(s => s !== shift)
                              }
                            }));
                          }}
                        />
                        <label className="form-check-label" htmlFor="dayShift">
                          Day Shift (06:00-14:00)
                        </label>
                      </div>
                    </div>
                    <div className="col-md-4">
                      <div className="form-check">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          id="afternoonShift"
                          checked={settings.workSettings.preferredShifts.includes('afternoon-shift')}
                          onChange={(e) => {
                            const shift = 'afternoon-shift';
                            setSettings(prev => ({
                              ...prev,
                              workSettings: {
                                ...prev.workSettings,
                                preferredShifts: e.target.checked 
                                  ? [...prev.workSettings.preferredShifts, shift]
                                  : prev.workSettings.preferredShifts.filter(s => s !== shift)
                              }
                            }));
                          }}
                        />
                        <label className="form-check-label" htmlFor="afternoonShift">
                          Afternoon Shift (14:00-22:00)
                        </label>
                      </div>
                    </div>
                    <div className="col-md-4">
                      <div className="form-check">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          id="nightShift"
                          checked={settings.workSettings.preferredShifts.includes('night-shift')}
                          onChange={(e) => {
                            const shift = 'night-shift';
                            setSettings(prev => ({
                              ...prev,
                              workSettings: {
                                ...prev.workSettings,
                                preferredShifts: e.target.checked 
                                  ? [...prev.workSettings.preferredShifts, shift]
                                  : prev.workSettings.preferredShifts.filter(s => s !== shift)
                              }
                            }));
                          }}
                        />
                        <label className="form-check-label" htmlFor="nightShift">
                          Night Shift (22:00-06:00)
                        </label>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4">
                    <button type="submit" className="btn btn-primary" disabled={isSaving}>
                      {isSaving ? (
                        <>
                          <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                          Saving...
                        </>
                      ) : (
                        <>
                          <i className="bi bi-check me-2"></i>
                          Save Work Settings
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Hierarchy Settings Tab */}
      {activeTab === 'hierarchy' && (
        <div className="row">
          <div className="col-12">
            <div className="card">
              <div className="card-header">
                <h5 className="mb-0">Hospital Hierarchy Settings</h5>
                <small className="text-muted">
                  Configure default settings for each role level. Higher roles can modify settings for subordinates.
                </small>
              </div>
              <div className="card-body">
                <div className="row">
                  {Object.entries(hierarchySettings)
                    .sort(([,a], [,b]) => a.level - b.level)
                    .map(([roleKey, hierarchy]) => {
                      const canManage = canManageRole(roleKey) || user?.role === 'admin';
                      const isOwnRole = user?.role?.toLowerCase().replace(' ', '-') === roleKey;
                      
                      return (
                        <div key={roleKey} className="col-lg-6 mb-4">
                          <div className={`card ${!canManage && !isOwnRole ? 'bg-light' : ''}`}>
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
                                  {hierarchy.permissions.map(perm => (
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
                                    {hierarchy.canManageRoles.map(role => (
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
                                      onChange={(e) => canManage && handleUpdateHierarchyDefault(roleKey, {
                                        maxHoursPerWeek: parseInt(e.target.value)
                                      })}
                                    />
                                  </div>
                                  <div className="col-6">
                                    <label className="form-label text-sm">Max Consecutive Days</label>
                                    <input
                                      type="number"
                                      className="form-control form-control-sm"
                                      value={hierarchy.defaultSettings.maxConsecutiveDays}
                                      disabled={!canManage && !isOwnRole}
                                      onChange={(e) => canManage && handleUpdateHierarchyDefault(roleKey, {
                                        maxConsecutiveDays: parseInt(e.target.value)
                                      })}
                                    />
                                  </div>
                                  <div className="col-6">
                                    <label className="form-label text-sm">Min Rest Hours</label>
                                    <input
                                      type="number"
                                      className="form-control form-control-sm"
                                      value={hierarchy.defaultSettings.minRestHours}
                                      disabled={!canManage && !isOwnRole}
                                      onChange={(e) => canManage && handleUpdateHierarchyDefault(roleKey, {
                                        minRestHours: parseInt(e.target.value)
                                      })}
                                    />
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  }
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* System Settings Tab (Admin only) */}
      {activeTab === 'system' && user?.role === 'admin' && (
        <div className="row">
          <div className="col-lg-8">
            <div className="card">
              <div className="card-header">
                <h5 className="mb-0">System Configuration</h5>
              </div>
              <div className="card-body">
                <div className="alert alert-info">
                  <i className="bi bi-info-circle me-2"></i>
                  System-wide settings that affect all users. Changes here require system restart.
                </div>
                
                <h6 className="mb-3">Database Settings</h6>
                <div className="row">
                  <div className="col-md-6 mb-3">
                    <label className="form-label">Backup Frequency</label>
                    <select className="form-select">
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </div>
                  <div className="col-md-6 mb-3">
                    <label className="form-label">Log Retention (days)</label>
                    <input type="number" className="form-control" defaultValue={30} />
                  </div>
                </div>

                <h6 className="mb-3">Security Settings</h6>
                <div className="row">
                  <div className="col-md-6 mb-3">
                    <label className="form-label">Session Timeout (hours)</label>
                    <input type="number" className="form-control" defaultValue={8} />
                  </div>
                  <div className="col-md-6 mb-3">
                    <label className="form-label">Password Complexity</label>
                    <select className="form-select">
                      <option value="basic">Basic</option>
                      <option value="standard">Standard</option>
                      <option value="high">High Security</option>
                    </select>
                  </div>
                </div>

                <div className="mt-4">
                  <button type="button" className="btn btn-primary me-2">
                    <i className="bi bi-check me-2"></i>
                    Save System Settings
                  </button>
                  <button type="button" className="btn btn-outline-secondary">
                    <i className="bi bi-arrow-clockwise me-2"></i>
                    Reset to Defaults
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Settings;
