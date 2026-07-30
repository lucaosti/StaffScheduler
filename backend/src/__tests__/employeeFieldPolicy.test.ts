/**
 * Per-organization employee field rules.
 *
 * Two of these cases are the whole feature's safety:
 *
 *  - the ALLOWLIST. A policy table that could name any column would let a
 *    configuration change — not a deploy, not a review — make `password_hash` a
 *    visible directory field. The refusal is the security boundary.
 *  - WRITE-ONLY enforcement, and the partial-update case in particular. If
 *    switching on "phone is required" made every partial update of a record
 *    without one fail, the first time anyone enabled it they would lock the
 *    existing directory out of being fixed — which is the record most in need
 *    of updating.
 *
 * @author Luca Ostinelli
 */

import {
  EmployeeFieldPolicyService,
  GOVERNABLE_CORE_FIELDS,
  assertPolicies,
  checkAgainstPolicies,
  isGovernableField,
  type FieldPolicy,
} from '../services/EmployeeFieldPolicyService';

export {};

const policy = (over: Partial<FieldPolicy> = {}): FieldPolicy => ({
  fieldKey: 'phone',
  isRequired: false,
  visiblePermission: null,
  editPermission: null,
  minLength: null,
  maxLength: null,
  minValue: null,
  maxValue: null,
  pattern: null,
  allowedValues: null,
  helpText: null,
  ...over,
});

describe('which fields a policy may govern', () => {
  it('accepts every core field on the allowlist', () => {
    for (const field of GOVERNABLE_CORE_FIELDS) {
      expect(isGovernableField(field)).toBe(true);
    }
  });

  it('refuses a column that is not on it', () => {
    // The security boundary. Each of these is a column that exists.
    expect(isGovernableField('password_hash')).toBe(false);
    expect(isGovernableField('totp_secret')).toBe(false);
    expect(isGovernableField('totp_recovery_codes')).toBe(false);
    expect(isGovernableField('is_active')).toBe(false);
  });

  it('accepts a well-formed custom key', () => {
    // Custom fields are arbitrary by construction — they hold data an
    // administrator entered — so the only question is the shape of the key.
    expect(isGovernableField('custom:badge_number')).toBe(true);
    expect(isGovernableField('custom:emergency-contact')).toBe(true);
  });

  it('refuses a malformed custom key', () => {
    expect(isGovernableField('custom:')).toBe(false);
    expect(isGovernableField('custom:has spaces')).toBe(false);
    expect(isGovernableField(`custom:${'x'.repeat(65)}`)).toBe(false);
  });
});

describe('required fields', () => {
  it('refuses a create that omits one', () => {
    const violations = checkAgainstPolicies({}, [policy({ isRequired: true })]);
    expect(violations).toEqual([{ field: 'phone', message: 'phone is required' }]);
  });

  it('refuses an empty string as much as an absent value', () => {
    // "" is what a form sends for a field someone tabbed past.
    expect(checkAgainstPolicies({ phone: '' }, [policy({ isRequired: true })])).toHaveLength(1);
    expect(checkAgainstPolicies({ phone: null }, [policy({ isRequired: true })])).toHaveLength(1);
  });

  it('ignores a field an UPDATE does not mention', () => {
    // Absent from a partial body means "not being changed", not "being
    // cleared". Refusing here would make every partial update of an incomplete
    // record impossible.
    const violations = checkAgainstPolicies({ position: 'Nurse' }, [policy({ isRequired: true })], {
      isPartial: true,
    });
    expect(violations).toEqual([]);
  });

  it('still refuses an update that CLEARS a required field', () => {
    const violations = checkAgainstPolicies({ phone: '' }, [policy({ isRequired: true })], {
      isPartial: true,
    });
    expect(violations).toHaveLength(1);
  });

  it('uses the help text instead of the machine wording when there is one', () => {
    // "must match ^[A-Z]{2}\\d{4}$" is not something to put in front of a person.
    const violations = checkAgainstPolicies({}, [
      policy({ isRequired: true, helpText: 'We need a number to reach you on shift.' }),
    ]);
    expect(violations[0].message).toBe('We need a number to reach you on shift.');
  });
});

describe('validation rules', () => {
  it('checks lengths', () => {
    expect(checkAgainstPolicies({ phone: 'abc' }, [policy({ minLength: 5 })])).toHaveLength(1);
    expect(checkAgainstPolicies({ phone: 'abcdefg' }, [policy({ maxLength: 5 })])).toHaveLength(1);
    expect(checkAgainstPolicies({ phone: 'abcde' }, [policy({ minLength: 5, maxLength: 5 })])).toEqual([]);
  });

  it('checks numeric bounds', () => {
    const rate = policy({ fieldKey: 'hourlyRate', minValue: 10, maxValue: 50 });
    expect(checkAgainstPolicies({ hourlyRate: 5 }, [rate])).toHaveLength(1);
    expect(checkAgainstPolicies({ hourlyRate: 60 }, [rate])).toHaveLength(1);
    expect(checkAgainstPolicies({ hourlyRate: 25 }, [rate])).toEqual([]);
  });

  it('refuses a non-numeric value where a bound applies', () => {
    const violations = checkAgainstPolicies({ hourlyRate: 'ten' }, [
      policy({ fieldKey: 'hourlyRate', minValue: 1 }),
    ]);
    expect(violations[0].message).toMatch(/must be a number/);
  });

  it('checks a closed vocabulary', () => {
    const p = policy({ fieldKey: 'position', allowedValues: ['Nurse', 'Doctor'] });
    expect(checkAgainstPolicies({ position: 'Porter' }, [p])).toHaveLength(1);
    expect(checkAgainstPolicies({ position: 'Nurse' }, [p])).toEqual([]);
  });

  it('checks a pattern', () => {
    const p = policy({ fieldKey: 'employeeId', pattern: '^[A-Z]{2}\\d{4}$' });
    expect(checkAgainstPolicies({ employeeId: 'ab1234' }, [p])).toHaveLength(1);
    expect(checkAgainstPolicies({ employeeId: 'AB1234' }, [p])).toEqual([]);
  });

  it('skips a stored pattern that no longer compiles, rather than refusing everything', () => {
    // A broken pattern must not become a silent block on every write, with no
    // clue in the refusal about where it came from.
    const violations = checkAgainstPolicies({ phone: 'anything' }, [policy({ pattern: '([' })]);
    expect(violations).toEqual([]);
  });

  it('reports EVERY violation, not the first', () => {
    // A form that rejects one field at a time makes someone submit four times
    // to learn four things.
    const violations = checkAgainstPolicies({ phone: 'x', hourlyRate: 500 }, [
      policy({ minLength: 5 }),
      policy({ fieldKey: 'hourlyRate', maxValue: 100 }),
    ]);
    expect(violations.map((v) => v.field)).toEqual(['phone', 'hourlyRate']);
  });

  it('leaves an absent optional field alone', () => {
    expect(checkAgainstPolicies({}, [policy({ minLength: 5, pattern: '^x' })])).toEqual([]);
  });
});

describe('edit permission', () => {
  it('refuses a caller who lacks it, rather than dropping the field', () => {
    // A write that appears to succeed and silently does nothing is the worse
    // failure, and the caller has no way to discover it.
    const violations = checkAgainstPolicies({ hourlyRate: 30 }, [
      policy({ fieldKey: 'hourlyRate', editPermission: 'payroll.manage' }),
    ], { callerPermissions: ['employee.manage'] });

    expect(violations).toHaveLength(1);
    expect(violations[0].message).toMatch(/not allowed to change hourlyRate/);
  });

  it('allows a caller who holds it', () => {
    const violations = checkAgainstPolicies({ hourlyRate: 30 }, [
      policy({ fieldKey: 'hourlyRate', editPermission: 'payroll.manage' }),
    ], { callerPermissions: ['payroll.manage'] });
    expect(violations).toEqual([]);
  });

  it('does not fire for a field the caller is not touching', () => {
    const violations = checkAgainstPolicies({ phone: '123' }, [
      policy({ fieldKey: 'hourlyRate', editPermission: 'payroll.manage' }),
    ], { callerPermissions: [] });
    expect(violations).toEqual([]);
  });
});

describe('custom fields', () => {
  it('are matched by their key without the prefix', () => {
    const violations = checkAgainstPolicies({ badge: '' }, [
      policy({ fieldKey: 'custom:badge', isRequired: true }),
    ]);
    expect(violations).toEqual([{ field: 'badge', message: 'badge is required' }]);
  });
});

describe('assertPolicies', () => {
  it('says nothing when there is nothing to say', () => {
    expect(() => assertPolicies([])).not.toThrow();
  });

  it('names every field in one refusal', () => {
    expect(() =>
      assertPolicies([
        { field: 'phone', message: 'phone is required' },
        { field: 'position', message: 'position is required' },
      ])
    ).toThrow(/phone.*position/);
  });
});

describe('storing a policy', () => {
  const makePool = () => {
    const execute = jest.fn().mockResolvedValue([{ affectedRows: 1 }]);
    const query = jest.fn().mockResolvedValue([[], []]);
    return { pool: { execute, query } as never, execute, query };
  };

  const input = (over: Record<string, unknown> = {}) => ({
    organizationName: null,
    fieldKey: 'phone',
    isRequired: true,
    visiblePermission: null,
    editPermission: null,
    minLength: null,
    maxLength: null,
    minValue: null,
    maxValue: null,
    pattern: null,
    allowedValues: null,
    helpText: null,
    ...over,
  }) as Parameters<EmployeeFieldPolicyService['upsert']>[0];

  it('refuses a field outside the allowlist', async () => {
    const { pool, execute } = makePool();
    await expect(new EmployeeFieldPolicyService(pool).upsert(input({ fieldKey: 'password_hash' })))
      .rejects.toThrow(/cannot be governed/);
    expect(execute).not.toHaveBeenCalled();
  });

  it('refuses a pattern that does not compile, at write time', async () => {
    // Stored now, it would refuse every write later with no clue where it came
    // from — so it is caught where the person who typed it is still looking.
    const { pool } = makePool();
    await expect(new EmployeeFieldPolicyService(pool).upsert(input({ pattern: '([' })))
      .rejects.toThrow(/not a valid regular expression/);
  });

  it('refuses an over-long pattern', async () => {
    const { pool } = makePool();
    await expect(new EmployeeFieldPolicyService(pool).upsert(input({ pattern: 'a'.repeat(201) })))
      .rejects.toThrow(/at most 200 characters/);
  });

  it('forces email required, whatever the policy says', async () => {
    const { pool, execute } = makePool();
    await new EmployeeFieldPolicyService(pool).upsert(input({ fieldKey: 'email', isRequired: false }));

    // Corrected rather than refused: someone may legitimately want a row here
    // for its validation or visibility rule, and a stored `isRequired: false`
    // would be configuration claiming something the system does not do.
    expect(execute.mock.calls[0][1][2]).toBe(true);
  });

  it('leaves an ordinary field as the policy asked', async () => {
    const { pool, execute } = makePool();
    await new EmployeeFieldPolicyService(pool).upsert(input({ fieldKey: 'phone', isRequired: false }));
    expect(execute.mock.calls[0][1][2]).toBe(false);
  });

  it('reads a JSON vocabulary the driver already parsed', async () => {
    const { pool, query } = makePool();
    query.mockResolvedValue([[{ field_key: 'position', allowed_values: ['Nurse'] }], []]);

    const [policy] = await new EmployeeFieldPolicyService(pool).listForOrganization(null);
    expect(policy.allowedValues).toEqual(['Nurse']);
  });

  it('reads one the driver handed back as a string', async () => {
    const { pool, query } = makePool();
    query.mockResolvedValue([[{ field_key: 'position', allowed_values: '["Nurse"]' }], []]);

    const [policy] = await new EmployeeFieldPolicyService(pool).listForOrganization(null);
    expect(policy.allowedValues).toEqual(['Nurse']);
  });

  it('treats a non-array JSON value as no vocabulary at all', async () => {
    const { pool, query } = makePool();
    query.mockResolvedValue([[{ field_key: 'position', allowed_values: '{}' }], []]);

    // Better than crashing the whole policy list over one malformed row.
    const [policy] = await new EmployeeFieldPolicyService(pool).listForOrganization(null);
    expect(policy.allowedValues).toBeNull();
  });

  it('reports whether a removal matched anything', async () => {
    const { pool, execute } = makePool();
    const service = new EmployeeFieldPolicyService(pool);

    expect(await service.remove('Acme', 'phone')).toBe(true);
    execute.mockResolvedValue([{ affectedRows: 0 }]);
    expect(await service.remove('Acme', 'phone')).toBe(false);
  });

  it('matches the global row by treating NULL as the empty organization', async () => {
    const { pool, execute } = makePool();
    await new EmployeeFieldPolicyService(pool).remove(null, 'phone');

    // NULL never equals NULL in SQL, so a plain `= ?` would never delete the
    // global row and the caller would be told nothing was there.
    expect(execute.mock.calls[0][0]).toContain("COALESCE(organization_name, '')");
  });

  it('stores a valid one', async () => {
    const { pool, execute } = makePool();
    await new EmployeeFieldPolicyService(pool).upsert(input({ allowedValues: ['a', 'b'] }));

    expect(execute).toHaveBeenCalledTimes(1);
    // The vocabulary is JSON-encoded on the way in, since the column is JSON.
    expect(execute.mock.calls[0][1]).toContain('["a","b"]');
  });

  it('prefers the organization row over the global one for the same field', async () => {
    const { pool, query } = makePool();
    query.mockResolvedValue([
      [
        { field_key: 'phone', is_required: 1, organization_name: 'Acme' },
        { field_key: 'phone', is_required: 0, organization_name: null },
      ],
      [],
    ]);

    const policies = await new EmployeeFieldPolicyService(pool).listForOrganization('Acme');

    expect(policies).toHaveLength(1);
    expect(policies[0].isRequired).toBe(true);
  });
});
