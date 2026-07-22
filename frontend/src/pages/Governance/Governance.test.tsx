/**
 * Governance page smoke tests.
 *
 * Covers: responsibility matrix tab renders rules, add-rule form toggle,
 * change requests tab renders items, status badge, reviewer action buttons.
 *
 * @author Luca Ostinelli
 */

import { screen, waitFor } from '@testing-library/react';
import { render } from '../../test-utils/renderWithClient';
import userEvent from '@testing-library/user-event';

// ── Service mocks ────────────────────────────────────────────────────────────

const mockListRules = jest.fn();
const mockCreateRule = jest.fn();
const mockUpdateRule = jest.fn();
const mockDeleteRule = jest.fn();
const mockListCr = jest.fn();
const mockCreateCr = jest.fn();
const mockApproveCr = jest.fn();
const mockRejectCr = jest.fn();
const mockApplyCr = jest.fn();
const mockCancelCr = jest.fn();

jest.mock('../../services/responsibilityService', () => ({
  __esModule: true,
  listResponsibilityRules: (...a: unknown[]) => mockListRules(...a),
  createResponsibilityRule: (...a: unknown[]) => mockCreateRule(...a),
  updateResponsibilityRule: (...a: unknown[]) => mockUpdateRule(...a),
  deleteResponsibilityRule: (...a: unknown[]) => mockDeleteRule(...a),
}));

jest.mock('../../services/changeRequestService', () => ({
  __esModule: true,
  listChangeRequests: (...a: unknown[]) => mockListCr(...a),
  createChangeRequest: (...a: unknown[]) => mockCreateCr(...a),
  approveChangeRequest: (...a: unknown[]) => mockApproveCr(...a),
  rejectChangeRequest: (...a: unknown[]) => mockRejectCr(...a),
  applyChangeRequest: (...a: unknown[]) => mockApplyCr(...a),
  cancelChangeRequest: (...a: unknown[]) => mockCancelCr(...a),
}));

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: {
      id: 1,
      email: 'manager@x',
      permissions: [
        'responsibility.read',
        'responsibility.manage',
        'change_request.review',
        'change_request.create',
      ],
    },
  }),
}));

jest.mock('../../components/LoadingSpinner', () => ({
  __esModule: true,
  default: () => <div data-testid="spinner" />,
}));

const Governance = require('./Governance').default;

const ok = <T,>(data: T) => Promise.resolve({ success: true as const, data });

const sampleRule = {
  id: 1,
  subjectType: 'department',
  subjectId: 10,
  permissionCode: 'schedule.manage',
  responsibleOrgUnitId: 3,
  delegatedToRoleId: null,
  description: 'HR manages scheduling',
  isActive: true,
  createdBy: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const sampleCr = {
  id: 42,
  changeType: 'Schedule.Override',
  proposerUserId: 2,
  targetEntityType: 'schedule',
  targetEntityId: 5,
  proposedPayload: { date: '2026-07-01' },
  justification: 'Covering sick leave',
  status: 'pending',
  approverUserId: null,
  approvedAt: null,
  rejectedAt: null,
  rejectionReason: null,
  appliedAt: null,
  onBehalfOfUserId: null,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('<Governance /> — Responsibility Matrix tab', () => {
  beforeEach(() => {
    mockListRules.mockResolvedValue(ok([sampleRule]));
    mockListCr.mockResolvedValue(ok({ total: 0, items: [] }));
  });

  it('renders the matrix tab by default and shows rules', async () => {
    render(<Governance />);
    expect(await screen.findByText('schedule.manage')).toBeInTheDocument();
    expect(screen.getByText('HR manages scheduling')).toBeInTheDocument();
  });

  it('shows subject type badge', async () => {
    render(<Governance />);
    expect(await screen.findByText('Department')).toBeInTheDocument();
  });

  it('toggles the add-rule form when "Add Rule" is clicked', async () => {
    render(<Governance />);
    await screen.findByText('schedule.manage'); // wait for load

    const addBtn = screen.getByText(/Add Rule/);
    await userEvent.click(addBtn);
    expect(screen.getByText('New Responsibility Rule')).toBeInTheDocument();

    await userEvent.click(screen.getByText(/Cancel/));
    expect(screen.queryByText('New Responsibility Rule')).not.toBeInTheDocument();
  });

  it('shows "No rules defined" when list is empty', async () => {
    mockListRules.mockResolvedValue(ok([]));
    render(<Governance />);
    expect(await screen.findByText('No rules defined')).toBeInTheDocument();
  });
});

describe('<Governance /> — Change Requests tab', () => {
  beforeEach(() => {
    mockListRules.mockResolvedValue(ok([sampleRule]));
    mockListCr.mockResolvedValue(ok({ total: 1, items: [sampleCr] }));
  });

  it('switches to the change requests tab', async () => {
    render(<Governance />);
    await screen.findByText('schedule.manage'); // wait for matrix to load

    await userEvent.click(screen.getByText(/Change Requests/));
    expect(await screen.findByText('Schedule.Override')).toBeInTheDocument();
  });

  it('shows pending status badge', async () => {
    render(<Governance />);
    await userEvent.click(screen.getByText(/Change Requests/));
    expect(await screen.findByText('pending')).toBeInTheDocument();
  });

  it('shows reviewer action buttons for pending requests', async () => {
    render(<Governance />);
    await userEvent.click(screen.getByText(/Change Requests/));
    await screen.findByText('Schedule.Override');
    // Approve button has title="Approve", reject has title="Reject"
    expect(screen.getByTitle('Approve')).toBeInTheDocument();
    expect(screen.getByTitle('Reject')).toBeInTheDocument();
  });

  it('shows "No change requests found" when list is empty', async () => {
    mockListCr.mockResolvedValue(ok({ total: 0, items: [] }));
    render(<Governance />);
    await userEvent.click(screen.getByText(/Change Requests/));
    expect(await screen.findByText('No change requests found')).toBeInTheDocument();
  });

  it('opens new request form', async () => {
    render(<Governance />);
    await userEvent.click(screen.getByText(/Change Requests/));
    await screen.findByText('Schedule.Override');
    await userEvent.click(screen.getByText(/New Request/));
    expect(screen.getByText('Propose a Change')).toBeInTheDocument();
  });
});

describe('<Governance /> — Active rules count in matrix', () => {
  it('renders the correct number of rules', async () => {
    const twoRules = [
      sampleRule,
      { ...sampleRule, id: 2, subjectId: 20, permissionCode: 'leave.manage' },
    ];
    mockListRules.mockResolvedValue(ok(twoRules));
    mockListCr.mockResolvedValue(ok({ total: 0, items: [] }));

    render(<Governance />);
    await waitFor(() => {
      expect(screen.getAllByText('Department').length).toBeGreaterThanOrEqual(2);
    });
  });
});
