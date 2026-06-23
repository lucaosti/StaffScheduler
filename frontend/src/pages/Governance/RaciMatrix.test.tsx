/**
 * Tests for RaciMatrix page.
 *
 * @author Luca Ostinelli
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RaciMatrix from './RaciMatrix';

jest.mock('../../services/responsibilityService', () => ({
  getResponsibilityMatrix: jest.fn(),
}));

const { getResponsibilityMatrix: mockGetMatrix } = jest.requireMock(
  '../../services/responsibilityService'
) as { getResponsibilityMatrix: jest.Mock };

const RULE = (id: number, ouId: number, active = true) => ({
  id,
  subjectType: 'org_unit',
  subjectId: null,
  permissionCode: 'schedule.manage',
  responsibleOrgUnitId: ouId,
  delegatedToRoleId: null,
  description: null,
  isActive: active,
  createdBy: 1,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
});

const MATRIX = [
  {
    subjectType: 'org_unit',
    subjectId: null,
    permissionCode: 'schedule.manage',
    rules: [RULE(1, 10)],
  },
  {
    subjectType: 'all',
    subjectId: null,
    permissionCode: 'employee.read',
    rules: [RULE(2, 20)],
  },
  {
    subjectType: 'org_unit',
    subjectId: null,
    permissionCode: 'employee.read',
    rules: [RULE(3, 30, false)],
  },
];

const makeResponse = (matrix = MATRIX) => ({ success: true, data: { matrix } });

beforeEach(() => {
  mockGetMatrix.mockResolvedValue(makeResponse());
});

afterEach(() => jest.clearAllMocks());

describe('<RaciMatrix />', () => {
  it('renders the page heading', async () => {
    render(<RaciMatrix />);
    expect(screen.getByRole('heading', { name: /responsibility matrix/i })).toBeInTheDocument();
  });

  it('shows all permission codes as rows', async () => {
    render(<RaciMatrix />);
    expect(await screen.findByText('schedule.manage')).toBeInTheDocument();
    expect(screen.getByText('employee.read')).toBeInTheDocument();
  });

  it('shows column headers for each unique subject', async () => {
    render(<RaciMatrix />);
    await screen.findByText('schedule.manage');
    expect(screen.getByText('org_unit')).toBeInTheDocument();
    expect(screen.getByText('all')).toBeInTheDocument();
  });

  it('shows responsible org unit badge in cells', async () => {
    render(<RaciMatrix />);
    await screen.findByText('schedule.manage');
    expect(screen.getByText('OU #10')).toBeInTheDocument();
    expect(screen.getByText('OU #20')).toBeInTheDocument();
  });

  it('shows inactive badge for inactive rules', async () => {
    render(<RaciMatrix />);
    await screen.findByText('schedule.manage');
    expect(screen.getByText('inactive')).toBeInTheDocument();
  });

  it('shows empty state when no rules', async () => {
    mockGetMatrix.mockResolvedValue(makeResponse([]));
    render(<RaciMatrix />);
    expect(await screen.findByText(/no responsibility rules defined/i)).toBeInTheDocument();
  });

  it('shows error alert on load failure', async () => {
    mockGetMatrix.mockRejectedValue(new Error('Forbidden'));
    render(<RaciMatrix />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('filters rows by permission code search', async () => {
    render(<RaciMatrix />);
    await screen.findByText('schedule.manage');

    await userEvent.type(screen.getByLabelText(/filter matrix/i), 'schedule');
    await waitFor(() =>
      expect(screen.queryByText('employee.read')).not.toBeInTheDocument()
    );
    expect(screen.getByText('schedule.manage')).toBeInTheDocument();
  });

  it('shows all rows when search is cleared', async () => {
    render(<RaciMatrix />);
    await screen.findByText('schedule.manage');

    await userEvent.type(screen.getByLabelText(/filter matrix/i), 'schedule');
    await waitFor(() => expect(screen.queryByText('employee.read')).not.toBeInTheDocument());

    await userEvent.clear(screen.getByLabelText(/filter matrix/i));
    await screen.findByText('employee.read');
  });

  it('shows "no rules match" state when filter has no results', async () => {
    render(<RaciMatrix />);
    await screen.findByText('schedule.manage');

    await userEvent.type(screen.getByLabelText(/filter matrix/i), 'zzznomatch');
    await screen.findByText(/no rules match the current filter/i);
  });

  it('shows footer with permission and subject counts', async () => {
    render(<RaciMatrix />);
    await screen.findByText('schedule.manage');
    expect(screen.getByText(/2 permissions/i)).toBeInTheDocument();
    expect(screen.getByText(/2 subjects/i)).toBeInTheDocument();
  });

  it('refreshes on Refresh button click', async () => {
    render(<RaciMatrix />);
    await screen.findByText('schedule.manage');
    await userEvent.click(screen.getByRole('button', { name: /refresh matrix/i }));
    await waitFor(() => expect(mockGetMatrix).toHaveBeenCalledTimes(2));
  });
});
