/**
 * RoleHistoryTab — subject-selection toggle (by person / by role) that feeds
 * RoleTimeline. RoleTimeline has its own dedicated test; here it is stubbed
 * so this file only exercises what RoleHistoryTab itself is responsible
 * for: which subject gets built and passed down.
 *
 * @author Luca Ostinelli
 */

import { render, screen } from '../../test-utils/renderWithClient';
import userEvent from '@testing-library/user-event';
import RoleHistoryTab from './RoleHistoryTab';

const mockRolesQuery = jest.fn();
jest.mock('../../hooks/useRbac', () => ({
  useRolesAndPermissionsQuery: () => mockRolesQuery(),
}));

const mockRoleTimeline = jest.fn();
jest.mock('./RoleTimeline', () => ({
  __esModule: true,
  default: (props: unknown) => {
    mockRoleTimeline(props);
    return <div data-testid="role-timeline" />;
  },
}));

const ROLES = [
  { id: 1, name: 'Admin', description: null, isSystem: true, permissions: [] },
  { id: 2, name: 'Manager', description: null, isSystem: false, permissions: [] },
];

const EMPLOYEE = {
  id: 5,
  firstName: 'Anna',
  lastName: 'Rossi',
  email: 'anna@x.com',
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockRolesQuery.mockReturnValue({ data: { roles: ROLES, permissions: [] } });
});

describe('<RoleHistoryTab />', () => {
  it('defaults to "by person" with no selected user: passes a null subject and shows the placeholder', () => {
    render(<RoleHistoryTab selectedUser={null} />);
    expect(screen.getByText(/pick someone/i)).toBeInTheDocument();
    expect(mockRoleTimeline).toHaveBeenLastCalledWith({ subject: null });
  });

  it('with a selected user: shows their name and passes a user subject', () => {
    render(<RoleHistoryTab selectedUser={EMPLOYEE} />);
    expect(screen.getByText(/Anna Rossi/)).toBeInTheDocument();
    expect(mockRoleTimeline).toHaveBeenLastCalledWith({ subject: { kind: 'user', id: 5 } });
  });

  it('switches to "by role": shows the role select with a null subject until one is picked', async () => {
    render(<RoleHistoryTab selectedUser={EMPLOYEE} />);
    await userEvent.click(screen.getByRole('button', { name: /by role/i }));

    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(mockRoleTimeline).toHaveBeenLastCalledWith({ subject: null });
  });

  it('picking a role builds a role subject', async () => {
    render(<RoleHistoryTab selectedUser={null} />);
    await userEvent.click(screen.getByRole('button', { name: /by role/i }));
    await userEvent.selectOptions(screen.getByRole('combobox'), '2');

    expect(mockRoleTimeline).toHaveBeenLastCalledWith({ subject: { kind: 'role', id: 2 } });
  });

  it('switching back to "by person" restores the person subject', async () => {
    render(<RoleHistoryTab selectedUser={EMPLOYEE} />);
    await userEvent.click(screen.getByRole('button', { name: /by role/i }));
    await userEvent.selectOptions(screen.getByRole('combobox'), '1');
    await userEvent.click(screen.getByRole('button', { name: /by person/i }));

    expect(mockRoleTimeline).toHaveBeenLastCalledWith({ subject: { kind: 'user', id: 5 } });
  });
});
