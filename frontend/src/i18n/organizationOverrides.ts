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
 * `GET /api/i18n/overrides?locale=xx` supplies `overrides`: it is scoped to
 * the caller's own organization (falling back to the platform-wide row when
 * the organization has none), and `AuthContext` calls this function once the
 * authenticated user is known and again on every locale change — see
 * `contexts/AuthContext.tsx`. This function itself stays backend-agnostic:
 * it only knows how to merge a map it is handed, which is what keeps it
 * testable independent of the fetch.
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
