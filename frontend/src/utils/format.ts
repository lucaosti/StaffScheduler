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

/** A Date's LOCAL calendar day as "YYYY-MM-DD" — see `todayIso` for why. */
const localIso = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

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
  return localIso(d);
};

/**
 * "YYYY-MM-DD" for a date the caller already has, whether string or `Date`.
 *
 * The companion to `todayIso`, and the same trap in a place that is harder to
 * notice: `todayIso` PRODUCES a date, this one FORMATS one it is given. Four
 * call sites each wrote `typeof d === 'string' ? d.slice(0, 10) :
 * new Date(d).toISOString().slice(0, 10)` — and the second branch is the UTC
 * date, so a `Date` at 00:30 in Rome formats as the previous day.
 *
 * The string branch is the one that runs today, because dates cross the wire as
 * JSON strings, which is what kept this latent: the types say `string | Date`
 * and nothing currently constructs the `Date`. It goes live the moment
 * something does, and the symptom — a date one day early — reads as a display
 * quirk rather than a bug, so it would not be reported as one.
 *
 * A string is sliced rather than parsed: `"2026-07-30"` fed to `new Date` is
 * parsed as UTC midnight, so re-formatting it locally would move it back a day
 * in a NEGATIVE offset. The string is already the calendar date the server
 * meant, and the correct thing to do with it is nothing.
 *
 * Mirrors the backend's `DateUtils.toDateString`, which exists for this reason.
 */
export const toLocalDateString = (value: string | Date | null | undefined): string => {
  if (!value) return '';
  return typeof value === 'string' ? value.slice(0, 10) : localIso(value);
};

/** "YYYY-MM-DD" for the first day of the current month, in local time. */
export const firstOfMonthIso = (): string => {
  const d = new Date();
  d.setDate(1);
  return localIso(d);
};

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Formats an ISO date or Date object as a short locale date (e.g. "Apr 25, 2026").
 *
 * A DATE-ONLY string is parsed as local midnight, not by `new Date`, which reads
 * "2026-04-25" as UTC midnight per the spec. Handed to a locale formatter that
 * renders in local time, that instant is still 24 April anywhere west of
 * Greenwich — so every date-only value the API returns rendered a day early for
 * those users, on every screen using this helper. It went unseen because CI and
 * this project's own timezone are both at or east of UTC, where the two agree.
 * A string with a time in it does name a real instant, and is left to `Date`.
 */
export const formatDate = (
  value: string | Date | null | undefined,
  locale: string = DEFAULT_LOCALE
): string => {
  if (!value) return '';
  const date =
    typeof value === 'string' && DATE_ONLY.test(value)
      ? new Date(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)))
      : value instanceof Date
        ? value
        : new Date(value);
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
