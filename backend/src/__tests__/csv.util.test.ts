/**
 * The shared CSV serializer.
 *
 * Three of these cases exist because the one export that predated this file got
 * them wrong, and all three fail SILENTLY: a mangled name, a live formula and a
 * shifted column all produce a file that opens. Nobody reports an export that
 * opened — they just stop trusting the numbers, which is a much slower and more
 * expensive failure than a 500.
 *
 * @author Luca Ostinelli
 */

import { CSV_BOM, csvField, csvFilename, toCsv } from '../utils/csv';

export {};

interface Row {
  name: string;
  hours: number | null;
}

const columns = [
  { header: 'Name', value: (r: Row) => r.name },
  { header: 'Hours', value: (r: Row) => r.hours },
];

describe('csvField', () => {
  it('leaves an ordinary value unquoted', () => {
    expect(csvField('Rossi')).toBe('Rossi');
    expect(csvField(42)).toBe('42');
  });

  it('quotes and doubles quotes per RFC 4180', () => {
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('line\r\nbreak')).toBe('"line\r\nbreak"');
  });

  it('distinguishes an absent value from the word "null"', () => {
    // `String(null)` is "null", which reads in a spreadsheet as a value someone
    // entered rather than as a field that was empty.
    expect(csvField(null)).toBe('');
    expect(csvField(undefined)).toBe('');
    expect(csvField(0)).toBe('0');
    expect(csvField(false)).toBe('false');
  });

  it('JSON-encodes an object, for the audit log snapshots', () => {
    expect(csvField({ a: 1 })).toBe('"{""a"":1}"');
  });

  describe('formula injection', () => {
    // Excel and LibreOffice evaluate a cell starting with any of these. The
    // values reaching these exports include names, descriptions and
    // justifications — text a user typed — so this is reachable by design, not
    // by accident.
    it.each(['=', '+', '-', '@', '\t', '\r'])('defuses a value starting with %j', (prefix) => {
      // Prefixed AND quoted: a bare leading tab is what a tab-delimited import
      // would split on, so the quoting is part of the guard.
      expect(csvField(`${prefix}x`)).toBe(`"\t${prefix}x"`);
    });

    it('keeps the original characters, so the data survives a round trip', () => {
      // Stripping the `=` would be silent data loss; a leading tab is inert.
      expect(csvField('=1+1')).toBe('"\t=1+1"');
    });

    it('does not touch a value that merely contains one of them', () => {
      expect(csvField('a=b')).toBe('a=b');
      expect(csvField('2026-07-30')).toBe('2026-07-30');
    });

    it('defuses a NEGATIVE NUMBER, which is the awkward consequence', () => {
      // A leading "-" is indistinguishable from the start of a formula, so -5
      // is prefixed too. Accepted deliberately: a spreadsheet still shows and
      // sorts it, and the alternative — allowing anything that parses as a
      // number — is a parser deciding what is safe.
      expect(csvField(-5)).toBe('"\t-5"');
    });
  });
});

describe('toCsv', () => {
  it('starts with a BOM, so Excel reads it as UTF-8', () => {
    // Without this, "Müller" arrives as "MÃ¼ller" on a Windows Excel — the
    // single most common complaint about CSV exports.
    const csv = toCsv([{ name: 'Müller', hours: 8 }], columns);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv).toContain('Müller');
  });

  it('uses CRLF between records', () => {
    const csv = toCsv([{ name: 'a', hours: 1 }], columns);
    expect(csv.slice(CSV_BOM.length)).toBe('Name,Hours\r\na,1');
  });

  it('emits the header row even with no data', () => {
    // A file with column names and no rows says "nothing matched"; a zero-byte
    // file says "the export broke".
    expect(toCsv([], columns)).toBe(`${CSV_BOM}Name,Hours`);
  });

  it('publishes exactly the declared columns, in order', () => {
    // The point of declaring them: a field added to the row type is not
    // exported until someone adds a column for it.
    const csv = toCsv(
      [{ name: 'a', hours: 1, salary: 99_000 } as unknown as Row],
      columns
    );
    expect(csv).not.toContain('99000');
  });

  it('writes an empty cell for a null, keeping the columns aligned', () => {
    const csv = toCsv([{ name: 'a', hours: null }], columns);
    expect(csv.endsWith('a,')).toBe(true);
  });
});

describe('csvFilename', () => {
  it('dates the file, because these accumulate in a downloads folder', () => {
    expect(csvFilename('hours-worked', new Date(2026, 6, 30))).toBe('hours-worked_2026-07-30.csv');
  });

  it('slugifies, so no caller input reaches the Content-Disposition header', () => {
    // A quote or a newline in this header is header injection, and the filename
    // is the one part of an export a caller can influence.
    expect(csvFilename('Cost by "Department"\n', new Date(2026, 0, 5))).toBe(
      'cost-by-department_2026-01-05.csv'
    );
  });

  it('falls back rather than producing a nameless file', () => {
    expect(csvFilename('***', new Date(2026, 0, 5))).toBe('export_2026-01-05.csv');
  });

  it('uses the LOCAL calendar day', () => {
    // A `Date` at 00:30 in a positive-offset zone is still yesterday in UTC, so
    // a file exported after midnight would be dated the day before.
    const justAfterMidnight = new Date(2026, 6, 30, 0, 30);
    expect(csvFilename('x', justAfterMidnight)).toBe('x_2026-07-30.csv');
  });
});
