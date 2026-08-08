/**
 * i18next setup.
 *
 * Replaces the earlier homegrown `I18nContext`/`messages.ts` pair with the
 * standard `react-i18next` stack. English is always the fallback/source
 * language: every key is guaranteed to exist there, so a missing translation
 * in another locale degrades to English rather than to the raw key.
 *
 * KEY CONVENTION: catalog keys are flat dotted strings (`"auth.signIn"`),
 * not nested JSON objects, matching the previous `messages.ts` convention so
 * migrating call sites was a straight `t('dot.key')` → `t('dot.key')` swap.
 * `keySeparator: false` below is what makes i18next treat the dot as part of
 * the literal key instead of a path into a nested resource tree.
 *
 * PERSISTENCE: the chosen locale is stored in `localStorage` under the same
 * `locale` key the old context used, via `i18next-browser-languagedetector`
 * (`localStorage` first, then the browser's `navigator.language`, then the
 * `fallbackLng`).
 *
 * ORGANIZATION OVERRIDES: see `./organizationOverrides.ts`. This module only
 * loads the shipped base catalogs; an organization's own strings are layered
 * on top at runtime by that separate function, so the merge logic is testable
 * and reusable independent of how (or whether) it is ever wired to a backend.
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import en from './locales/en/translation.json';
import it from './locales/it/translation.json';
import ar from './locales/ar/translation.json';

export const SUPPORTED_LOCALES = ['en', 'it', 'ar'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** Locales that render right-to-left. Arabic is the only one shipped today. */
const RTL_LOCALES: readonly Locale[] = ['ar'];

const LOCALE_STORAGE_KEY = 'locale';

export const isRtl = (locale: string): boolean =>
  (RTL_LOCALES as readonly string[]).includes(locale);

export const isSupportedLocale = (value: string): value is Locale =>
  (SUPPORTED_LOCALES as readonly string[]).includes(value);

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      it: { translation: it },
      ar: { translation: ar },
    },
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LOCALES as unknown as string[],
    keySeparator: false,
    interpolation: {
      // React already escapes rendered output.
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: LOCALE_STORAGE_KEY,
      caches: ['localStorage'],
    },
  });

export default i18n;
