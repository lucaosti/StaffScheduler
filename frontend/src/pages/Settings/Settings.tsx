/**
 * Settings Page Component for Staff Scheduler
 *
 * Thin coordinator that composes the Settings tabs from sub-components.
 * The System tab is only shown to users with the settings.manage permission.
 *
 * @author Luca Ostinelli
 */

import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import PreferencesSection from '../Settings/PreferencesSection';
import ProfileSection from '../Settings/ProfileSection';
import SystemSection from '../Settings/SystemSection';
import ModulesSection from '../Settings/ModulesSection';
import CalendarSection from '../Settings/CalendarSection';
import FieldPolicySection from '../Settings/FieldPolicySection';
import TwoFactorSection from '../Settings/TwoFactorSection';
import GeofenceSection from '../Settings/GeofenceSection';
import KioskDevicesSection from '../Settings/KioskDevicesSection';
import { updateMyPreferences } from '../../services/preferencesService';
import { useMyPreferencesQuery } from '../../hooks/usePreferences';

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
  const isAdmin = user?.permissions?.includes('settings.manage');

  const [activeTab, setActiveTab] = useState<'personal' | 'work' | 'calendar' | 'security' | 'system' | 'modules' | 'fields' | 'geofences' | 'kiosks'>('personal');

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

  // Saved preferences are fetched via TanStack Query (cached/deduped); hydrate
  // the editable work-settings state once they resolve. Failure is non-fatal —
  // the query yields null and the defaults above stand.
  const { data: savedPreferences } = useMyPreferencesQuery();
  useEffect(() => {
    if (!savedPreferences) return;
    setSettings((prev) => ({
      ...prev,
      workSettings: {
        ...prev.workSettings,
        maxHoursPerWeek: savedPreferences.maxHoursPerWeek ?? prev.workSettings.maxHoursPerWeek,
        maxConsecutiveDays:
          savedPreferences.maxConsecutiveDays ?? prev.workSettings.maxConsecutiveDays,
      },
    }));
  }, [savedPreferences]);

  // Serialise personal settings (theme, language, timezone, notifications) into
  // the `notes` field of user_preferences until dedicated columns are added.
  const handleSavePersonalSettings = async (): Promise<void> => {
    const { personalSettings } = settings;
    const notes = JSON.stringify({
      theme: personalSettings.theme,
      language: personalSettings.language,
      timezone: personalSettings.timezone,
      notifications: personalSettings.notifications,
    });
    await updateMyPreferences({ notes });
  };

  // Work scheduling constraints map directly to the preferences API fields.
  // minRestHours and preferredShifts (string names) are not persisted here:
  // minRestHours has no column in user_preferences yet, and preferredShifts
  // requires shift template IDs rather than the display-name strings used in
  // local state. Both will be wired once the schema is extended.
  /**
   * The Work tab has nothing self-editable left to save.
   *
   * It used to send `maxHoursPerWeek` and `maxConsecutiveDays` through the
   * self-service endpoint, which is guarded by authentication alone — so an
   * employee could raise their own working-time limits, which the optimizer
   * enforces as hard constraints and which are legally bounded in most
   * jurisdictions. The fields are now displayed read-only (they explain what
   * someone can be scheduled for) and changing them requires
   * `preferences.manage` through `PUT /preferences/:userId`.
   *
   * Kept as an explicit no-op rather than removing the Save control silently,
   * so the shape of the section is obvious to the next reader; the remaining
   * editable field on this tab is handled by the personal-settings save.
   */
  const handleSaveWorkSettings = async (): Promise<void> => {
    // Nothing on this tab is self-editable.
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
                className={`nav-link ${activeTab === 'calendar' ? 'active' : ''}`}
                onClick={() => setActiveTab('calendar')}
              >
                <i className="bi bi-calendar-event me-2"></i>Calendar
              </button>
            </li>
            <li className="nav-item">
              <button
                className={`nav-link ${activeTab === 'security' ? 'active' : ''}`}
                onClick={() => setActiveTab('security')}
              >
                <i className="bi bi-shield-lock me-2"></i>Security
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
            {isAdmin && (
              <li className="nav-item">
                <button
                  className={`nav-link ${activeTab === 'modules' ? 'active' : ''}`}
                  onClick={() => setActiveTab('modules')}
                >
                  <i className="bi bi-toggles me-2"></i>Modules
                </button>
              </li>
            )}
            {isAdmin && (
              <li className="nav-item">
                <button
                  className={`nav-link ${activeTab === 'fields' ? 'active' : ''}`}
                  onClick={() => setActiveTab('fields')}
                >
                  <i className="bi bi-input-cursor-text me-2"></i>Employee Fields
                </button>
              </li>
            )}
            {isAdmin && (
              <li className="nav-item">
                <button
                  className={`nav-link ${activeTab === 'geofences' ? 'active' : ''}`}
                  onClick={() => setActiveTab('geofences')}
                >
                  <i className="bi bi-geo-alt me-2"></i>Geofences
                </button>
              </li>
            )}
            {isAdmin && (
              <li className="nav-item">
                <button
                  className={`nav-link ${activeTab === 'kiosks' ? 'active' : ''}`}
                  onClick={() => setActiveTab('kiosks')}
                >
                  <i className="bi bi-tablet me-2"></i>Kiosk Devices
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
          onSave={handleSavePersonalSettings}
        />
      )}

      {activeTab === 'work' && (
        <ProfileSection
          settings={settings.workSettings}
          onChange={(updated) =>
            setSettings((prev) => ({ ...prev, workSettings: updated }))
          }
          onSave={handleSaveWorkSettings}
        />
      )}

      {activeTab === 'calendar' && <CalendarSection />}

      {activeTab === 'security' && <TwoFactorSection />}

      {activeTab === 'system' && isAdmin && <SystemSection />}

      {activeTab === 'modules' && isAdmin && <ModulesSection />}

      {activeTab === 'fields' && isAdmin && (
        <FieldPolicySection organizationName={user?.organizationName ?? null} />
      )}

      {activeTab === 'geofences' && isAdmin && <GeofenceSection />}

      {activeTab === 'kiosks' && isAdmin && <KioskDevicesSection />}
    </div>
  );
};

export default Settings;
