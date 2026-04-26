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

  it('getAllEmployees forces role=employee on the underlying call', async () => {
    mockUserService.getAllUsers = jest.fn().mockResolvedValue([buildUser()]);
    await service.getAllEmployees({ departmentId: 5 });
    expect(mockUserService.getAllUsers).toHaveBeenCalledWith({ departmentId: 5, role: 'employee' });
  });

  it('getEmployeeById returns null if the user has a different role', async () => {
    mockUserService.getUserById = jest.fn().mockResolvedValue(buildUser({ role: 'admin' }));
    const result = await service.getEmployeeById(7);
    expect(result).toBeNull();
  });

  it('getEmployeeById returns the user when role matches', async () => {
    mockUserService.getUserById = jest.fn().mockResolvedValue(buildUser());
    const result = await service.getEmployeeById(7);
    expect(result?.id).toBe(7);
  });

  it('getEmployeeStatistics aggregates active vs inactive', async () => {
    mockUserService.getUserStatistics = jest.fn().mockResolvedValue({
      total: 10,
      active: 8,
      inactive: 2,
      byRole: [{ role: 'employee', count: 8 }],
    });
    mockUserService.getAllUsers = jest.fn().mockResolvedValue([
      buildUser({ id: 1, isActive: true }),
      buildUser({ id: 2, isActive: false }),
      buildUser({ id: 3, isActive: true }),
    ]);
    const stats = await service.getEmployeeStatistics();
    expect(stats.total).toBe(8);
    expect(stats.active).toBe(2);
    expect(stats.inactive).toBe(6);
  });

  it('getEmployeesByDepartment delegates with no role filter override', async () => {
    mockUserService.getUsersByDepartment = jest.fn().mockResolvedValue([buildUser()]);
    await service.getEmployeesByDepartment(3);
    expect(mockUserService.getUsersByDepartment).toHaveBeenCalledWith(3);
  });

  it('createEmployee always sets role=employee', async () => {
    mockUserService.createUser = jest.fn().mockResolvedValue(buildUser());
    await service.createEmployee({ email: 'a@x.com', role: 'admin' });
    expect(mockUserService.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'employee' })
    );
  });

  it('updateEmployee throws when target is not an employee', async () => {
    mockUserService.getUserById = jest.fn().mockResolvedValue(buildUser({ role: 'manager' }));
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
