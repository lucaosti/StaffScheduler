/**
 * vCard 4.0 (RFC 6350) reader/writer.
 *
 * Pure functions only. Input is the contents of a `.vcf` file or the
 * fields of a single contact; output is RFC-compliant text or a parsed
 * object. We intentionally keep the surface narrow (FN, N, EMAIL, TEL,
 * TITLE, ORG, NOTE, and `X-` extensions for custom fields) — the goal
 * is interoperability with phone address books, not full vCard.
 *
 * @author Luca Ostinelli
 */

export interface VCard {
  fn: string;
  givenName?: string;
  familyName?: string;
  email?: string;
  phone?: string;
  title?: string;
  org?: string;
  note?: string;
  /** Extra RFC-style key/value pairs (e.g. {"X-EMPLOYEE-ID": "E-001"}). */
  extra?: Record<string, string>;
}

const escape = (value: string): string =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');

const unescape = (value: string): string =>
  value
    .replace(/\\n/g, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');

/**
 * RFC 5545 / RFC 6350 line folding: lines longer than 75 octets are
 * wrapped at 75 chars with a CRLF + single-space continuation.
 */
const fold = (line: string): string => {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let i = 0;
  parts.push(line.slice(0, 75));
  i = 75;
  while (i < line.length) {
    parts.push(' ' + line.slice(i, i + 74));
    i += 74;
  }
  return parts.join('\r\n');
};

/** Builds the text body of a single vCard 4.0 object. */
export const buildVCard = (card: VCard): string => {
  const lines: string[] = ['BEGIN:VCARD', 'VERSION:4.0'];
  lines.push(fold(`FN:${escape(card.fn)}`));
  if (card.familyName || card.givenName) {
    lines.push(
      fold(
        `N:${escape(card.familyName ?? '')};${escape(card.givenName ?? '')};;;`
      )
    );
  }
  if (card.email) lines.push(fold(`EMAIL:${escape(card.email)}`));
  if (card.phone) lines.push(fold(`TEL;TYPE=cell:${escape(card.phone)}`));
  if (card.title) lines.push(fold(`TITLE:${escape(card.title)}`));
  if (card.org) lines.push(fold(`ORG:${escape(card.org)}`));
  if (card.note) lines.push(fold(`NOTE:${escape(card.note)}`));
  if (card.extra) {
    for (const [key, value] of Object.entries(card.extra)) {
      const k = key.startsWith('X-') ? key : `X-${key.toUpperCase().replace(/[^A-Z0-9]/g, '-')}`;
      lines.push(fold(`${k}:${escape(value)}`));
    }
  }
  lines.push('END:VCARD');
  return lines.join('\r\n') + '\r\n';
};

/** Concatenates multiple vCards into a single .vcf payload. */
export const buildVcfFile = (cards: VCard[]): string => cards.map(buildVCard).join('');

/** Parses a multi-card .vcf payload into an array of VCard objects. */
export const parseVcf = (text: string): VCard[] => {
  // Unfold first.
  const unfolded = text.replace(/\r?\n[ \t]/g, '');
  const lines = unfolded.split(/\r?\n/);
  const cards: VCard[] = [];
  let current: VCard | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line === 'BEGIN:VCARD') {
      current = { fn: '' };
      continue;
    }
    if (line === 'END:VCARD') {
      if (current && current.fn) cards.push(current);
      current = null;
      continue;
    }
    if (!current) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const head = line.slice(0, colon);
    const value = unescape(line.slice(colon + 1));
    const propName = head.split(';')[0].toUpperCase();
    switch (propName) {
      case 'FN':
        current.fn = value;
        break;
      case 'N': {
        const parts = value.split(/(?<!\\);/);
        current.familyName = parts[0] ?? '';
        current.givenName = parts[1] ?? '';
        break;
      }
      case 'EMAIL':
        current.email = value;
        break;
      case 'TEL':
        current.phone = value;
        break;
      case 'TITLE':
        current.title = value;
        break;
      case 'ORG':
        current.org = value;
        break;
      case 'NOTE':
        current.note = value;
        break;
      case 'VERSION':
        // Ignored; we accept any 4.x but don't validate strictly.
        break;
      default:
        if (propName.startsWith('X-')) {
          current.extra = { ...(current.extra ?? {}), [propName]: value };
        }
    }
  }
  return cards;
};
