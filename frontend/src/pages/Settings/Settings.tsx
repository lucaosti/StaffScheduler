/**
 * Settings Page Component for Staff Scheduler
 *
 * Thin coordinator that composes the Settings tabs from sub-components.
 * The System tab is only shown to users with the system.settings permission.
 *
 * @author Luca Ostinelli
 */

import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import PreferencesSection from '../Settings/PreferencesSection';
import ProfileSection from '../Settings/ProfileSection';
import SystemSection from '../Settings/SystemSection';
import CalendarSection from '../Settings/CalendarSection';
import { getMyPreferences, updateMyPreferences, UserPreferences } from '../../services/preferencesService';

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

  const [activeTab, setActiveTab] = useState<'personal' | 'work' | 'calendar' | 'system'>('personal');

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

  // Load saved preferences on mount and hydrate work-settings state.
  useEffect(() => {
    const loadPreferences = async () => {
      try {
        const res = await getMyPreferences();
        if (res?.success && res?.data) {
          const prefs = res.data as UserPreferences;
          setSettings((prev) => ({
            ...prev,
            workSettings: {
              ...prev.workSettings,
              maxHoursPerWeek: prefs.maxHoursPerWeek ?? prev.workSettings.maxHoursPerWeek,
              maxConsecutiveDays: prefs.maxConsecutiveDays ?? prev.workSettings.maxConsecutiveDays,
            },
          }));
        }
      } catch {
        // Non-fatal — keep default values if preferences endpoint is unavailable.
      }
    };
    void loadPreferences();
  }, []);

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
  const handleSaveWorkSettings = async (): Promise<void> => {
    const { workSettings } = settings;
    await updateMyPreferences({
      maxHoursPerWeek: workSettings.maxHoursPerWeek,
      maxConsecutiveDays: workSettings.maxConsecutiveDays,
    });
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

      {activeTab === 'system' && isAdmin && <SystemSection />}
    </div>
  );
};

export default Settings;
