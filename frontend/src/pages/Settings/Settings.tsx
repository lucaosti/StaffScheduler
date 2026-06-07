/**
 * Settings Page Component for Staff Scheduler
 *
 * Thin coordinator that composes the Settings tabs from sub-components.
 * The System tab is only shown to users with the system.settings permission.
 *
 * @author Luca Ostinelli
 */

import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import PreferencesSection from '../settings/PreferencesSection';
import ProfileSection from '../settings/ProfileSection';
import SecuritySection, { HospitalHierarchy } from '../settings/SecuritySection';
import SystemSection from '../settings/SystemSection';

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

const Settings: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.permissions?.includes('system.settings');

  const [activeTab, setActiveTab] = useState<'personal' | 'work' | 'hierarchy' | 'system'>(
    'personal'
  );

  const [settings, setSettings] = useState<UserSettings>({
    personalSettings: {
      theme: 'light',
      language: 'en',
      timezone: 'UTC',
      notifications: {
        email: true,
        push: true,
        sms: false,
      },
    },
    workSettings: {
      maxHoursPerWeek: 40,
      maxConsecutiveDays: 5,
      minRestHours: 11,
      preferredShifts: [],
      availabilitySettings: {
        unavailableDates: [],
        preferredDepartments: [],
      },
    },
  });

  const [hierarchySettings, setHierarchySettings] = useState<Record<string, HospitalHierarchy>>({
    'general-director': {
      level: 1,
      role: 'General Director',
      permissions: ['manage-all', 'system-admin', 'reports', 'budget'],
      canManageRoles: [
        'medical-director',
        'department-chief',
        'head-nurse',
        'senior-physician',
        'nurse',
        'healthcare-assistant',
      ],
      defaultSettings: {
        maxHoursPerWeek: 40,
        maxConsecutiveDays: 5,
        minRestHours: 11,
        preferredShifts: [],
        notifications: { scheduleChanges: true, shiftReminders: true, overtimeAlerts: true },
      },
    },
    'medical-director': {
      level: 2,
      role: 'Medical Director',
      permissions: ['manage-medical', 'quality-control', 'protocols'],
      canManageRoles: ['department-chief', 'head-nurse', 'senior-physician', 'nurse'],
      defaultSettings: {
        maxHoursPerWeek: 40,
        maxConsecutiveDays: 5,
        minRestHours: 11,
        preferredShifts: [],
        notifications: { scheduleChanges: true, shiftReminders: true, overtimeAlerts: true },
      },
    },
    'department-chief': {
      level: 3,
      role: 'Department Chief',
      permissions: ['manage-department', 'schedule-department', 'evaluate-staff'],
      canManageRoles: ['head-nurse', 'senior-physician', 'resident-physician'],
      defaultSettings: {
        maxHoursPerWeek: 48,
        maxConsecutiveDays: 6,
        minRestHours: 11,
        preferredShifts: ['day-shift'],
        notifications: { scheduleChanges: true, shiftReminders: true, overtimeAlerts: true },
      },
    },
    'head-nurse': {
      level: 4,
      role: 'Head Nurse',
      permissions: ['manage-nursing', 'schedule-nurses', 'quality-nursing'],
      canManageRoles: ['coordinating-nurse', 'nurse', 'healthcare-assistant'],
      defaultSettings: {
        maxHoursPerWeek: 36,
        maxConsecutiveDays: 5,
        minRestHours: 11,
        preferredShifts: ['day-shift', 'afternoon-shift'],
        notifications: { scheduleChanges: true, shiftReminders: true, overtimeAlerts: true },
      },
    },
    'senior-physician': {
      level: 5,
      role: 'Senior Physician',
      permissions: ['patient-care', 'procedures', 'consultation'],
      canManageRoles: ['resident-physician'],
      defaultSettings: {
        maxHoursPerWeek: 38,
        maxConsecutiveDays: 5,
        minRestHours: 11,
        preferredShifts: ['day-shift'],
        notifications: { scheduleChanges: true, shiftReminders: true, overtimeAlerts: false },
      },
    },
    'coordinating-nurse': {
      level: 6,
      role: 'Coordinating Nurse',
      permissions: ['coordinate-nursing', 'patient-care', 'training'],
      canManageRoles: ['nurse', 'healthcare-assistant'],
      defaultSettings: {
        maxHoursPerWeek: 36,
        maxConsecutiveDays: 4,
        minRestHours: 11,
        preferredShifts: ['day-shift', 'afternoon-shift'],
        notifications: { scheduleChanges: true, shiftReminders: true, overtimeAlerts: true },
      },
    },
    nurse: {
      level: 7,
      role: 'Nurse',
      permissions: ['patient-care', 'medication', 'documentation'],
      canManageRoles: [],
      defaultSettings: {
        maxHoursPerWeek: 36,
        maxConsecutiveDays: 4,
        minRestHours: 11,
        preferredShifts: ['day-shift', 'afternoon-shift', 'night-shift'],
        notifications: { scheduleChanges: true, shiftReminders: true, overtimeAlerts: false },
      },
    },
    'healthcare-assistant': {
      level: 8,
      role: 'Healthcare Assistant (OSS)',
      permissions: ['basic-care', 'assistance', 'hygiene'],
      canManageRoles: [],
      defaultSettings: {
        maxHoursPerWeek: 36,
        maxConsecutiveDays: 5,
        minRestHours: 11,
        preferredShifts: ['day-shift', 'afternoon-shift'],
        notifications: { scheduleChanges: true, shiftReminders: true, overtimeAlerts: false },
      },
    },
  });

  const handleUpdateHierarchyDefault = (
    roleKey: string,
    patch: Partial<HospitalHierarchy['defaultSettings']>
  ) => {
    setHierarchySettings((prev) => ({
      ...prev,
      [roleKey]: {
        ...prev[roleKey],
        defaultSettings: { ...prev[roleKey].defaultSettings, ...patch },
      },
    }));
    // Hierarchy settings persistence is not yet implemented.
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

      {/* TODO(settings-persist): wire save handlers to the preferences backend. */}
      <div className="alert alert-warning d-flex align-items-center" role="status">
        <i className="bi bi-exclamation-triangle me-2" aria-hidden="true"></i>
        <div>
          <strong>Saving settings is not yet wired to the backend.</strong> Changes you make on
          this page will not persist across reloads. Save buttons are disabled until the settings
          API is available.
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
            {isAdmin && (
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

      {activeTab === 'personal' && (
        <PreferencesSection
          settings={settings.personalSettings}
          onChange={(updated) =>
            setSettings((prev) => ({ ...prev, personalSettings: updated }))
          }
          onSave={() => {
            // Settings persistence is not yet implemented.
          }}
        />
      )}

      {activeTab === 'work' && (
        <ProfileSection
          settings={settings.workSettings}
          onChange={(updated) =>
            setSettings((prev) => ({ ...prev, workSettings: updated }))
          }
          onSave={() => {
            // Settings persistence is not yet implemented.
          }}
        />
      )}

      {activeTab === 'hierarchy' && (
        <SecuritySection
          hierarchySettings={hierarchySettings}
          currentUserRole={user?.role}
          canManageAll={!!isAdmin}
          onUpdateDefault={handleUpdateHierarchyDefault}
        />
      )}

      {activeTab === 'system' && isAdmin && <SystemSection />}
    </div>
  );
};

export default Settings;
