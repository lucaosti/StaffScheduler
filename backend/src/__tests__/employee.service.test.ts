/**
 * EmployeeService unit tests.
 *
 * Most methods delegate to UserService; we mock UserService at the
 * module boundary so these tests stay focused on the role-filtering
 * logic that EmployeeService adds.
 */

import { EmployeeService } from '../services/EmployeeService';
import { UserService } from '../services/UserService';

jest.mock('../services/UserService');

const buildUser = (overrides: Record<string, unknown> = {}) => ({
  id: 7,
  email: 'a@x.com',
  firstName: 'A',
  lastName: 'A',
  role: 'employee',
  isActive: true,
  ...overrides,
});

interface FakePool {
  execute: jest.Mock;
}

const makePool = (): FakePool => ({ execute: jest.fn() });

describe('EmployeeService', () => {
  let pool: FakePool;
  let service: EmployeeService;
  let mockUserService: jest.Mocked<UserService>;

  beforeEach(() => {
    pool = makePool();
    service = new EmployeeService(pool as never);
    mockUserService = (UserService as jest.MockedClass<typeof UserService>).mock.instances[0] as jest.Mocked<UserService>;
  });

  it('getAllEmployees forwards filters without forcing a role', async () => {
    mockUserService.getAllUsers = jest.fn().mockResolvedValue([buildUser()]);
    await service.getAllEmployees({ departmentId: 5 });
    expect(mockUserService.getAllUsers).toHaveBeenCalledWith({ departmentId: 5 }, undefined);
  });

  it('getEmployeeById returns the user regardless of their roles', async () => {
    mockUserService.getUserById = jest.fn().mockResolvedValue(buildUser());
    const result = await service.getEmployeeById(7);
    expect(result?.id).toBe(7);
  });

  it('getEmployeeById returns null when the user does not exist', async () => {
    mockUserService.getUserById = jest.fn().mockResolvedValue(null);
    const result = await service.getEmployeeById(7);
    expect(result).toBeNull();
  });

  it('getEmployeeStatistics reflects the overall user headcount', async () => {
    mockUserService.getUserStatistics = jest.fn().mockResolvedValue({
      total: 10,
      active: 8,
      inactive: 2,
      byRole: [{ role: 'Employee', count: 8 }],
    });
    const stats = await service.getEmployeeStatistics();
    expect(stats.total).toBe(10);
    expect(stats.active).toBe(8);
    expect(stats.inactive).toBe(2);
  });

  it('getEmployeesByDepartment delegates with no role filter override', async () => {
    mockUserService.getUsersByDepartment = jest.fn().mockResolvedValue([buildUser()]);
    await service.getEmployeesByDepartment(3);
    expect(mockUserService.getUsersByDepartment).toHaveBeenCalledWith(3);
  });

  it('createEmployee forwards the supplied data (roles via roleIds)', async () => {
    mockUserService.createUser = jest.fn().mockResolvedValue(buildUser());
    await service.createEmployee({ email: 'a@x.com', password: 'pass', firstName: 'A', lastName: 'B', roleIds: [3] });
    expect(mockUserService.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'a@x.com', roleIds: [3] })
    );
  });

  it('updateEmployee throws when the target user does not exist', async () => {
    mockUserService.getUserById = jest.fn().mockResolvedValue(null);
    await expect(service.updateEmployee(7, { firstName: 'X' })).rejects.toThrow(/Employee not found/);
  });

  it('updateEmployee delegates when target is an employee', async () => {
    mockUserService.getUserById = jest.fn().mockResolvedValue(buildUser());
    mockUserService.updateUser = jest.fn().mockResolvedValue(buildUser({ firstName: 'X' }));
    const result = await service.updateEmployee(7, { firstName: 'X' });
    expect(result.firstName).toBe('X');
  });

  it('deleteEmployee soft-deletes via UserService', async () => {
    mockUserService.getUserById = jest.fn().mockResolvedValue(buildUser());
    mockUserService.deleteUser = jest.fn().mockResolvedValue(true);
    expect(await service.deleteEmployee(7)).toBe(true);
  });

  it('getEmployeeSkills queries the join table', async () => {
    pool.execute = jest.fn().mockResolvedValue([
      [{ id: 1, name: 'Triage', description: '', proficiencyLevel: 4 }],
      null,
    ]);
    const skills = await service.getEmployeeSkills(7);
    expect(skills).toHaveLength(1);
    expect(skills[0].proficiencyLevel).toBe(4);
  });

  it('addEmployeeSkill upserts via INSERT ... ON DUPLICATE', async () => {
    pool.execute = jest.fn().mockResolvedValue([{ affectedRows: 1 }, null]);
    await service.addEmployeeSkill(7, 3, 5);
    const sql = (pool.execute as jest.Mock).mock.calls[0][0] as string;
    expect(sql).toMatch(/INSERT INTO user_skills/);
    expect(sql).toMatch(/ON DUPLICATE KEY UPDATE/);
  });

  it('removeEmployeeSkill deletes the join row', async () => {
    pool.execute = jest.fn().mockResolvedValue([{ affectedRows: 1 }, null]);
    await service.removeEmployeeSkill(7, 3);
    expect((pool.execute as jest.Mock).mock.calls[0][0]).toMatch(/DELETE FROM user_skills/);
  });
});
