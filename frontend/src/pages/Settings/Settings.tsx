/**
 * Settings Page Component for Staff Scheduler
 *
 * Thin coordinator that composes the Settings tabs from sub-components.
 * The System tab is only shown to users with the settings.manage permission.
 *
 * @author Luca Ostinelli
 */

import React, { useState } from 'react';
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
import CostPlansSection from '../Settings/CostPlansSection';
import TranslationOverridesSection from '../Settings/TranslationOverridesSection';

const Settings: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.permissions?.includes('settings.manage');
  // Separate from `isAdmin`: deciding what the organization is measured
  // against is `report.manage`, not `settings.manage` — the same read/write
  // separation the backend draws for cost plans.
  const canManageCostPlans = user?.permissions?.includes('report.manage');

  const [activeTab, setActiveTab] = useState<'personal' | 'work' | 'calendar' | 'security' | 'system' | 'modules' | 'fields' | 'geofences' | 'kiosks' | 'costPlans' | 'translations'>('personal');

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
            {canManageCostPlans && (
              <li className="nav-item">
                <button
                  className={`nav-link ${activeTab === 'costPlans' ? 'active' : ''}`}
                  onClick={() => setActiveTab('costPlans')}
                >
                  <i className="bi bi-cash-coin me-2"></i>Cost Plans
                </button>
              </li>
            )}
            {isAdmin && (
              <li className="nav-item">
                <button
                  className={`nav-link ${activeTab === 'translations' ? 'active' : ''}`}
                  onClick={() => setActiveTab('translations')}
                >
                  <i className="bi bi-translate me-2"></i>Translations
                </button>
              </li>
            )}
          </ul>
        </div>
      </div>

      {activeTab === 'personal' && <PreferencesSection />}

      {activeTab === 'work' && <ProfileSection />}

      {activeTab === 'calendar' && <CalendarSection />}

      {activeTab === 'security' && <TwoFactorSection />}

      {activeTab === 'system' && isAdmin && <SystemSection />}

      {activeTab === 'modules' && isAdmin && <ModulesSection />}

      {activeTab === 'fields' && isAdmin && (
        <FieldPolicySection organizationName={user?.organizationName ?? null} />
      )}

      {activeTab === 'geofences' && isAdmin && <GeofenceSection />}

      {activeTab === 'kiosks' && isAdmin && <KioskDevicesSection />}

      {activeTab === 'costPlans' && canManageCostPlans && <CostPlansSection />}

      {activeTab === 'translations' && isAdmin && (
        <TranslationOverridesSection organizationName={user?.organizationName ?? null} />
      )}
    </div>
  );
};

export default Settings;
