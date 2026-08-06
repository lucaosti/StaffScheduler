/**
 * CompliancePresetService unit tests.
 */

import { CompliancePresetService, COMPLIANCE_PRESETS } from '../services/CompliancePresetService';
import { PolicyService } from '../services/PolicyService';
import { ValidationError } from '../errors';

jest.mock('../services/PolicyService');

export {};

describe('CompliancePresetService.list', () => {
  it('returns the known presets, without touching the database', () => {
    const service = new CompliancePresetService({} as never);
    const presets = service.list();
    expect(presets.map((p) => p.key)).toEqual(Object.keys(COMPLIANCE_PRESETS));
    expect(PolicyService.prototype.list).not.toHaveBeenCalled();
  });
});

describe('CompliancePresetService.apply', () => {
  it('throws ValidationError for an unknown preset key', async () => {
    const service = new CompliancePresetService({} as never);
    await expect(service.apply('not-a-real-preset', 1)).rejects.toBeInstanceOf(ValidationError);
  });

  it('creates one global policy row per rule when none exist', async () => {
    (PolicyService.prototype.list as jest.Mock) = jest.fn().mockResolvedValue([]);
    (PolicyService.prototype.create as jest.Mock) = jest
      .fn()
      .mockImplementation((input) => Promise.resolve({ id: Math.random(), ...input }));

    const service = new CompliancePresetService({} as never);
    const applied = await service.apply('eu_working_time_directive', 7);

    expect(applied).toHaveLength(3);
    expect(PolicyService.prototype.create).toHaveBeenCalledTimes(3);
    expect(PolicyService.prototype.update).not.toHaveBeenCalled();
    const keys = (PolicyService.prototype.create as jest.Mock).mock.calls.map((c) => c[0].policyKey);
    expect(keys.sort()).toEqual(['max_consecutive_days', 'max_hours_week', 'min_rest_hours']);
    for (const call of (PolicyService.prototype.create as jest.Mock).mock.calls) {
      expect(call[0].imposedByUserId).toBe(7);
      expect(call[0].scopeType).toBe('global');
    }
  });

  it('updates an existing global row for a key rather than duplicating it', async () => {
    (PolicyService.prototype.list as jest.Mock) = jest.fn().mockResolvedValue([
      { id: 3, scopeType: 'global', policyKey: 'max_hours_week', policyValue: { hours: 40 } },
    ]);
    (PolicyService.prototype.update as jest.Mock) = jest
      .fn()
      .mockImplementation((id, patch) => Promise.resolve({ id, scopeType: 'global', policyKey: 'max_hours_week', ...patch }));
    (PolicyService.prototype.create as jest.Mock) = jest
      .fn()
      .mockImplementation((input) => Promise.resolve({ id: Math.random(), ...input }));

    const service = new CompliancePresetService({} as never);
    await service.apply('eu_working_time_directive', 7);

    expect(PolicyService.prototype.update).toHaveBeenCalledWith(
      3,
      expect.objectContaining({ policyValue: { hours: 48 }, isActive: true })
    );
    // The other two rules had no existing global row and go through create.
    expect(PolicyService.prototype.create).toHaveBeenCalledTimes(2);
  });

  it('leaves an org_unit-scoped policy under the same key untouched', async () => {
    // Only a GLOBAL row for a key counts as "already loaded" — a
    // department-scoped override must not be silently overwritten by a
    // preset apply that only ever writes global rows.
    (PolicyService.prototype.list as jest.Mock) = jest.fn().mockResolvedValue([
      { id: 9, scopeType: 'org_unit', scopeId: 4, policyKey: 'max_hours_week', policyValue: { hours: 35 } },
    ]);
    (PolicyService.prototype.create as jest.Mock) = jest
      .fn()
      .mockImplementation((input) => Promise.resolve({ id: Math.random(), ...input }));

    const service = new CompliancePresetService({} as never);
    await service.apply('eu_working_time_directive', 7);

    expect(PolicyService.prototype.update).not.toHaveBeenCalled();
    expect(PolicyService.prototype.create).toHaveBeenCalledTimes(3);
  });
});
