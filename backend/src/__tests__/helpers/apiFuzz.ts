/**
 * Test helper: schema-driven request generation and response oracles for the
 * API contract fuzzing suite (#908).
 *
 * WHAT DRIVES GENERATION. Requests are drawn from the JSON Schemas published in
 * `openapi/openapi.json` — which are themselves generated from the shared Zod
 * schemas — so every operation the spec documents is reached without a
 * hand-written case per endpoint. Validity is NOT decided by the generator:
 * each request is judged afterwards by the Zod schema the route actually
 * enforces (see `Judge` below). JSON Schema cannot express Zod refinements
 * (`endDate >= startDate`, cross-field rules), so a generator that called its
 * own output "valid" would report every refinement as a server defect. Letting
 * the real schema decide keeps the oracles sound: a request is held to "must not
 * be rejected as invalid" only if the route's own validator accepts it.
 *
 * WHY NO FUZZING LIBRARY. json-schema-faker or fast-check could draw values,
 * but neither knows that `userId` must name a user that exists, that
 * `expiresAt` is a timestamp although the schema says only `string`, or which
 * boundary dates (leap days, DST switches) have broken date code here before.
 * Those hints are the useful part; the drawing itself is a few dozen lines on
 * the same mulberry32 stream the scheduling property tests use, so a failure
 * replays from one seed.
 *
 * Three classes per operation:
 *   - valid: schema-conforming values, real ids from the seeded database;
 *   - boundary: lengths at the limits, numeric extremes, empty arrays,
 *     unicode, calendar edge dates — judged, not assumed, valid;
 *   - malformed: one mutation of a valid request (wrong type, missing required
 *     field, out of range, oversized, wrong root type, broken JSON).
 *
 * @author Luca Ostinelli
 */

import { createRng } from './scheduleGenerator';

export type Rng = ReturnType<typeof createRng>;
export type JsonSchema = Record<string, any>;
export type CaseClass = 'valid' | 'boundary' | 'malformed';

/** Supplies real values (ids, codes) from the seeded database by field name. */
export interface ValueSource {
  /** A real id for a field or parameter name, or undefined when none is known. */
  idFor(name: string, rng: Rng): number | undefined;
  /** A real string value (permission code, org name …) for a name, if any. */
  stringFor(name: string, rng: Rng): string | undefined;
}

export interface GenContext {
  rng: Rng;
  source: ValueSource;
  /** Resolves a local `#/components/...` reference against the spec. */
  deref: (schema: JsonSchema) => JsonSchema;
  mode: 'valid' | 'boundary';
}

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

// Dates that have broken calendar code: leap days (real and impossible), the
// EU and US DST switches, year ends, and the extremes of MySQL DATE. Fixed
// years far enough ahead that "valid" stays in the future for years, so the
// same seed keeps producing the same outcomes as the calendar moves on.
const BOUNDARY_DATES = [
  '2032-02-29', '2031-02-29', '2031-02-30', '2031-03-30', '2031-10-26',
  '2031-03-09', '2031-11-02', '2031-12-31', '2032-01-01', '1970-01-01',
  '1000-01-01', '9999-12-31', '0000-00-00',
];
const VALID_DATES = ['2031-06-02', '2031-06-16', '2031-07-07', '2031-08-11', '2031-09-15'];
const BOUNDARY_TIMESTAMPS = [
  '2031-03-30T02:30:00+01:00', '2031-10-26T02:30:00+02:00', '2032-02-29T23:59:59Z',
  '2031-12-31T23:59:59.999Z', '1970-01-01T00:00:00Z', '9999-12-31T23:59:59Z', 'next tuesday',
];
const VALID_TIMESTAMPS = [
  '2031-12-31T23:00:00Z', '2031-06-15T08:00:00.000Z', '2031-07-01 09:30:00', '2031-08-01',
];
const BOUNDARY_TIMES = ['00:00', '23:59', '23:59:59', '00:00:00', '12:00', '24:00'];
const VALID_TIMES = ['08:00', '09:00', '13:30', '17:00', '22:00'];
const BOUNDARY_STRINGS = [
  'Zoë Ünïcødé', '日本語のテキスト', 'emoji 😀👩‍⚕️🏳️‍🌈', 'مرحبا بالعالم', 'áé',
  'nul\u0000byte', 'O\'Brien "quoted" \\ back', '<script>alert(1)</script>', '   ', '',
  '‮right-to-left', 'line\nbreak\ttab',
];
const BOUNDARY_INTEGERS = [0, 1, -1, 2_147_483_647, 2_147_483_648, MAX_SAFE, -MAX_SAFE];
const BOUNDARY_NUMBERS = [0, -0, 1e-9, 0.1 + 0.2, 1e308, -1e308, 2_147_483_648.5];

const typesOf = (schema: JsonSchema): string[] =>
  Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];

const word = (rng: Rng): string => `fuzz${rng.int(0, 999_999).toString(36)}`;

/** A string of exactly `len` characters. */
const ofLength = (len: number, rng: Rng): string => {
  let s = '';
  while (s.length < len) s += word(rng);
  return s.slice(0, len);
};

/** Fits a candidate into [minLength, maxLength] when possible. */
const fitLength = (s: string, schema: JsonSchema, rng: Rng): string => {
  const min = schema.minLength ?? 0;
  const max = schema.maxLength ?? Infinity;
  if (s.length < min) return s + ofLength(min - s.length, rng);
  if (s.length > max) return s.slice(0, max);
  return s;
};

/*
 * Field-name hints. The spec types many fields as a bare `string` (dates,
 * expiries, codes): a random word there only ever tests the 400 path, so the
 * name chooses a realistic value instead. Order matters — `startTime` is a
 * time before it is a date.
 */
const hintedString = (name: string, ctx: GenContext): string | undefined => {
  const { rng, mode } = ctx;
  const n = name.toLowerCase();
  const fromSource = ctx.source.stringFor(name, rng);
  if (fromSource !== undefined && (mode === 'valid' || rng.chance(0.5))) return fromSource;
  if (/time$/.test(n) && !/timezone/.test(n)) return rng.pick(mode === 'valid' ? VALID_TIMES : BOUNDARY_TIMES);
  if (/(at|until|expiry|expires)$/.test(n)) return rng.pick(mode === 'valid' ? VALID_TIMESTAMPS : BOUNDARY_TIMESTAMPS);
  if (/date$|^(date|day|start|end|from|to|since|asof|weekstart)$/.test(n)) {
    return rng.pick(mode === 'valid' ? VALID_DATES : BOUNDARY_DATES);
  }
  if (/email/.test(n)) return `${word(rng)}@example.com`;
  if (/(url|uri|endpoint|issuer|callback|redirect)$/.test(n)) return `https://fuzz.invalid/${word(rng)}`;
  if (/timezone|^tz$/.test(n)) return rng.pick(['Europe/Rome', 'America/Los_Angeles', 'Pacific/Auckland', 'UTC']);
  if (/locale|language|^lang$/.test(n)) return rng.pick(['en', 'it', 'en-US']);
  if (/currency/.test(n)) return rng.pick(['EUR', 'USD', 'GBP']);
  if (/colou?r/.test(n)) return '#1a2b3c';
  if (/phone/.test(n)) return '+39 02 1234567';
  if (/password/.test(n)) return 'Fuzz-Password-123!';
  if (/vcard|vcf/.test(n)) return 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Fuzz Person\r\nEMAIL:fuzz.vcard@example.com\r\nEND:VCARD\r\n';
  if (/csv/.test(n)) return 'email,firstName,lastName\r\nfuzz.csv@example.com,Fuzz,Csv\r\n';
  return undefined;
};

const patternString = (pattern: string, name: string, ctx: GenContext): string => {
  const { rng, mode } = ctx;
  if (pattern === '^\\d{4}-\\d{2}-\\d{2}$') return rng.pick(mode === 'valid' ? VALID_DATES : BOUNDARY_DATES);
  if (pattern.startsWith('^([01]\\d|2[0-3])')) return rng.pick(mode === 'valid' ? VALID_TIMES : BOUNDARY_TIMES);
  if (pattern === '^\\d+(,\\d+)*$') {
    const ids = [ctx.source.idFor(name, rng) ?? 1, ctx.source.idFor(name, rng) ?? 2];
    return ids.join(',');
  }
  if (pattern.includes('@')) return `${word(rng)}@example.com`;
  return hintedString(name, ctx) ?? word(rng);
};

const genString = (schema: JsonSchema, name: string, ctx: GenContext): string => {
  const { rng, mode } = ctx;
  if (schema.format === 'email') return `${word(rng)}@example.com`;
  if (schema.format === 'uri' || schema.format === 'url') return `https://fuzz.invalid/${word(rng)}`;
  if (schema.format === 'date') return rng.pick(mode === 'valid' ? VALID_DATES : BOUNDARY_DATES);
  if (schema.format === 'date-time') return rng.pick(mode === 'valid' ? VALID_TIMESTAMPS : BOUNDARY_TIMESTAMPS);
  if (typeof schema.pattern === 'string') return patternString(schema.pattern, name, ctx);
  if (mode === 'boundary') {
    const roll = rng.int(0, 3);
    if (roll === 0 && schema.maxLength !== undefined) return ofLength(Math.min(schema.maxLength, 20_000), rng);
    if (roll === 1) return ofLength(schema.minLength ?? 0, rng);
    if (roll === 2) return rng.pick(BOUNDARY_STRINGS);
  }
  const hinted = hintedString(name, ctx);
  if (hinted !== undefined) return hinted;
  return fitLength(`${word(rng)} ${word(rng)}`, schema, rng);
};

const numericBounds = (schema: JsonSchema, integer: boolean) => {
  const step = integer ? 1 : 1e-6;
  let lo = schema.minimum ?? -MAX_SAFE;
  let hi = schema.maximum ?? MAX_SAFE;
  if (typeof schema.exclusiveMinimum === 'number') lo = Math.max(lo, schema.exclusiveMinimum + step);
  if (typeof schema.exclusiveMaximum === 'number') hi = Math.min(hi, schema.exclusiveMaximum - step);
  return { lo, hi };
};

const genNumber = (schema: JsonSchema, name: string, ctx: GenContext, integer: boolean): number => {
  const { rng, mode } = ctx;
  const { lo, hi } = numericBounds(schema, integer);
  if (integer && /ids?$/i.test(name)) {
    const real = ctx.source.idFor(name, rng);
    if (real !== undefined && (mode === 'valid' || rng.chance(0.5))) return real;
  }
  if (mode === 'boundary') {
    const pool = [lo, hi, ...(integer ? BOUNDARY_INTEGERS : BOUNDARY_NUMBERS)];
    return rng.pick(pool);
  }
  // Realistic magnitudes: a uniform draw over [1, 2^53] is never a valid
  // hour count, percentage or staff number.
  const typicalHi = Math.min(hi, Math.max(lo, 0) + 40);
  const typicalLo = Math.max(lo, Math.min(typicalHi, 0));
  const v = typicalLo + rng.next() * (typicalHi - typicalLo);
  return integer ? Math.round(v) : Math.round(v * 100) / 100;
};

/** Draws one value conforming (in valid mode) to `schema`. */
export const generate = (raw: JsonSchema, name: string, ctx: GenContext, depth = 0): unknown => {
  const schema = ctx.deref(raw);
  const { rng, mode } = ctx;
  if ('const' in schema) return schema.const;
  if (Array.isArray(schema.enum)) return rng.pick(schema.enum);
  const variants = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(variants)) {
    const nonNull = variants.filter((v: JsonSchema) => ctx.deref(v).type !== 'null');
    const pickNull = nonNull.length < variants.length && rng.chance(mode === 'valid' ? 0.15 : 0.3);
    if (pickNull || nonNull.length === 0) return null;
    return generate(rng.pick(nonNull), name, ctx, depth);
  }
  if (Array.isArray(schema.allOf)) {
    return generate(Object.assign({}, ...schema.allOf.map((s: JsonSchema) => ctx.deref(s))), name, ctx, depth);
  }
  const types = typesOf(schema).filter((t) => t !== 'null');
  const type = types.length ? rng.pick(types) : schema.properties ? 'object' : schema.items ? 'array' : 'string';
  switch (type) {
    case 'string':
      return genString(schema, name, ctx);
    case 'integer':
      return genNumber(schema, name, ctx, true);
    case 'number':
      return genNumber(schema, name, ctx, false);
    case 'boolean':
      return rng.chance(0.5);
    case 'array': {
      const min = schema.minItems ?? 0;
      const max = Math.min(schema.maxItems ?? min + 3, min + 3, 200);
      let len = rng.int(min, Math.max(min, max));
      if (mode === 'boundary') len = rng.pick([min, Math.min(schema.maxItems ?? 50, 200)]);
      const itemName = name.replace(/s$/, '');
      return Array.from({ length: len }, () => generate(schema.items ?? {}, itemName, ctx, depth + 1));
    }
    case 'object': {
      const out: Record<string, unknown> = {};
      const required = new Set<string>(schema.required ?? []);
      for (const [key, sub] of Object.entries<JsonSchema>(schema.properties ?? {})) {
        const include = required.has(key) || (depth < 4 && rng.chance(mode === 'boundary' ? 0.8 : 0.5));
        if (include) out[key] = generate(sub, key, ctx, depth + 1);
      }
      if (schema.additionalProperties && typeof schema.additionalProperties === 'object' && !schema.properties) {
        for (let i = rng.int(0, 2); i > 0; i -= 1) {
          out[word(rng)] = generate(schema.additionalProperties, name, ctx, depth + 1);
        }
      }
      return out;
    }
    default:
      return null;
  }
};

// ── Malformed mutations ──────────────────────────────────────────────────────

const WRONG_TYPE_VALUES: unknown[] = ['not-a-number', 12345, true, null, [], {}, 1.5, '', [1, 'two'], { nested: { deep: true } }];

const wrongTypeFor = (schema: JsonSchema, rng: Rng): unknown => {
  const types = typesOf(schema);
  const candidates = WRONG_TYPE_VALUES.filter((v) => {
    const t = v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'number' && Number.isInteger(v) ? 'integer' : typeof v;
    return !types.includes(t) && !(t === 'integer' && types.includes('number'));
  });
  return rng.pick(candidates.length ? candidates : WRONG_TYPE_VALUES);
};

export interface Mutation {
  /** Short label of what was broken, printed in the failure report. */
  label: string;
  value: unknown;
  /** When set, the body is sent as this raw text instead of JSON-encoding `value`. */
  raw?: string;
}

/**
 * One mutation of a valid object body. The label names the field, so a
 * failure says what was broken without diffing two payloads.
 */
export const mutateBody = (raw: JsonSchema, valid: unknown, ctx: GenContext): Mutation => {
  const { rng } = ctx;
  const schema = ctx.deref(raw);
  const props = Object.entries<JsonSchema>(schema.properties ?? {}).map(([k, s]) => [k, ctx.deref(s)] as const);
  const base = valid && typeof valid === 'object' && !Array.isArray(valid) ? { ...(valid as Record<string, unknown>) } : {};
  const required: string[] = schema.required ?? [];
  const kinds = ['wrong-type', 'extra-field', 'root-type', 'broken-json', 'oversized-string', 'oversized-array', 'out-of-range', 'bad-enum', 'bad-format', 'huge-body', 'proto-key'];
  if (required.length) kinds.push('missing-required', 'missing-required');
  if (props.length) kinds.push('wrong-type', 'wrong-type');
  const kind = rng.pick(kinds);
  const pickProp = (pred: (s: JsonSchema) => boolean) => {
    const matching = props.filter(([, s]) => pred(s));
    return matching.length ? rng.pick(matching) : undefined;
  };
  switch (kind) {
    case 'missing-required': {
      const key = rng.pick(required);
      delete base[key];
      return { label: `missing required '${key}'`, value: base };
    }
    case 'wrong-type': {
      const prop = pickProp(() => true);
      if (!prop) break;
      base[prop[0]] = wrongTypeFor(prop[1], rng);
      return { label: `wrong type for '${prop[0]}'`, value: base };
    }
    case 'oversized-string': {
      const prop = pickProp((s) => typesOf(s).includes('string') || (s.anyOf ?? []).some((v: JsonSchema) => v.type === 'string'));
      if (!prop) break;
      const max = prop[1].maxLength ?? (prop[1].anyOf ?? []).find((v: JsonSchema) => v.maxLength)?.maxLength;
      base[prop[0]] = 'x'.repeat(max !== undefined ? max + 1 : 1_000_000);
      return { label: `oversized string '${prop[0]}' (${max !== undefined ? `maxLength+1` : '1 MB'})`, value: base };
    }
    case 'oversized-array': {
      const prop = pickProp((s) => typesOf(s).includes('array'));
      if (!prop) break;
      const max: number | undefined = prop[1].maxItems;
      const n = max !== undefined ? max + 1 : 5_000;
      // With a maxItems, repeat a valid element so only the length is wrong.
      // Without one, use elements of the wrong type so the schema still
      // rejects the array rather than the server processing 5000 rows.
      const sample = Array.isArray(base[prop[0]]) ? (base[prop[0]] as unknown[])[0] : undefined;
      const element = max !== undefined && sample !== undefined ? sample : wrongTypeFor(ctx.deref(prop[1].items ?? {}), rng);
      base[prop[0]] = Array.from({ length: n }, () => element);
      return { label: `oversized array '${prop[0]}' (${n} items)`, value: base };
    }
    case 'out-of-range': {
      const prop = pickProp((s) => typesOf(s).includes('integer') || typesOf(s).includes('number'));
      if (!prop) break;
      const integer = typesOf(prop[1]).includes('integer');
      const { lo, hi } = numericBounds(prop[1], integer);
      base[prop[0]] = rng.pick(integer ? [lo - 1, hi + 1, 1.5] : [lo - 1, hi + 1]);
      return { label: `out of range '${prop[0]}'`, value: base };
    }
    case 'bad-enum': {
      const prop = pickProp((s) => Array.isArray(s.enum));
      if (!prop) break;
      base[prop[0]] = 'not-an-allowed-value';
      return { label: `value outside enum '${prop[0]}'`, value: base };
    }
    case 'bad-format': {
      const prop = pickProp((s) => typeof s.pattern === 'string' || typeof s.format === 'string');
      if (!prop) break;
      base[prop[0]] = rng.pick(['2026-13-45', 'not-a-date', '25:61', '2026-02-30T25:00:00Z', 'not an email', 'javascript:alert(1)']);
      return { label: `bad format '${prop[0]}'`, value: base };
    }
    case 'extra-field':
      return { label: 'unknown extra field', value: { ...base, fuzzUnknownField: 'x', id: 999_999 } };
    case 'proto-key':
      return {
        label: '__proto__ / constructor keys',
        value: base,
        raw: JSON.stringify(base).replace(/^\{/, '{"__proto__":{"isAdmin":true},"constructor":{"prototype":{"polluted":true}},').replace(/,\}$/, '}'),
      };
    case 'huge-body':
      // Inside the 10 MB body limit, so the parser accepts it and the route sees it.
      return { label: 'huge body (8 MB padding field)', value: { ...base, fuzzPadding: 'x'.repeat(8 * 1024 * 1024) } };
    case 'broken-json':
      return { label: 'syntactically broken JSON', value: undefined, raw: '{"unterminated": [1, 2' };
    default:
      break;
  }
  return { label: 'wrong root type', value: rng.pick([[], 'a string body', 42, null, [base]]) };
};

/** One mutation of a valid query object (values are strings, as on the wire). */
export const mutateQuery = (
  params: Array<{ name: string; required?: boolean; schema: JsonSchema }>,
  valid: Record<string, string | string[]>,
  ctx: GenContext
): Mutation => {
  const { rng } = ctx;
  const out: Record<string, string | string[]> = { ...valid };
  const required = params.filter((p) => p.required);
  if (required.length && rng.chance(0.25)) {
    const p = rng.pick(required);
    delete out[p.name];
    return { label: `missing required query '${p.name}'`, value: out };
  }
  const p = rng.pick(params);
  const s = ctx.deref(p.schema);
  const types = typesOf(s);
  const choices: Array<[string, string | string[]]> = [
    ['repeated parameter', ['1', '2']],
    ['oversized value', 'x'.repeat(8_000)],
    ['empty value', ''],
  ];
  if (types.includes('integer') || types.includes('number')) {
    choices.push(['non-numeric', 'abc'], ['negative', '-5'], ['fractional', '1.5'], ['overflow', '99999999999999999999999'], ['exponent', '1e999']);
  }
  if (Array.isArray(s.enum)) choices.push(['value outside enum', 'not-an-allowed-value']);
  if (typeof s.pattern === 'string') choices.push(['bad format', '2026-13-45'], ['bad format', 'not-a-date']);
  if (types.includes('boolean')) choices.push(['non-boolean', 'maybe']);
  const [label, value] = rng.pick(choices);
  out[p.name] = value;
  return { label: `${label} for query '${p.name}'`, value: out };
};

/** A malformed value for an integer path parameter. */
export const malformedPathId = (rng: Rng): string =>
  rng.pick(['abc', '0', '-1', '1.5', '99999999999999999999', '1e3', '%20', "1' OR '1'='1", '2147483648']);

/** Serialises a query object the way a browser would, repeating array keys. */
export const toQueryString = (query: Record<string, string | string[]>): string => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    for (const item of Array.isArray(v) ? v : [v]) sp.append(k, item);
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
};

/** Stringifies a generated query value the way it travels on the wire. */
export const queryValue = (v: unknown): string | string[] =>
  Array.isArray(v) ? v.map(String) : v === null || v === undefined ? '' : String(v);

// ── Response oracles ────────────────────────────────────────────────────────

/*
 * What an internal fault looks like when it escapes into a response: mysql2
 * error codes and messages, stack frames, SQL text. Checked on error bodies
 * only — a success body legitimately echoes whatever the fuzzer stored,
 * including strings that look like SQL.
 */
const LEAK_PATTERNS: Array<[string, RegExp]> = [
  ['mysql error code', /\bER_[A-Z_]{4,}\b/],
  ['mysql error field', /"(sqlMessage|sqlState|sql|errno)"\s*:/],
  ['SQL syntax message', /You have an error in your SQL syntax|Incorrect \w+ value:|Duplicate entry '/],
  ['stack trace', /\bat [\w.<>]+ \([^)]*:\d+:\d+\)|"stack"\s*:/],
  ['raw SQL', /\b(SELECT|INSERT INTO|UPDATE|DELETE FROM)\b[^"]{0,120}\b(FROM|WHERE|VALUES|SET)\b/],
];

export const findLeak = (text: string): string | undefined =>
  LEAK_PATTERNS.find(([, re]) => re.test(text))?.[0];

/** Truncates a payload for the failure report so an 8 MB body stays readable. */
export const preview = (value: unknown, max = 600): string => {
  let s: string;
  try {
    s = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    s = String(value);
  }
  if (s === undefined) return 'undefined';
  return s.length > max ? `${s.slice(0, max)}… (${s.length} chars)` : s;
};
