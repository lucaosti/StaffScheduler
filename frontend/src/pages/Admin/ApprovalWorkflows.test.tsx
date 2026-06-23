/**
 * Tests for ApprovalWorkflows admin page.
 *
 * @author Luca Ostinelli
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ApprovalWorkflows from './ApprovalWorkflows';

jest.mock('../../services/approvalWorkflowService', () => ({
  listWorkflows: jest.fn(),
  createWorkflow: jest.fn(),
  updateWorkflow: jest.fn(),
  deleteWorkflow: jest.fn(),
}));

const {
  listWorkflows: mockListWorkflows,
  createWorkflow: mockCreateWorkflow,
  updateWorkflow: mockUpdateWorkflow,
  deleteWorkflow: mockDeleteWorkflow,
} = jest.requireMock('../../services/approvalWorkflowService') as {
  listWorkflows: jest.Mock;
  createWorkflow: jest.Mock;
  updateWorkflow: jest.Mock;
  deleteWorkflow: jest.Mock;
};

const WF_1 = {
  id: 1,
  changeType: 'TimeOff.Request',
  requireAll: false,
  description: 'Time off approval chain',
  steps: [
    {
      id: 10,
      workflowId: 1,
      stepOrder: 1,
      approverScope: 'unit_manager',
      approverRoleId: null,
      approverUserId: null,
      autoApproveForOwner: false,
      escalateAfterHours: 48,
    },
  ],
  createdAt: '2024-01-10T08:00:00.000Z',
  updatedAt: '2024-01-10T08:00:00.000Z',
};

const WF_2 = {
  id: 2,
  changeType: 'Schedule.Publish',
  requireAll: true,
  description: null,
  steps: [],
  createdAt: '2024-01-11T08:00:00.000Z',
  updatedAt: '2024-01-11T08:00:00.000Z',
};

beforeEach(() => {
  mockListWorkflows.mockResolvedValue({ success: true, data: [WF_1, WF_2] });
  mockCreateWorkflow.mockResolvedValue({ success: true, data: { ...WF_1, id: 3, changeType: 'New.Type' } });
  mockUpdateWorkflow.mockResolvedValue({ success: true, data: WF_1 });
  mockDeleteWorkflow.mockResolvedValue({ success: true });
});

afterEach(() => jest.clearAllMocks());

describe('<ApprovalWorkflows />', () => {
  it('renders the page heading', async () => {
    render(<ApprovalWorkflows />);
    expect(screen.getByRole('heading', { name: /approval workflows/i })).toBeInTheDocument();
  });

  it('shows workflows after loading', async () => {
    render(<ApprovalWorkflows />);
    expect(await screen.findByText('TimeOff.Request')).toBeInTheDocument();
    expect(screen.getByText('Schedule.Publish')).toBeInTheDocument();
  });

  it('shows "no workflows" when list is empty', async () => {
    mockListWorkflows.mockResolvedValue({ success: true, data: [] });
    render(<ApprovalWorkflows />);
    expect(await screen.findByText(/no approval workflows/i)).toBeInTheDocument();
  });

  it('shows error alert on load failure', async () => {
    mockListWorkflows.mockRejectedValue(new Error('Network error'));
    render(<ApprovalWorkflows />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/network error/i)).toBeInTheDocument();
  });

  it('shows New Workflow button', async () => {
    render(<ApprovalWorkflows />);
    expect(screen.getByRole('button', { name: /new workflow/i })).toBeInTheDocument();
  });

  it('opens create modal when New Workflow is clicked', async () => {
    render(<ApprovalWorkflows />);
    await userEvent.click(screen.getByRole('button', { name: /new workflow/i }));
    expect(screen.getByRole('dialog', { name: /create workflow/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/change type/i)).toBeInTheDocument();
  });

  it('closes modal when Cancel is clicked', async () => {
    render(<ApprovalWorkflows />);
    await userEvent.click(screen.getByRole('button', { name: /new workflow/i }));
    await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(screen.queryByRole('dialog', { name: /create workflow/i })).not.toBeInTheDocument();
  });

  it('shows validation error when Change Type is empty on save', async () => {
    render(<ApprovalWorkflows />);
    await userEvent.click(screen.getByRole('button', { name: /new workflow/i }));
    await userEvent.click(screen.getByRole('button', { name: /create workflow/i }));
    expect(screen.getByText(/change type is required/i)).toBeInTheDocument();
  });

  it('calls createWorkflow and reloads list on successful create', async () => {
    render(<ApprovalWorkflows />);
    await userEvent.click(screen.getByRole('button', { name: /new workflow/i }));

    await userEvent.type(screen.getByLabelText(/change type/i), 'New.Type');
    await userEvent.click(screen.getByRole('button', { name: /create workflow/i }));

    await waitFor(() => expect(mockCreateWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ changeType: 'New.Type' })
    ));
    await waitFor(() => expect(mockListWorkflows).toHaveBeenCalledTimes(2));
  });

  it('opens edit modal pre-filled with workflow data', async () => {
    render(<ApprovalWorkflows />);
    await screen.findByText('TimeOff.Request');

    await userEvent.click(screen.getByRole('button', { name: /edit workflow timeoff.request/i }));

    const descInput = screen.getByLabelText(/description/i) as HTMLInputElement;
    expect(descInput.value).toBe('Time off approval chain');

    // Change Type field should be disabled in edit mode
    const ctInput = screen.getByLabelText(/change type/i) as HTMLInputElement;
    expect(ctInput.disabled).toBe(true);
  });

  it('calls updateWorkflow on save in edit mode', async () => {
    render(<ApprovalWorkflows />);
    await screen.findByText('TimeOff.Request');

    await userEvent.click(screen.getByRole('button', { name: /edit workflow timeoff.request/i }));
    await userEvent.click(screen.getByRole('button', { name: /save workflow/i }));

    await waitFor(() => expect(mockUpdateWorkflow).toHaveBeenCalledWith(
      1, expect.objectContaining({ description: 'Time off approval chain' })
    ));
  });

  it('shows and hides step list when steps count is clicked', async () => {
    render(<ApprovalWorkflows />);
    await screen.findByText('TimeOff.Request');

    await userEvent.click(screen.getByRole('button', { name: /show steps for timeoff.request/i }));
    expect(screen.getByText('Unit Manager')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /collapse steps for timeoff.request/i }));
    expect(screen.queryByText('Unit Manager')).not.toBeInTheDocument();
  });

  it('opens delete confirm dialog and calls deleteWorkflow on confirm', async () => {
    render(<ApprovalWorkflows />);
    await screen.findByText('TimeOff.Request');

    await userEvent.click(screen.getByRole('button', { name: /delete workflow timeoff.request/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /delete workflow/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /confirm delete workflow timeoff.request/i }));
    await waitFor(() => expect(mockDeleteWorkflow).toHaveBeenCalledWith(1));
    await waitFor(() => expect(mockListWorkflows).toHaveBeenCalledTimes(2));
  });

  it('adds and removes steps in the form', async () => {
    render(<ApprovalWorkflows />);
    await userEvent.click(screen.getByRole('button', { name: /new workflow/i }));

    await userEvent.click(screen.getByRole('button', { name: /add step/i }));

    // After adding a step there should be 2 remove buttons (one per step)
    const removeButtons = screen.getAllByRole('button', { name: /remove step/i });
    expect(removeButtons.length).toBe(2);

    await userEvent.click(removeButtons[1]);
    expect(screen.getAllByRole('button', { name: /remove step/i }).length).toBe(1);
  });
});
