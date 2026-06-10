/**
 * Service coverage batch 4 — fills single-line gaps across multiple services:
 *   ScheduleService         — getAllSchedules catch block (lines 189-190)
 *   AuditLogService         — clampOffset negative/NaN path (line 82)
 *   DelegationService       — post-create null guard (line 60)
 *   EventBus                — unsubscribe set cleanup (line 32)
 *   ModuleService           — post-update null guard (line 53)
 *   NotificationService     — post-create null guard (line 59)
 *   OrgUnitService          — tree() cache hit (line 95)
 *   PreferencesService      — post-upsert null guard (line 141)
 *   RbacService             — post-createRole null guard (line 198)
 *   TwoFactorService        — consumeRecoveryCode JSON.parse catch (line 117)
 *   UserDirectoryService    — setFields empty early-return (line 85)
 *   BulkImportService       — importEmployees unknown role (lines 235-236)
 *
 * @author Luca Ostinelli
 */

import { ScheduleService } from '../services/ScheduleService';
import { AuditLogService } from '../services/AuditLogService';
import { DelegationService } from '../services/DelegationService';
import { eventBus } from '../services/EventBus';
import { ModuleService } from '../services/ModuleService';
import { NotificationService } from '../services/NotificationService';
import { OrgUnitService } from '../services/OrgUnitService';
import { PreferencesService } from '../services/PreferencesService';
import { RbacService } from '../services/RbacService';
import { TwoFactorService } from '../services/TwoFactorService';
import { UserDirectoryService } from '../services/UserDirectoryService';
import { BulkImportService } from '../services/BulkImportService';

type Tuple = [unknown, unknown];

const makePool = () => {
  const execute = jest.fn();
  const conn = {
    execute: jest.fn(),
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
  };
  return {
    pool: { execute, getConnection: jest.fn().mockResolvedValue(conn) } as never,
    execute,
    conn,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// ScheduleService — getAllSchedules catch block
// ─────────────────────────────────────────────────────────────────────────────

describe('ScheduleService.getAllSchedules — catch block', () => {
  it('bubbles DB error from getAllSchedules', async () => {
    const { pool, execute } = makePool();
    execute.mockRejectedValueOnce(new Error('db gone'));
    const svc = new ScheduleService(pool);
    await expect(svc.getAllSchedules()).rejects.toThrow('db gone');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AuditLogService — clampOffset negative path
// ─────────────────────────────────────────────────────────────────────────────

describe('AuditLogService.list — clampOffset negative offset returns 0', () => {
  it('treats negative offset as 0', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ c: 0 }], null] as Tuple)  // COUNT
      .mockResolvedValueOnce([[], null] as Tuple);           // SELECT rows
    const svc = new AuditLogService(pool);
    const result = await svc.list({ offset: -5 });
    expect(result.items).toHaveLength(0);
    // OFFSET param should be 0 (clamped from -5)
    const params = execute.mock.calls[1][1] as unknown[];
    expect(params[params.length - 1]).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DelegationService — post-create null guard
// ─────────────────────────────────────────────────────────────────────────────

describe('DelegationService.createDelegation — null after insert', () => {
  it('throws Failed to retrieve created delegation when getDelegationById returns null', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ insertId: 1 }, null] as Tuple)  // INSERT delegations
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple) // INSERT audit_log
      .mockResolvedValueOnce([[], null] as Tuple);                 // getDelegationById → null
    const svc = new DelegationService(pool);
    await expect(
      svc.createDelegation(
        1,
        ['shift.read'],
        { delegateeId: 2, permissionCodes: ['shift.read'], expiresAt: '2026-12-31' }
      )
    ).rejects.toThrow('Failed to retrieve created delegation');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EventBus — unsubscribe cleanup when set becomes empty
// ─────────────────────────────────────────────────────────────────────────────

describe('EventBus.unsubscribe — removes subscriber set when empty', () => {
  it('deletes the subscriber entry when the last listener unsubscribes', () => {
    const fakeRes = {} as any;
    eventBus.subscribe(9999, fakeRes);
    // Should not throw; set deletion is the branch being covered
    eventBus.unsubscribe(9999, fakeRes);
    // A second unsubscribe on the now-gone entry should be a no-op
    eventBus.unsubscribe(9999, fakeRes);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ModuleService — post-update null guard
// ─────────────────────────────────────────────────────────────────────────────

describe('ModuleService.setEnabled — null after update', () => {
  it('throws Failed to retrieve module after update when getByCode returns null', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple) // UPDATE modules
      .mockResolvedValueOnce([[], null] as Tuple);                  // getByCode → null
    const svc = new ModuleService(pool);
    await expect(svc.setEnabled('notifications', true)).rejects.toThrow('Failed to retrieve module after update');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NotificationService — post-create null guard
// ─────────────────────────────────────────────────────────────────────────────

describe('NotificationService.notify — null after insert', () => {
  it('throws Failed to retrieve created notification when getById returns null', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ insertId: 7 }, null] as Tuple) // INSERT notification
      .mockResolvedValueOnce([[], null] as Tuple);               // getById → null
    const svc = new NotificationService(pool);
    await expect(
      svc.notify({ userId: 3, type: 'system', title: 'Hi', body: 'Test' })
    ).rejects.toThrow('Failed to retrieve created notification');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// OrgUnitService — tree() cache hit
// ─────────────────────────────────────────────────────────────────────────────

describe('OrgUnitService.tree — cache hit on second call', () => {
  it('returns cached data without querying DB on second call', async () => {
    const { pool, execute } = makePool();
    const orgRow = {
      id: 1, name: 'Root', description: null, parent_id: null,
      manager_user_id: null, is_active: 1, created_at: 't', updated_at: 't',
    };
    execute.mockResolvedValueOnce([[orgRow], null] as Tuple); // list() query
    const svc = new OrgUnitService(pool);
    const first = await svc.tree();
    const second = await svc.tree(); // should hit cache
    expect(execute).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PreferencesService — post-upsert null guard
// ─────────────────────────────────────────────────────────────────────────────

describe('PreferencesService.upsert — null after insert', () => {
  it('throws Failed to retrieve preferences after upsert when getByUserId returns null', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[], null] as Tuple)                  // getByUserId → null (INSERT path)
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple) // INSERT preferences
      .mockResolvedValueOnce([[], null] as Tuple);                  // getByUserId refresh → null
    const svc = new PreferencesService(pool);
    await expect(svc.upsert(5, {})).rejects.toThrow('Failed to retrieve preferences after upsert');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RbacService — post-createRole null guard
// ─────────────────────────────────────────────────────────────────────────────

describe('RbacService.createRole — null after insert', () => {
  it('throws Failed to retrieve created role when getRoleById returns null', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute
      .mockResolvedValueOnce([[], null])              // SELECT roles (name check) → empty
      .mockResolvedValueOnce([{ insertId: 5 }, null]) // INSERT role
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // DELETE role_permissions
    execute.mockResolvedValueOnce([[], null] as Tuple); // getRoleById → null
    const svc = new RbacService(pool);
    await expect(svc.createRole({ name: 'NewRole', permissionCodes: [] }))
      .rejects.toThrow('Failed to retrieve created role');
    expect(conn.rollback).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TwoFactorService — consumeRecoveryCode JSON.parse catch
// ─────────────────────────────────────────────────────────────────────────────

describe('TwoFactorService.consumeRecoveryCode — invalid JSON returns false', () => {
  it('returns false when stored recovery codes are not valid JSON', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ totp_recovery_codes: '{not-json' }], null] as Tuple);
    const svc = new TwoFactorService(pool);
    const result = await svc.consumeRecoveryCode(1, 'abc123');
    expect(result).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// UserDirectoryService — setFields empty array early return
// ─────────────────────────────────────────────────────────────────────────────

describe('UserDirectoryService.setFields — empty fields early return', () => {
  it('returns immediately without querying DB when fields array is empty', async () => {
    const { pool, execute } = makePool();
    const svc = new UserDirectoryService(pool);
    await svc.setFields(1, []);
    expect(execute).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BulkImportService — importEmployees unknown role
// ─────────────────────────────────────────────────────────────────────────────

describe('BulkImportService.importEmployees — unknown role', () => {
  it('returns error when role name is not found in DB', async () => {
    const { pool, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([[], null]) // SELECT users (email check) → no duplicate
      .mockResolvedValueOnce([[], null]); // SELECT roles → not found
    const svc = new BulkImportService(pool);
    const csv = 'email,firstName,lastName,role\ntest@example.com,First,Last,GhostRole';
    const result = await svc.importEmployees(csv, 'default');
    expect(result.inserted).toBe(0);
    expect(result.errors[0].message).toMatch(/Unknown role/);
    expect(conn.rollback).toHaveBeenCalled();
  });
});
