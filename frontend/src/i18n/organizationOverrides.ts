/**
 * Organization translation-override layer.
 *
 * The shipped catalogs in `./locales/*` are the base; an organization may
 * want to rename a term ("Employee" → "Associate") or fix a translation
 * without a code deploy. This function is the client-side half of that: it
 * layers a caller-supplied override object over the base catalog for one
 * locale, using i18next's own resource-bundle merge so every already-mounted
 * `useTranslation()` call re-renders with the new strings immediately.
 *
 * THERE IS NO BACKEND ENDPOINT YET that supplies `overrides` — none of the
 * existing routes expose per-organization translation strings, and adding
 * one is out of scope here (tracked as a follow-up issue). This
 * function exists so that a future integration point is real: it can be
 * called from wherever the organization's settings are loaded, without any
 * further changes to the i18n layer. Until then nothing calls it, which is
 * the same "leave the handler empty" contract the rest of the app follows
 * for not-yet-implemented backend integrations — no fake data, no simulated
 * fetch.
 */

import i18n from './index';
import type { Locale } from './index';

/**
 * Merges `overrides` on top of the base catalog for `locale`.
 *
 * Keys follow the same flat-dotted convention as the catalog files
 * (`"auth.signIn"`, not a nested object). A missing or empty `overrides` is
 * a safe no-op — callers do not need to guard the call themselves.
 */
export const applyOrganizationOverrides = (
  locale: Locale,
  overrides: Record<string, string> | undefined | null
): void => {
  if (!overrides || Object.keys(overrides).length === 0) return;
  i18n.addResourceBundle(locale, 'translation', overrides, true, true);
  // `addResourceBundle` fires i18next's own 'added' event, but
  // `useTranslation()` only re-renders on 'languageChanged' /
  // 'fallbackLngChanged' by default (`bindI18nStore` is opt-in per call
  // site). Re-emitting 'languageChanged' is the standard workaround so
  // every already-mounted consumer picks up the new strings without each
  // one having to opt in individually.
  i18n.emit('languageChanged', i18n.language);
};
