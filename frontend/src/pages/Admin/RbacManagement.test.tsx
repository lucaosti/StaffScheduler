/**
 * Tests for RbacManagement page.
 *
 * @author Luca Ostinelli
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RbacManagement from './RbacManagement';

// ---- Service mocks ----
const mockListRoles = jest.fn();
const mockListPermissions = jest.fn();
const mockCreateRole = jest.fn();
const mockUpdateRole = jest.fn();
const mockDeleteRole = jest.fn();
const mockGetUserRoles = jest.fn();
const mockAssignRole = jest.fn();
const mockRemoveRole = jest.fn();

jest.mock('../../services/rbacService', () => ({
  listRoles: () => mockListRoles(),
  listPermissions: () => mockListPermissions(),
  createRole: (b: unknown) => mockCreateRole(b),
  updateRole: (id: number, b: unknown) => mockUpdateRole(id, b),
  deleteRole: (id: number) => mockDeleteRole(id),
  getUserRoles: (uid: number) => mockGetUserRoles(uid),
  assignRole: (uid: number, b: unknown) => mockAssignRole(uid, b),
  removeRole: (uid: number, rid: number, scope: unknown, just: unknown) => mockRemoveRole(uid, rid, scope, just),
}));

const mockListUnits = jest.fn();
jest.mock('../../services/orgService', () => ({
  listUnits: () => mockListUnits(),
}));

const mockGetEmployees = jest.fn();
jest.mock('../../services/employeeService', () => ({
  getEmployees: (f: unknown) => mockGetEmployees(f),
}));

// ---- Fixtures ----
const PERMISSIONS = [
  { id: 1, code: 'employee.read', resource: 'employee', action: 'read', description: 'Read employees' },
  { id: 2, code: 'schedule.manage', resource: 'schedule', action: 'manage', description: 'Manage schedules' },
];

const ROLES = [
  { id: 1, name: 'Admin', description: 'Full access', isSystem: true, permissions: ['employee.read', 'schedule.manage'] },
  { id: 2, name: 'Viewer', description: 'Read only', isSystem: false, permissions: ['employee.read'] },
];

const ORG_UNITS = [
  { id: 10, name: 'HR Dept', description: null, parentId: null, managerUserId: null, isActive: true, createdAt: '', updatedAt: '' },
];

const EMPLOYEES = [
  { id: 99, firstName: 'Alice', lastName: 'Smith', email: 'alice@test.com', isActive: true, createdAt: '', updatedAt: '' },
];

const USER_ROLES: Array<{ roleId: number; roleName: string; scopeOrgUnitId: null; expiresAt: null }> = [
  { roleId: 2, roleName: 'Viewer', scopeOrgUnitId: null, expiresAt: null },
];

beforeEach(() => {
  mockListRoles.mockResolvedValue({ success: true, data: ROLES });
  mockListPermissions.mockResolvedValue({ success: true, data: PERMISSIONS });
  mockListUnits.mockResolvedValue({ success: true, data: ORG_UNITS });
  mockGetEmployees.mockResolvedValue({ success: true, data: EMPLOYEES });
  mockGetUserRoles.mockResolvedValue({ success: true, data: USER_ROLES });
  mockCreateRole.mockResolvedValue({ success: true, data: { id: 3, name: 'New', isSystem: false, permissions: [] } });
  mockUpdateRole.mockResolvedValue({ success: true, data: ROLES[1] });
  mockDeleteRole.mockResolvedValue({ success: true });
  mockAssignRole.mockResolvedValue({ success: true });
  mockRemoveRole.mockResolvedValue({ success: true });
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('<RbacManagement />', () => {
  // ---- Roles tab ----

  it('renders the page header and Roles tab by default', async () => {
    render(<RbacManagement />);
    expect(screen.getByRole('heading', { name: /roles & permissions/i })).toBeInTheDocument();
    expect(await screen.findByText('Admin')).toBeInTheDocument();
    expect(screen.getByText('Viewer')).toBeInTheDocument();
  });

  it('shows system badge for system roles and disables Delete for them', async () => {
    render(<RbacManagement />);
    await screen.findByText('Admin');

    const rows = screen.getAllByRole('row');
    const adminRow = rows[1];
    expect(within(adminRow).getByText('System')).toBeInTheDocument();
    expect(within(adminRow).getByRole('button', { name: /delete role admin/i })).toBeDisabled();

    const viewerRow = rows[2];
    expect(within(viewerRow).getByRole('button', { name: /delete role viewer/i })).not.toBeDisabled();
  });

  it('opens create modal and calls createRole', async () => {
    render(<RbacManagement />);
    await screen.findByText('Admin');

    await userEvent.click(screen.getByRole('button', { name: /new role/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/^name/i), 'My Role');
    await userEvent.click(screen.getByRole('button', { name: /create role/i }));

    expect(mockCreateRole).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My Role' })
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText(/created/i)).toBeInTheDocument();
  });

  it('opens edit modal pre-filled with role data', async () => {
    render(<RbacManagement />);
    await screen.findByText('Viewer');

    await userEvent.click(screen.getByRole('button', { name: /edit role viewer/i }));

    const nameInput = screen.getByLabelText(/^name/i) as HTMLInputElement;
    expect(nameInput.value).toBe('Viewer');
    expect(screen.getByLabelText(/description/i)).toHaveValue('Read only');
  });

  it('calls updateRole when Save Changes is clicked', async () => {
    render(<RbacManagement />);
    await screen.findByText('Viewer');

    await userEvent.click(screen.getByRole('button', { name: /edit role viewer/i }));
    const nameInput = screen.getByLabelText(/^name/i);
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Updated Viewer');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(mockUpdateRole).toHaveBeenCalledWith(2, expect.objectContaining({ name: 'Updated Viewer' }));
  });

  it('shows delete confirm modal and calls deleteRole', async () => {
    render(<RbacManagement />);
    await screen.findByText('Viewer');

    await userEvent.click(screen.getByRole('button', { name: /delete role viewer/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /delete role/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    expect(mockDeleteRole).toHaveBeenCalledWith(2);
    expect(await screen.findByText(/deleted/i)).toBeInTheDocument();
  });

  it('shows error when listRoles fails', async () => {
    mockListRoles.mockRejectedValue(new Error('Server error'));
    render(<RbacManagement />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(await screen.findByText(/server error/i)).toBeInTheDocument();
  });

  // ---- User Roles tab ----

  it('switches to User Role Grants tab', async () => {
    render(<RbacManagement />);
    await screen.findByText('Admin');

    await userEvent.click(screen.getByRole('button', { name: /user role grants/i }));
    expect(screen.getByLabelText(/search by name or email/i)).toBeInTheDocument();
  });

  it('shows employee suggestions when typing in the search box', async () => {
    render(<RbacManagement />);
    await screen.findByText('Admin');

    await userEvent.click(screen.getByRole('button', { name: /user role grants/i }));
    const input = screen.getByLabelText(/search by name or email/i);
    await userEvent.type(input, 'Alice');

    // Debounce is 300ms — wait for the search to fire
    await waitFor(() => expect(mockGetEmployees).toHaveBeenCalled(), { timeout: 2000 });
    // Dropdown option contains "Alice Smith" + email — role="option" is the reliable selector
    expect(await screen.findByRole('option')).toBeInTheDocument();
  }, 10000);

  it('loads user roles when an employee is selected', async () => {
    render(<RbacManagement />);
    await screen.findByText('Admin');

    await userEvent.click(screen.getByRole('button', { name: /user role grants/i }));
    await userEvent.type(screen.getByLabelText(/search by name or email/i), 'Ali');

    await waitFor(() => expect(mockGetEmployees).toHaveBeenCalled(), { timeout: 2000 });
    await userEvent.click(await screen.findByRole('option'));

    expect(mockGetUserRoles).toHaveBeenCalledWith(99);
    // "Never" only appears in the Expires column of the grants table
    expect(await screen.findByText('Never')).toBeInTheDocument();
    expect(screen.getByText('Current Role Grants')).toBeInTheDocument();
  }, 10000);

  it('calls assignRole when Grant Role is submitted', async () => {
    render(<RbacManagement />);
    await screen.findByText('Admin');

    await userEvent.click(screen.getByRole('button', { name: /user role grants/i }));
    await userEvent.type(screen.getByLabelText(/search/i), 'Ali');
    await waitFor(() => expect(mockGetEmployees).toHaveBeenCalled(), { timeout: 2000 });
    await userEvent.click(await screen.findByRole('option'));
    await screen.findByText('Current Role Grants');

    await userEvent.selectOptions(screen.getByLabelText(/^role/i), '1');
    await userEvent.click(screen.getByRole('button', { name: /grant role/i }));

    expect(mockAssignRole).toHaveBeenCalledWith(99, expect.objectContaining({ roleId: 1 }));
    expect(await screen.findByText(/granted successfully/i)).toBeInTheDocument();
  }, 10000);

  it('calls removeRole after revoke confirm', async () => {
    render(<RbacManagement />);
    await screen.findByText('Admin');

    await userEvent.click(screen.getByRole('button', { name: /user role grants/i }));
    await userEvent.type(screen.getByLabelText(/search/i), 'Ali');
    await waitFor(() => expect(mockGetEmployees).toHaveBeenCalled(), { timeout: 2000 });
    await userEvent.click(await screen.findByRole('option'));
    // Wait for grants table to load ("Never" is unique to the Expires column)
    await screen.findByText('Never');

    await userEvent.click(screen.getByRole('button', { name: /revoke role viewer/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^revoke$/i }));
    expect(mockRemoveRole).toHaveBeenCalledWith(99, 2, null, undefined);
    expect(await screen.findByText(/revoked/i)).toBeInTheDocument();
  }, 10000);
});
