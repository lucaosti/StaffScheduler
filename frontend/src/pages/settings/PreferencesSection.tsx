/**
 * PreferencesSection — Personal preferences tab for the Settings page.
 *
 * @author Luca Ostinelli
 */

import React from 'react';

interface PersonalSettings {
  theme: 'light' | 'dark' | 'auto';
  language: 'it' | 'en';
  timezone: string;
  notifications: {
    email: boolean;
    push: boolean;
    sms: boolean;
  };
}

interface Props {
  settings: PersonalSettings;
  onChange: (updated: PersonalSettings) => void;
  onSave: () => void;
}

const PreferencesSection: React.FC<Props> = ({ settings, onChange, onSave }) => {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave();
  };

  return (
    <div className="row">
      <div className="col-lg-8">
        <div className="card">
          <div className="card-header">
            <h5 className="mb-0">Personal Preferences</h5>
          </div>
          <div className="card-body">
            <form onSubmit={handleSubmit}>
              <div className="row">
                <div className="col-md-6 mb-3">
                  <label htmlFor="theme" className="form-label">Theme</label>
                  <select
                    className="form-select"
                    id="theme"
                    value={settings.theme}
                    onChange={(e) =>
                      onChange({
                        ...settings,
                        theme: e.target.value as 'light' | 'dark' | 'auto',
                      })
                    }
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
                    value={settings.language}
                    onChange={(e) =>
                      onChange({
                        ...settings,
                        language: e.target.value as 'it' | 'en',
                      })
                    }
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
                  value={settings.timezone}
                  onChange={(e) => onChange({ ...settings, timezone: e.target.value })}
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
                      checked={settings.notifications.email}
                      onChange={(e) =>
                        onChange({
                          ...settings,
                          notifications: { ...settings.notifications, email: e.target.checked },
                        })
                      }
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
                      checked={settings.notifications.push}
                      onChange={(e) =>
                        onChange({
                          ...settings,
                          notifications: { ...settings.notifications, push: e.target.checked },
                        })
                      }
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
                      checked={settings.notifications.sms}
                      onChange={(e) =>
                        onChange({
                          ...settings,
                          notifications: { ...settings.notifications, sms: e.target.checked },
                        })
                      }
                    />
                    <label className="form-check-label" htmlFor="smsNotifications">
                      SMS Notifications
                    </label>
                  </div>
                </div>
              </div>

              <div className="mt-4">
                <button
                  type="submit"
                  className="btn btn-secondary"
                  disabled
                  title="Settings persistence not yet available"
                >
                  <i className="bi bi-check me-2"></i>
                  Save Personal Settings
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PreferencesSection;
