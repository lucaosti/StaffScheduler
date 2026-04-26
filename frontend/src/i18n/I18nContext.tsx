/**
 * i18n context (F14).
 *
 * Provides the current locale + a `t(key)` helper. Persists the user's
 * choice in localStorage. Defaults to the browser's `navigator.language`
 * when no preference is stored.
 *
 * @author Luca Ostinelli
 */

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Locale, translate } from './messages';

const STORAGE_KEY = 'locale';
const SUPPORTED: Locale[] = ['en', 'it'];

interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, fallback?: string) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

const detectInitialLocale = (): Locale => {
  if (typeof window === 'undefined') return 'en';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'en' || stored === 'it') return stored;
  const nav = window.navigator?.language?.slice(0, 2);
  if (nav && (SUPPORTED as string[]).includes(nav)) return nav as Locale;
  return 'en';
};

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [locale, setLocaleState] = useState<Locale>(detectInitialLocale);

  const setLocale = useCallback((next: Locale): void => {
    setLocaleState(next);
    if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const t = useCallback(
    (key: string, fallback?: string): string => translate(locale, key, fallback),
    [locale]
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = (): I18nValue => {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
};
