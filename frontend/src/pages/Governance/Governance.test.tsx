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

// Runs before every describe block's own beforeEach, so a mutation mock's
// call history from one test never leaks into the next test's
// not.toHaveBeenCalled() assertion.
beforeEach(() => jest.clearAllMocks());

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

// ── Mutations: every write goes through useGovernance's hooks, not a direct
// service call with a hand-rolled try/catch — these assert the resulting
// service call, the list refresh, and the failure-message path.

describe('<Governance /> — misc UI', () => {
  beforeEach(() => {
    mockListRules.mockResolvedValue(ok([sampleRule]));
    mockListCr.mockResolvedValue(ok({ total: 0, items: [] }));
  });

  it('dismisses the error alert', async () => {
    mockCreateRule.mockRejectedValue(new Error('boom'));
    render(<Governance />);
    await screen.findByText('schedule.manage');
    await userEvent.click(screen.getByText(/Add Rule/));
    await userEvent.type(screen.getByPlaceholderText('e.g. schedule.manage'), 'x');
    await userEvent.type(screen.getByPlaceholderText('e.g. 3'), '1');
    await userEvent.click(screen.getByText('Save Rule'));
    await screen.findByText('boom');

    await userEvent.click(document.querySelector('.alert-dismissible .btn-close') as HTMLElement);

    expect(screen.queryByText('boom')).not.toBeInTheDocument();
  });

  it('fills the optional subject id, subject type and description fields', async () => {
    mockCreateRule.mockResolvedValue(ok(sampleRule));
    render(<Governance />);
    await screen.findByText('schedule.manage');

    await userEvent.click(screen.getByText(/Add Rule/));
    await userEvent.selectOptions(screen.getByRole('combobox'), 'org_unit');
    await userEvent.type(screen.getByPlaceholderText('e.g. 5'), '7');
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. schedule\.manage/i), 'leave.manage');
    await userEvent.type(screen.getByPlaceholderText('e.g. 3'), '5');
    await userEvent.type(screen.getByPlaceholderText('Optional'), 'A description');
    await userEvent.click(screen.getByText('Save Rule'));

    await waitFor(() =>
      expect(mockCreateRule).toHaveBeenCalledWith(
        expect.objectContaining({
          subjectType: 'org_unit',
          subjectId: 7,
          description: 'A description',
        })
      )
    );
  });

  it('hides the subject id field for the "all" subject type', async () => {
    render(<Governance />);
    await screen.findByText('schedule.manage');
    await userEvent.click(screen.getByText(/Add Rule/));

    await userEvent.selectOptions(screen.getByRole('combobox'), 'all');

    expect(screen.queryByLabelText(/subject id/i)).not.toBeInTheDocument();
  });

  it('filters and toggles "my requests only" on the change requests tab', async () => {
    mockListCr.mockResolvedValue(ok({ total: 0, items: [] }));
    render(<Governance />);
    await userEvent.click(screen.getByText(/Change Requests/));
    await waitFor(() => expect(mockListCr).toHaveBeenCalled());

    await userEvent.selectOptions(screen.getByDisplayValue('All statuses'), 'approved');
    await waitFor(() => expect(mockListCr).toHaveBeenCalledWith(expect.objectContaining({ status: 'approved' })));

    await userEvent.click(screen.getByLabelText(/my requests only/i));
    await waitFor(() =>
      expect(mockListCr).toHaveBeenCalledWith(expect.objectContaining({ proposerUserId: 1 }))
    );
  });

  it('cancels the new-request form without submitting', async () => {
    render(<Governance />);
    await userEvent.click(screen.getByText(/Change Requests/));
    await waitFor(() => expect(mockListCr).toHaveBeenCalled());
    await userEvent.click(screen.getByText(/New Request/));
    expect(screen.getByText('Propose a Change')).toBeInTheDocument();

    await userEvent.click(screen.getByText('Cancel', { selector: 'button.btn-secondary' }));

    expect(screen.queryByText('Propose a Change')).not.toBeInTheDocument();
    expect(mockCreateCr).not.toHaveBeenCalled();
  });

  it('fills the optional target id and justification fields on a change request', async () => {
    mockCreateCr.mockResolvedValue(ok(sampleCr));
    render(<Governance />);
    await userEvent.click(screen.getByText(/Change Requests/));
    await waitFor(() => expect(mockListCr).toHaveBeenCalled());
    await userEvent.click(screen.getByText(/New Request/));

    await userEvent.type(screen.getByPlaceholderText('e.g. Schedule.Override'), 'Shift.Delete');
    await userEvent.type(screen.getByPlaceholderText('e.g. schedule'), 'shift');
    await userEvent.type(screen.getByPlaceholderText(/optional/i), '9');
    await userEvent.type(screen.getByPlaceholderText('Why is this change needed?'), 'Because reasons');
    await userEvent.click(screen.getByText('Submit Request'));

    await waitFor(() =>
      expect(mockCreateCr).toHaveBeenCalledWith(
        expect.objectContaining({ targetEntityId: 9, justification: 'Because reasons' })
      )
    );
  });

  it('switches to the matrix tab explicitly', async () => {
    render(<Governance />);
    await screen.findByText('schedule.manage');
    await userEvent.click(screen.getByText(/Change Requests/));
    await userEvent.click(screen.getByText(/Responsibility Matrix/));

    expect(await screen.findByText('schedule.manage')).toBeInTheDocument();
  });
});

describe('<Governance /> — rule mutations', () => {
  beforeEach(() => {
    mockListRules.mockResolvedValue(ok([sampleRule]));
    mockListCr.mockResolvedValue(ok({ total: 0, items: [] }));
  });

  it('creates a rule and refreshes the list', async () => {
    mockCreateRule.mockResolvedValue(ok({ ...sampleRule, id: 9 }));
    render(<Governance />);
    await screen.findByText('schedule.manage');

    await userEvent.click(screen.getByText(/Add Rule/));
    await userEvent.type(screen.getByPlaceholderText('e.g. schedule.manage'), 'leave.manage');
    await userEvent.type(screen.getByPlaceholderText('e.g. 3'), '5');
    await userEvent.click(screen.getByText('Save Rule'));

    await waitFor(() =>
      expect(mockCreateRule).toHaveBeenCalledWith(
        expect.objectContaining({ permissionCode: 'leave.manage', responsibleOrgUnitId: 5 })
      )
    );
    // Form closes on success.
    await waitFor(() => expect(screen.queryByText('New Responsibility Rule')).not.toBeInTheDocument());
  });

  it('shows the service error message when creating a rule fails', async () => {
    mockCreateRule.mockRejectedValue(new Error('permissionCode already governed for this subject'));
    render(<Governance />);
    await screen.findByText('schedule.manage');

    await userEvent.click(screen.getByText(/Add Rule/));
    await userEvent.type(screen.getByPlaceholderText('e.g. schedule.manage'), 'leave.manage');
    await userEvent.type(screen.getByPlaceholderText('e.g. 3'), '5');
    await userEvent.click(screen.getByText('Save Rule'));

    expect(await screen.findByText('permissionCode already governed for this subject')).toBeInTheDocument();
  });

  it('toggles a rule active/inactive', async () => {
    mockUpdateRule.mockResolvedValue(ok({ ...sampleRule, isActive: false }));
    render(<Governance />);
    await screen.findByText('schedule.manage');

    await userEvent.click(screen.getByTitle('Deactivate'));

    await waitFor(() => expect(mockUpdateRule).toHaveBeenCalledWith(1, { isActive: false }));
  });

  it('deletes a rule after confirmation', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
    mockDeleteRule.mockResolvedValue(ok(undefined));
    render(<Governance />);
    await screen.findByText('schedule.manage');

    await userEvent.click(screen.getByTitle('Delete'));

    await waitFor(() => expect(mockDeleteRule).toHaveBeenCalledWith(1));
    confirmSpy.mockRestore();
  });

  it('does not delete a rule when the confirmation is declined', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);
    render(<Governance />);
    await screen.findByText('schedule.manage');

    await userEvent.click(screen.getByTitle('Delete'));

    expect(mockDeleteRule).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});

describe('<Governance /> — change request mutations', () => {
  beforeEach(() => {
    mockListRules.mockResolvedValue(ok([sampleRule]));
    mockListCr.mockResolvedValue(ok({ total: 1, items: [sampleCr] }));
  });

  it('submits a new change request with the parsed JSON payload', async () => {
    mockCreateCr.mockResolvedValue(ok({ ...sampleCr, id: 99 }));
    render(<Governance />);
    await userEvent.click(screen.getByText(/Change Requests/));
    await screen.findByText('Schedule.Override');

    await userEvent.click(screen.getByText(/New Request/));
    await userEvent.type(screen.getByPlaceholderText('e.g. Schedule.Override'), 'Shift.Delete');
    await userEvent.type(screen.getByPlaceholderText('e.g. schedule'), 'shift');
    await userEvent.click(screen.getByText('Submit Request'));

    await waitFor(() =>
      expect(mockCreateCr).toHaveBeenCalledWith(
        expect.objectContaining({ changeType: 'Shift.Delete', targetEntityType: 'shift', proposedPayload: {} })
      )
    );
    await waitFor(() => expect(screen.queryByText('Propose a Change')).not.toBeInTheDocument());
  });

  it('rejects invalid JSON in the payload without calling the service', async () => {
    render(<Governance />);
    await userEvent.click(screen.getByText(/Change Requests/));
    await screen.findByText('Schedule.Override');

    await userEvent.click(screen.getByText(/New Request/));
    await userEvent.type(screen.getByPlaceholderText('e.g. Schedule.Override'), 'Shift.Delete');
    await userEvent.type(screen.getByPlaceholderText('e.g. schedule'), 'shift');
    const payloadField = document.querySelector('textarea.font-monospace') as HTMLTextAreaElement;
    await userEvent.clear(payloadField);
    // Braces are userEvent's special-key syntax, so they must be escaped by
    // doubling — this still ends up as the literal malformed JSON `{not json`.
    await userEvent.type(payloadField, '{{not json');
    await userEvent.click(screen.getByText('Submit Request'));

    expect(mockCreateCr).not.toHaveBeenCalled();
    expect(await screen.findByText('Proposed payload must be valid JSON')).toBeInTheDocument();
  });

  it('approves a pending request', async () => {
    mockApproveCr.mockResolvedValue(ok({ ...sampleCr, status: 'approved' }));
    render(<Governance />);
    await userEvent.click(screen.getByText(/Change Requests/));
    await screen.findByText('Schedule.Override');

    await userEvent.click(screen.getByTitle('Approve'));

    await waitFor(() => expect(mockApproveCr).toHaveBeenCalledWith(42));
  });

  it('rejects a pending request with a reason via the modal', async () => {
    mockRejectCr.mockResolvedValue(ok({ ...sampleCr, status: 'rejected' }));
    render(<Governance />);
    await userEvent.click(screen.getByText(/Change Requests/));
    await screen.findByText('Schedule.Override');

    await userEvent.click(screen.getByTitle('Reject'));
    const reasonBox = screen.getByPlaceholderText(/being rejected/i);
    await userEvent.type(reasonBox, 'Conflicts with existing coverage');
    await userEvent.click(screen.getByText('Reject', { selector: 'button.btn-danger' }));

    await waitFor(() =>
      expect(mockRejectCr).toHaveBeenCalledWith(42, 'Conflicts with existing coverage')
    );
  });

  it('disables the reject confirm button until a reason is typed', async () => {
    render(<Governance />);
    await userEvent.click(screen.getByText(/Change Requests/));
    await screen.findByText('Schedule.Override');

    await userEvent.click(screen.getByTitle('Reject'));
    const confirmBtn = screen.getByText('Reject', { selector: 'button.btn-danger' });
    expect(confirmBtn).toBeDisabled();

    await userEvent.type(screen.getByPlaceholderText(/being rejected/i), 'x');
    expect(confirmBtn).toBeEnabled();
  });

  it('applies an approved request', async () => {
    mockListCr.mockResolvedValue(ok({ total: 1, items: [{ ...sampleCr, status: 'approved' }] }));
    mockApplyCr.mockResolvedValue(ok({ ...sampleCr, status: 'applied' }));
    render(<Governance />);
    await userEvent.click(screen.getByText(/Change Requests/));
    await screen.findByText('Schedule.Override');

    await userEvent.click(screen.getByTitle('Apply'));

    await waitFor(() => expect(mockApplyCr).toHaveBeenCalledWith(42));
  });

  it('cancels a pending request after confirmation', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
    mockCancelCr.mockResolvedValue(ok({ ...sampleCr, status: 'cancelled' }));
    render(<Governance />);
    await userEvent.click(screen.getByText(/Change Requests/));
    await screen.findByText('Schedule.Override');

    await userEvent.click(screen.getByTitle('Cancel'));

    await waitFor(() => expect(mockCancelCr).toHaveBeenCalledWith(42));
    confirmSpy.mockRestore();
  });
});
