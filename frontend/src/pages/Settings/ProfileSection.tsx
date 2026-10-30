/**
 * ProfileSection — Work preferences tab for the Settings page.
 *
 * Read-only by design (#843). The tab used to offer an editable minimum-rest
 * field and three preferred-shift checkboxes behind a "Save Work Settings"
 * button that did nothing and then reported "Work preferences saved
 * successfully". Neither value has anywhere to go: `user_preferences` has no
 * rest-hours column, and `preferredShifts` takes shift template IDs, not the
 * hardcoded display names the checkboxes used. Wiring preferred shifts to the
 * real templates is a feature of its own; until then the controls are absent
 * rather than pretending.
 *
 * What remains is what the server holds: the working-time limits. They are
 * shown, not editable — they are hard constraints the optimizer enforces and
 * legally bounded in most jurisdictions, and the self-service endpoint is
 * guarded by authentication alone; changing them requires
 * `preferences.manage` through `PUT /preferences/:userId`.
 *
 * @author Luca Ostinelli
 */

import React from 'react';
import { useMyPreferencesQuery } from '../../hooks/usePreferences';
import QueryState from '../../components/QueryState';

const ProfileSection: React.FC = () => {
  const preferencesQuery = useMyPreferencesQuery();
  const preferences = preferencesQuery.data;

  return (
    <div className="row">
      <div className="col-lg-8">
        <div className="card">
          <div className="card-header">
            <h5 className="mb-0">Work Preferences</h5>
          </div>
          <div className="card-body">
            <h6 className="mb-3">Schedule Constraints</h6>
            <div className="alert alert-secondary py-2 small" id="limitsSetByManager" role="note">
              <i className="bi bi-lock me-2" aria-hidden="true"></i>
              Your working-time limits are set by your manager. They are shown
              here because they govern what you can be scheduled for.
            </div>
            <QueryState isLoading={preferencesQuery.isLoading} isError={false}>
              {preferences ? (
                <div className="row">
                  <div className="col-md-4 mb-3">
                    <label htmlFor="maxHoursPerWeek" className="form-label">Max Hours Per Week</label>
                    <input
                      type="number"
                      className="form-control"
                      id="maxHoursPerWeek"
                      value={preferences.maxHoursPerWeek}
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
                      value={preferences.maxConsecutiveDays}
                      readOnly
                      aria-describedby="limitsSetByManager"
                    />
                  </div>
                </div>
              ) : (
                <p className="text-muted mb-0">No working-time limits are on record for you.</p>
              )}
            </QueryState>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfileSection;
