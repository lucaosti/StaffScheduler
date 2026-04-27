/**
 * vCard 4.0 builder + parser tests (F22).
 */

import { buildVCard, buildVcfFile, parseVcf } from '../utils/vcard';

describe('buildVCard', () => {
  it('produces a minimal RFC 6350 envelope with FN', () => {
    const out = buildVCard({ fn: 'Anna Demo' });
    expect(out).toMatch(/^BEGIN:VCARD\r\n/);
    expect(out).toMatch(/VERSION:4\.0/);
    expect(out).toMatch(/FN:Anna Demo/);
    expect(out).toMatch(/END:VCARD\r\n$/);
  });

  it('escapes ; , and newline in field values', () => {
    const out = buildVCard({ fn: 'A,B', note: 'line1\nline2; end' });
    expect(out).toContain('FN:A\\,B');
    expect(out).toContain('NOTE:line1\\nline2\\; end');
  });

  it('emits N when given names are present', () => {
    const out = buildVCard({ fn: 'Anna Demo', givenName: 'Anna', familyName: 'Demo' });
    expect(out).toContain('N:Demo;Anna;;;');
  });

  it('namespaces extra keys with X- and uppercases them', () => {
    const out = buildVCard({ fn: 'X', extra: { 'employee id': '7', 'X-ROLE': 'admin' } });
    expect(out).toContain('X-EMPLOYEE-ID:7');
    expect(out).toContain('X-ROLE:admin');
  });

  it('folds long lines at 75 octets with CRLF + space continuation', () => {
    const long = 'a'.repeat(120);
    const out = buildVCard({ fn: long });
    const fn = out.split('\r\n').filter((l) => l.startsWith('FN:') || l.startsWith(' '));
    expect(fn[0].length).toBe(75);
    expect(fn[1].startsWith(' ')).toBe(true);
  });
});

describe('parseVcf', () => {
  it('parses a minimal VCARD', () => {
    const text = 'BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Anna Demo\r\nEMAIL:a@x.com\r\nEND:VCARD\r\n';
    const cards = parseVcf(text);
    expect(cards).toHaveLength(1);
    expect(cards[0].fn).toBe('Anna Demo');
    expect(cards[0].email).toBe('a@x.com');
  });

  it('round-trips a card through build → parse', () => {
    const original = {
      fn: 'Anna Demo',
      givenName: 'Anna',
      familyName: 'Demo',
      email: 'a@x.com',
      phone: '+39 000 0000000',
      title: 'Nurse',
      org: 'Staff Scheduler',
      note: 'multi\nline; note',
      extra: { 'X-EMPLOYEE-ID': 'E-007', 'X-ROLE': 'employee' },
    };
    const text = buildVCard(original);
    const [parsed] = parseVcf(text);
    expect(parsed.fn).toBe(original.fn);
    expect(parsed.email).toBe(original.email);
    expect(parsed.phone).toBe(original.phone);
    expect(parsed.note).toBe(original.note);
    expect(parsed.familyName).toBe('Demo');
    expect(parsed.givenName).toBe('Anna');
    expect(parsed.extra?.['X-EMPLOYEE-ID']).toBe('E-007');
  });

  it('reads multiple cards from a single .vcf payload', () => {
    const text = buildVcfFile([{ fn: 'A' }, { fn: 'B' }, { fn: 'C' }]);
    expect(parseVcf(text)).toHaveLength(3);
  });

  it('unfolds folded long lines', () => {
    const text =
      'BEGIN:VCARD\r\nVERSION:4.0\r\nFN:abcdefghi\r\n jklmnop\r\nEND:VCARD\r\n';
    const [card] = parseVcf(text);
    expect(card.fn).toBe('abcdefghijklmnop');
  });

  it('ignores cards with no FN', () => {
    const text =
      'BEGIN:VCARD\r\nVERSION:4.0\r\nEMAIL:x@y.com\r\nEND:VCARD\r\nBEGIN:VCARD\r\nFN:Real\r\nEND:VCARD\r\n';
    const cards = parseVcf(text);
    expect(cards).toHaveLength(1);
    expect(cards[0].fn).toBe('Real');
  });
});
