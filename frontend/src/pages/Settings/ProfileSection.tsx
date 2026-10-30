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
 * A failed fetch shows the error (#843 review): it used to read "no limits
 * are on record", a false statement about the caller's contract.
 *
 * @author Luca Ostinelli
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { useMyPreferencesQuery } from '../../hooks/usePreferences';
import QueryState from '../../components/QueryState';

const ProfileSection: React.FC = () => {
  const { t } = useTranslation();
  const preferencesQuery = useMyPreferencesQuery();
  const preferences = preferencesQuery.data;

  return (
    <div className="row">
      <div className="col-lg-8">
        <div className="card">
          <div className="card-header">
            <h5 className="mb-0">{t('settings.work.title')}</h5>
          </div>
          <div className="card-body">
            <h6 className="mb-3">{t('settings.work.constraints')}</h6>
            <div className="alert alert-secondary py-2 small" id="limitsSetByManager" role="note">
              <i className="bi bi-lock me-2" aria-hidden="true"></i>
              {t('settings.work.limitsNote')}
            </div>
            <QueryState
              isLoading={preferencesQuery.isLoading}
              isError={preferencesQuery.isError}
              error={preferencesQuery.error}
              onRetry={() => preferencesQuery.refetch()}
              loadingMessage={t('settings.work.loading')}
            >
              {preferences ? (
                <div className="row">
                  <div className="col-md-4 mb-3">
                    <label htmlFor="maxHoursPerWeek" className="form-label">{t('settings.work.maxHoursPerWeek')}</label>
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
                    <label htmlFor="maxConsecutiveDays" className="form-label">{t('settings.work.maxConsecutiveDays')}</label>
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
                <p className="text-muted mb-0">{t('settings.work.noLimits')}</p>
              )}
            </QueryState>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfileSection;
