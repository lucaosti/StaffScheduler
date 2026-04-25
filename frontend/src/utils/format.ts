/**
 * Formatting helpers shared across the UI.
 *
 * Centralizes locale-aware date, time, currency, and percentage formatting
 * so pages do not redefine these inline.
 *
 * @author Luca Ostinelli
 */

const DEFAULT_LOCALE = 'en-US';
const DEFAULT_CURRENCY = 'EUR';

/**
 * Formats an ISO date or Date object as a short locale date (e.g. "Apr 25, 2026").
 */
export const formatDate = (
  value: string | Date | null | undefined,
  locale: string = DEFAULT_LOCALE
): string => {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
};

/**
 * Formats a `HH:mm` or ISO time string as a locale time (e.g. "14:30").
 */
export const formatTime = (
  value: string | Date | null | undefined,
  locale: string = DEFAULT_LOCALE
): string => {
  if (!value) return '';
  // Accept "HH:mm" or "HH:mm:ss"
  if (typeof value === 'string' && /^\d{2}:\d{2}(:\d{2})?$/.test(value)) {
    return value.slice(0, 5);
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
};

/**
 * Formats a numeric amount as currency.
 */
export const formatCurrency = (
  amount: number,
  currency: string = DEFAULT_CURRENCY,
  locale: string = DEFAULT_LOCALE
): string => {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
};

/**
 * Formats a 0-1 ratio (or 0-100 if `asRatio` is false) as a localized percentage.
 */
export const formatPercentage = (
  value: number,
  asRatio: boolean = true,
  locale: string = DEFAULT_LOCALE
): string => {
  const ratio = asRatio ? value : value / 100;
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(ratio);
};
