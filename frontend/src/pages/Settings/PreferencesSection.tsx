/**
 * PreferencesSection — Personal preferences tab for the Settings page.
 *
 * Only what the app actually applies (#843). The tab used to collect theme,
 * language, timezone and email/push/SMS toggles, report "Personal
 * preferences saved successfully", and serialise them as JSON into the
 * `user_preferences.notes` field — overwriting the user's scheduling notes,
 * and never read back by anything. Timezone and the email/SMS toggles had no
 * consumer at all, so they are gone rather than faked.
 *
 * Theme and language are bound to the same state the header controls use
 * (`ThemeContext`, i18next): they apply at once and are remembered on this
 * device (localStorage), so there is no Save button to claim a save that a
 * server never received. Persisting them per account would need columns
 * and an endpoint that do not exist; that is a backend feature, not
 * something to approximate here. Web Push is the real toggle below.
 *
 * @author Luca Ostinelli
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import WebPushToggle from './WebPushToggle';
import { useTheme } from '../../contexts/ThemeContext';
import { SUPPORTED_LOCALES, isSupportedLocale } from '../../i18n';

type ThemeChoice = 'light' | 'dark' | 'system';

const PreferencesSection: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { choice, setChoice } = useTheme();
  const language = isSupportedLocale(i18n.language) ? i18n.language : 'en';

  return (
    <div className="row">
      <div className="col-lg-8">
        <div className="card">
          <div className="card-header">
            <h5 className="mb-0">Personal Preferences</h5>
          </div>
          <div className="card-body">
            <p className="text-muted small" id="appliesOnThisDevice">
              Changes apply immediately and are remembered on this device.
            </p>
            <div className="row">
              <div className="col-md-6 mb-3">
                <label htmlFor="theme" className="form-label">Theme</label>
                <select
                  className="form-select"
                  id="theme"
                  aria-describedby="appliesOnThisDevice"
                  value={choice}
                  onChange={(e) => setChoice(e.target.value as ThemeChoice)}
                >
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                  <option value="system">Auto (System)</option>
                </select>
              </div>
              <div className="col-md-6 mb-3">
                <label htmlFor="language" className="form-label">Language</label>
                <select
                  className="form-select"
                  id="language"
                  aria-describedby="appliesOnThisDevice"
                  value={language}
                  onChange={(e) => {
                    if (isSupportedLocale(e.target.value)) void i18n.changeLanguage(e.target.value);
                  }}
                >
                  {SUPPORTED_LOCALES.map((locale) => (
                    <option key={locale} value={locale}>
                      {t(`locale.${locale}`)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <WebPushToggle />
          </div>
        </div>
      </div>
    </div>
  );
};

export default PreferencesSection;
