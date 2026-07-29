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
 * "YYYY-MM-DD" for today, or a number of days either side of it.
 *
 * WHY NOT `new Date().toISOString().slice(0, 10)`. That is the UTC date. In any
 * positive-offset timezone — Europe/Rome, where this project is used — the
 * hours between local midnight and the offset are still YESTERDAY in UTC, so
 * "today" comes back as the day before. At 00:30 in Rome the expression yields
 * the 29th when the calendar says the 30th.
 *
 * That is not hypothetical: six pages each wrote their own version of this,
 * under four different names, and every one of them had it. A default date
 * range that silently starts a day early is the kind of defect nobody reports
 * because it looks like the app just chose a different default.
 *
 * The backend documents the same trap on `DateUtils.fromMySQLDate` and reads
 * local calendar components for exactly this reason; this is the browser half
 * of that rule.
 *
 * It lives beside the formatters rather than in a file of its own because
 * discoverability is what failed: people wrote their own because they did not
 * find one here.
 */
export const todayIso = (offsetDays = 0): string => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/** "YYYY-MM-DD" for the first day of the current month, in local time. */
export const firstOfMonthIso = (): string => {
  const d = new Date();
  d.setDate(1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
};

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
