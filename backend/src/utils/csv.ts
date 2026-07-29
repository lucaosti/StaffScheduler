/**
 * One CSV serializer for every export in the system.
 *
 * WHY CENTRALIZED. Before this there was exactly one export — the audit log —
 * with its serializer written inline in `AuditLogService`, and the moment a
 * second one appeared the choice was between copying that code or fixing it
 * once. Two of the three things below were wrong in that copy, and both fail
 * quietly: nobody reports an export that opened, they just distrust the numbers.
 *
 * 1. RFC 4180 QUOTING. A field is quoted when it contains a comma, a quote, a
 *    CR or an LF, and embedded quotes are doubled. Line endings are CRLF,
 *    because that is what the standard says and what Excel writes.
 *
 * 2. A UTF-8 BYTE-ORDER MARK. Excel on Windows reads a BOM-less file as the
 *    system codepage, so "Müller" arrives as "MÃ¼ller". This is the single most
 *    common complaint about CSV exports and it is three bytes to prevent. The
 *    BOM is invisible to every other consumer, including `csv-parse`, Numbers
 *    and pandas.
 *
 * 3. A FORMULA-INJECTION GUARD. Excel and LibreOffice evaluate a cell beginning
 *    `=`, `+`, `-`, `@`, TAB or CR as a formula, and these exports carry text
 *    users typed: names, descriptions, justifications. `=HYPERLINK(...)` in an
 *    employee's display name becomes a live link in the manager's spreadsheet,
 *    and `=cmd|...` is a documented remote-execution vector in Excel. Such a
 *    value is prefixed with a tab and quoted: spreadsheets treat the tab as
 *    text, and the data survives a round trip, unlike stripping the character.
 *    Quoting ALONE does not prevent this — a quoted field is still parsed as a
 *    formula once unquoted — so the prefix is the guard and the quoting only
 *    stops a tab-delimited import from splitting on it.
 *
 * WHY A COLUMN LIST RATHER THAN `Object.keys(row)`. Deriving the header from the
 * first row makes the column set depend on which record happened to come first
 * and on whether an optional field was null — so the same export changes shape
 * between runs, and a newly added internal field silently starts being
 * published. Columns are declared, so what leaves the system is a decision.
 *
 * WHY NOT STREAMING. The issue asked for streaming, and it is not yet
 * warranted: every export here is bounded by a date range or a scope filter and
 * the largest realistic result — an organization's assignments for a year — is
 * a few megabytes of text, well under the response buffer. Streaming would mean
 * giving up the `success/error` envelope on a mid-flight failure, since the
 * status line is already sent, and the honest report of a half-written export is
 * worth more than the memory it saves. Revisit when a single export exceeds
 * roughly a hundred thousand rows; the seam is `toCsv`, which would become an
 * async generator with the callers unchanged.
 */

/** One output column: its header text and how to read it from a row. */
export interface CsvColumn<T> {
  header: string;
  value: (row: T) => unknown;
}

/** Characters that make a spreadsheet treat a leading value as a formula. */
const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

const NEEDS_QUOTES = /[",\r\n]/;

/** UTF-8 BOM. Present so Excel does not read the file as the system codepage. */
export const CSV_BOM = '﻿';

/**
 * A single field, escaped and — if a spreadsheet would evaluate it — defused.
 *
 * `null` and `undefined` become empty rather than the strings "null"/"undefined",
 * which is the difference between "no value" and a value that happens to read
 * like one. Objects are JSON-encoded, because the audit log's snapshots are the
 * one place a CSV cell legitimately holds a structure.
 */
export const csvField = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'object' ? JSON.stringify(value) : String(value);

  // The guard forces quoting as well as prefixing. A bare leading tab is legal
  // CSV, but it is also what a tab-delimited import would split on, so leaving
  // it unquoted trades one silent misreading for another.
  const defused = text.length > 0 && FORMULA_PREFIXES.includes(text[0]);
  if (defused) text = `\t${text}`;

  return defused || NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/**
 * Serializes rows as RFC 4180 CSV with a BOM, one column per declared column.
 *
 * An empty result still emits the header row: a file with column names and no
 * data says "nothing matched", where a zero-byte file says "the export broke".
 */
export const toCsv = <T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string => {
  const lines = [columns.map((c) => csvField(c.header)).join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => csvField(c.value(row))).join(','));
  }
  return CSV_BOM + lines.join('\r\n');
};

/**
 * A download filename: `<base>_<YYYY-MM-DD>.csv`, with the base slugified.
 *
 * Dated because these files accumulate in a downloads folder, and
 * `hours-worked.csv (3)` is not something anyone can identify later. Slugified
 * because a base assembled from user-controlled text could otherwise carry a
 * quote or a newline into the `Content-Disposition` header, which is header
 * injection — the filename is the one part of an export a caller can influence.
 */
export const csvFilename = (base: string, on: Date = new Date()): string => {
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const y = on.getFullYear();
  const m = String(on.getMonth() + 1).padStart(2, '0');
  const d = String(on.getDate()).padStart(2, '0');
  return `${slug || 'export'}_${y}-${m}-${d}.csv`;
};
