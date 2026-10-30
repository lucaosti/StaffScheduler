/**
 * Unit tests for the API fuzzing helpers (#908), so a defect in the generator
 * or an oracle shows up here rather than as a confusing result of the
 * integration campaign that relies on them.
 *
 * @author Luca Ostinelli
 */

import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { createRng } from './helpers/scheduleGenerator';
import { findLeak, generate, mutateBody, mutateQuery, toQueryString, type GenContext, type JsonSchema } from './helpers/apiFuzz';

const source = {
  idFor: (name: string) => (/userId$/.test(name) ? 7 : undefined),
  stringFor: () => undefined,
};
const ctx = (seed: number, mode: 'valid' | 'boundary' = 'valid'): GenContext => ({
  rng: createRng(seed),
  source,
  deref: (s) => s,
  mode,
});

const BODY: JsonSchema = {
  type: 'object',
  required: ['userId', 'startDate', 'kind'],
  properties: {
    userId: { type: 'integer', exclusiveMinimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    startDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    kind: { type: 'string', enum: ['a', 'b'] },
    note: { anyOf: [{ type: 'string', maxLength: 20 }, { type: 'null' }] },
    tags: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 10 }, maxItems: 3 },
    hours: { type: 'number', minimum: 0, maximum: 24 },
  },
};

const ajv = new Ajv2020({ strict: false });
addFormats(ajv);
const conforms = ajv.compile(BODY);

describe('apiFuzz generator', () => {
  it('is deterministic for a seed', () => {
    expect(generate(BODY, 'body', ctx(1))).toEqual(generate(BODY, 'body', ctx(1)));
    expect(generate(BODY, 'body', ctx(1))).not.toEqual(generate(BODY, 'body', ctx(2)));
  });

  it('draws schema-conforming values in valid mode, with real ids for id fields', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const value = generate(BODY, 'body', ctx(seed)) as Record<string, unknown>;
      expect(conforms(value)).toBe(true);
      expect(value.userId).toBe(7);
    }
  });

  it('reaches the limits in boundary mode', () => {
    const lengths = new Set<number>();
    for (let seed = 0; seed < 200; seed += 1) {
      lengths.add((generate({ type: 'string', minLength: 2, maxLength: 9 }, 'x', ctx(seed, 'boundary')) as string).length);
    }
    expect(lengths.has(2)).toBe(true);
    expect(lengths.has(9)).toBe(true);
  });

  it('turns a valid body into an invalid one with each mutation it labels as a schema break', () => {
    const breaking = /missing required|wrong type for 'userId'|value outside enum|oversized array|wrong root type|out of range 'userId'/;
    let seen = 0;
    for (let seed = 0; seed < 300; seed += 1) {
      const valid = generate(BODY, 'body', ctx(seed));
      const m = mutateBody(BODY, valid, ctx(seed + 10_000));
      if (!breaking.test(m.label)) continue;
      seen += 1;
      expect({ label: m.label, conforms: conforms(m.value) }).toEqual({ label: m.label, conforms: false });
    }
    expect(seen).toBeGreaterThan(50);
  });

  it('mutates a query parameter and serialises repeated keys', () => {
    const m = mutateQuery([{ name: 'page', schema: { type: 'integer' } }], { page: '2' }, ctx(3));
    expect(m.label).toMatch(/query 'page'/);
    expect(toQueryString({ a: ['1', '2'], b: 'x y' })).toBe('?a=1&a=2&b=x+y');
    expect(toQueryString({})).toBe('');
  });
});

describe('apiFuzz leak oracle', () => {
  it.each([
    ['{"error":{"message":"ER_TRUNCATED_WRONG_VALUE: Incorrect datetime value"}}', 'mysql error code'],
    ['{"sqlMessage":"x"}', 'mysql error field'],
    ['{"message":"at Object.<anonymous> (/app/src/x.ts:10:5)"}', 'stack trace'],
    ['{"message":"SELECT id FROM users WHERE id = 1"}', 'raw SQL'],
  ])('flags %s', (text, kind) => {
    expect(findLeak(text)).toBe(kind);
  });

  it('passes an ordinary error envelope', () => {
    expect(findLeak('{"success":false,"error":{"code":"NOT_FOUND","message":"User not found"}}')).toBeUndefined();
  });
});
