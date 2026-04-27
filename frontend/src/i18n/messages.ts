/**
 * Minimal i18n message catalogue (F14).
 *
 * Two locales today (en, it). Adding more locales is just another entry
 * in `MESSAGES`. Lookups fall back to English when a key is missing,
 * and to the key itself when even English does not have it — that way
 * the UI never renders an empty string.
 *
 * @author Luca Ostinelli
 */

export type Locale = 'en' | 'it';

type MessageDictionary = Record<string, string>;

const MESSAGES: Record<Locale, MessageDictionary> = {
  en: {
    'app.title': 'Staff Scheduler',
    'common.loading': 'Loading…',
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'common.delete': 'Delete',
    'common.edit': 'Edit',
    'common.error': 'An error occurred',
    'common.dashboard': 'Dashboard',
    'auth.signIn': 'Sign in',
    'auth.signOut': 'Sign out',
    'auth.email': 'Email',
    'auth.password': 'Password',
    'demo.banner': 'Demo environment. Data may be reset at any time.',
    'theme.light': 'Light',
    'theme.dark': 'Dark',
    'theme.system': 'System',
  },
  it: {
    'app.title': 'Staff Scheduler',
    'common.loading': 'Caricamento…',
    'common.save': 'Salva',
    'common.cancel': 'Annulla',
    'common.delete': 'Elimina',
    'common.edit': 'Modifica',
    'common.error': 'Si è verificato un errore',
    'common.dashboard': 'Dashboard',
    'auth.signIn': 'Accedi',
    'auth.signOut': 'Esci',
    'auth.email': 'Email',
    'auth.password': 'Password',
    'demo.banner': 'Ambiente demo. I dati possono essere ripristinati in qualsiasi momento.',
    'theme.light': 'Chiaro',
    'theme.dark': 'Scuro',
    'theme.system': 'Sistema',
  },
};

/** Looks up a key with a fallback chain: locale → en → key. */
export const translate = (locale: Locale, key: string, fallback?: string): string => {
  const fromLocale = MESSAGES[locale]?.[key];
  if (fromLocale !== undefined) return fromLocale;
  const fromEnglish = MESSAGES.en[key];
  if (fromEnglish !== undefined) return fromEnglish;
  return fallback ?? key;
};
