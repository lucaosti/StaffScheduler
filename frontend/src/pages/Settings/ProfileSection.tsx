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

import React, { useEffect, useState } from 'react';
import { useSettingsSectionSave } from '../../hooks/useSettingsSectionSave';

export interface WorkSettings {
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
  const { success, error, saving, run } = useSettingsSectionSave();

  // Raw draft string for the one editable numeric field, mirroring the
  // Draft-string pattern in FieldPolicySection: binding the input directly to
  // `settings.minRestHours` meant clearing the field to retype a value made
  // `parseInt('')` a NaN that immediately round-tripped back as the
  // controlled `value`, reading as the field misbehaving mid-edit. Synced
  // from the prop (not just seeded once) so an external settings reload is
  // still reflected — safe to run on every valid keystroke too, since a
  // round-tripped valid number renders back to the same string the user typed.
  const [minRestHoursDraft, setMinRestHoursDraft] = useState(String(settings.minRestHours));
  useEffect(() => {
    setMinRestHoursDraft(String(settings.minRestHours));
  }, [settings.minRestHours]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await run(onSave, 'Work preferences saved successfully.', 'Failed to save work preferences.');
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
              <div className="alert alert-secondary py-2 small" id="limitsSetByManager" role="note">
                <i className="bi bi-lock me-2" aria-hidden="true"></i>
                Your working-time limits are set by your manager. They are shown
                here because they govern what you can be scheduled for.
              </div>
              <div className="row">
                {/*
                  READ-ONLY BY DESIGN. These two were editable and saved through
                  the self-service endpoint, so an employee could raise their own
                  maximum weekly hours and consecutive working days — limits the
                  optimizer enforces as hard constraints, and legally bounded in
                  most jurisdictions. They are displayed rather than hidden
                  because they explain why someone is or is not being scheduled;
                  changing them requires `preferences.manage`.
                */}
                <div className="col-md-4 mb-3">
                  <label htmlFor="maxHoursPerWeek" className="form-label">Max Hours Per Week</label>
                  <input
                    type="number"
                    className="form-control"
                    id="maxHoursPerWeek"
                    value={settings.maxHoursPerWeek}
                    readOnly
                    aria-describedby="limitsSetByManager"
                  />
                </div>
                <div className="col-md-4 mb-3">
                  <label htmlFor="maxConsecutiveDays" className="form-label">Max Consecutive Days</label>
                  <input
                    type="number"
                    className="form-control"
                    id="maxConsecutiveDays"
                    value={settings.maxConsecutiveDays}
                    readOnly
                    aria-describedby="limitsSetByManager"
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
                    value={minRestHoursDraft}
                    onChange={(e) => {
                      setMinRestHoursDraft(e.target.value);
                      const parsed = parseInt(e.target.value, 10);
                      if (!Number.isNaN(parsed)) {
                        onChange({ ...settings, minRestHours: parsed });
                      }
                    }}
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
