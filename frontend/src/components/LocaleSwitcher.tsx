/**
 * Locale switcher dropdown.
 *
 * Runtime UI-language selection: EN/IT/AR/ES today (`SUPPORTED_LOCALES`).
 * Selecting a locale calls `i18n.changeLanguage`, which persists the choice
 * (via `i18next-browser-languagedetector`'s localStorage cache) and re-renders
 * every mounted `useTranslation()` consumer, including `DirectionSync`, which
 * reactively flips `<html dir>` for Arabic.
 *
 * @author Luca Ostinelli
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LOCALES, isSupportedLocale, type Locale } from '../i18n';

const LocaleSwitcher: React.FC = () => {
  const { t, i18n } = useTranslation();
  const current = isSupportedLocale(i18n.language) ? i18n.language : 'en';

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>): void => {
    const next = e.target.value;
    if (isSupportedLocale(next)) void i18n.changeLanguage(next);
  };

  return (
    <select
      className="form-select form-select-sm w-auto"
      aria-label={t('locale.switcherLabel')}
      title={t('locale.switcherLabel')}
      value={current}
      onChange={handleChange}
    >
      {SUPPORTED_LOCALES.map((locale: Locale) => (
        <option key={locale} value={locale}>
          {t(`locale.${locale}`)}
        </option>
      ))}
    </select>
  );
};

export default LocaleSwitcher;
