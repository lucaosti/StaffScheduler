/**
 * ProfileSection — Work preferences tab for the Settings page.
 *
 * Persists scheduling constraints via PUT /api/preferences/me.
 * The "preferred shifts" are stored as display-name strings in local state;
 * only the numeric constraints (maxHoursPerWeek, maxConsecutiveDays) are sent
 * to the preferences API because the API expects shift template IDs for
 * preferredShifts which are not available in this UI yet.
 *
 * @author Luca Ostinelli
 */

import React, { useState } from 'react';

interface WorkSettings {
  maxHoursPerWeek: number;
  maxConsecutiveDays: number;
  minRestHours: number;
  preferredShifts: string[];
  availabilitySettings: {
    unavailableDates: string[];
    preferredDepartments: string[];
  };
}

interface Props {
  settings: WorkSettings;
  onChange: (updated: WorkSettings) => void;
  onSave: () => Promise<void>;
}

const ProfileSection: React.FC<Props> = ({ settings, onChange, onSave }) => {
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSuccess(null);
    setError(null);
    try {
      await onSave();
      setSuccess('Work preferences saved successfully.');
    } catch (err) {
      setError((err as Error).message || 'Failed to save work preferences.');
    } finally {
      setSaving(false);
    }
  };

  const toggleShift = (shift: string, checked: boolean) => {
    const updated = checked
      ? [...settings.preferredShifts, shift]
      : settings.preferredShifts.filter((s) => s !== shift);
    onChange({ ...settings, preferredShifts: updated });
  };

  return (
    <div className="row">
      <div className="col-lg-8">
        <div className="card">
          <div className="card-header">
            <h5 className="mb-0">Work Preferences</h5>
          </div>
          <div className="card-body">
            {success && (
              <div className="alert alert-success" role="status">
                <i className="bi bi-check-circle me-2" aria-hidden="true"></i>
                {success}
              </div>
            )}
            {error && (
              <div className="alert alert-danger" role="alert">
                <i className="bi bi-exclamation-triangle me-2" aria-hidden="true"></i>
                {error}
              </div>
            )}
            <form onSubmit={handleSubmit}>
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
                    value={settings.maxHoursPerWeek}
                    onChange={(e) =>
                      onChange({ ...settings, maxHoursPerWeek: parseInt(e.target.value) })
                    }
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
                    value={settings.maxConsecutiveDays}
                    onChange={(e) =>
                      onChange({ ...settings, maxConsecutiveDays: parseInt(e.target.value) })
                    }
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
                    value={settings.minRestHours}
                    onChange={(e) =>
                      onChange({ ...settings, minRestHours: parseInt(e.target.value) })
                    }
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
                      checked={settings.preferredShifts.includes('day-shift')}
                      onChange={(e) => toggleShift('day-shift', e.target.checked)}
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
                      checked={settings.preferredShifts.includes('afternoon-shift')}
                      onChange={(e) => toggleShift('afternoon-shift', e.target.checked)}
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
                      checked={settings.preferredShifts.includes('night-shift')}
                      onChange={(e) => toggleShift('night-shift', e.target.checked)}
                    />
                    <label className="form-check-label" htmlFor="nightShift">
                      Night Shift (22:00-06:00)
                    </label>
                  </div>
                </div>
              </div>

              <div className="mt-4">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={saving}
                >
                  {saving ? (
                    <>
                      <span
                        className="spinner-border spinner-border-sm me-2"
                        role="status"
                        aria-hidden="true"
                      ></span>
                      Saving…
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
  );
};

export default ProfileSection;
