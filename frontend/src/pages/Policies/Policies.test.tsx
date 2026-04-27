import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockListPolicies = jest.fn();
const mockCreatePolicy = jest.fn();
const mockUpdatePolicy = jest.fn();
const mockDeletePolicy = jest.fn();
const mockListExceptions = jest.fn();
const mockCreateException = jest.fn();
const mockApproveException = jest.fn();
const mockRejectException = jest.fn();
const mockCancelException = jest.fn();
const mockListMatrix = jest.fn();
const mockUpdateMatrix = jest.fn();

jest.mock('../../services/policyService', () => ({
  __esModule: true,
  listPolicies: (...args: unknown[]) => mockListPolicies(...args),
  createPolicy: (...args: unknown[]) => mockCreatePolicy(...args),
  updatePolicy: (...args: unknown[]) => mockUpdatePolicy(...args),
  deletePolicy: (...args: unknown[]) => mockDeletePolicy(...args),
  listExceptions: (...args: unknown[]) => mockListExceptions(...args),
  createException: (...args: unknown[]) => mockCreateException(...args),
  approveException: (...args: unknown[]) => mockApproveException(...args),
  rejectException: (...args: unknown[]) => mockRejectException(...args),
  cancelException: (...args: unknown[]) => mockCancelException(...args),
  listMatrix: (...args: unknown[]) => mockListMatrix(...args),
  updateMatrix: (...args: unknown[]) => mockUpdateMatrix(...args),
}));

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, email: 'admin@x', role: 'admin' } }),
}));

import Policies from './Policies';

const ok = <T,>(data: T) => Promise.resolve({ success: true as const, data });

describe('<Policies />', () => {
  beforeEach(() => {
    jest.spyOn(window, 'confirm').mockReturnValue(true);

    mockListPolicies.mockResolvedValue(
      ok([
        {
          id: 1,
          scopeType: 'global',
          scopeId: null,
          policyKey: 'rest_hours',
          policyValue: { minRestHours: 11 },
          description: 'Rest',
          isActive: true,
          createdAt: 'x',
        },
      ])
    );
    mockListExceptions.mockResolvedValue(
      ok([
        {
          id: 10,
          policyId: 1,
          targetType: 'shift_assignment',
          targetId: 123,
          status: 'pending',
          requestedByUserId: 1,
          createdAt: 'x',
        },
      ])
    );
    mockListMatrix.mockResolvedValue(
      ok([
        {
          changeType: 'policy_update',
          approverScope: 'global',
          approverRole: 'admin',
          approverUserId: null,
          autoApproveForOwner: false,
          description: 'desc',
        },
      ])
    );

    mockCreatePolicy.mockResolvedValue(ok({ id: 2 }));
    mockUpdatePolicy.mockResolvedValue(ok({ id: 1 }));
    mockDeletePolicy.mockResolvedValue(ok(undefined));
    mockCreateException.mockResolvedValue(ok({ id: 99 }));
    mockApproveException.mockResolvedValue(ok({ id: 10 }));
    mockRejectException.mockResolvedValue(ok({ id: 10 }));
    mockCancelException.mockResolvedValue(ok({ id: 10 }));
    mockUpdateMatrix.mockResolvedValue(ok({ id: 1 }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates policy (string payload path), toggles active, deletes, creates & acts on exceptions, and edits matrix', async () => {
    render(<Policies />);
    expect(await screen.findByRole('heading', { name: /policies/i })).toBeInTheDocument();

    // Create policy with invalid JSON -> keep string branch
    await userEvent.type(
      screen.getByPlaceholderText(/policy key/i),
      'max_hours'
    );
    await userEvent.clear(screen.getByPlaceholderText(/value json/i));
    fireEvent.change(screen.getByPlaceholderText(/value json/i), {
      target: { value: '{invalid' },
    });
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }));
    expect(mockCreatePolicy).toHaveBeenCalled();

    // Toggle active
    await userEvent.click(await screen.findByRole('button', { name: /deactivate/i }));
    expect(mockUpdatePolicy).toHaveBeenCalled();

    // Delete policy
    await userEvent.click(await screen.findByRole('button', { name: /^delete$/i }));
    expect(mockDeletePolicy).toHaveBeenCalled();

    // Exceptions tab + create exception + approve/reject/cancel
    await userEvent.click(screen.getByRole('button', { name: /exceptions/i }));
    await userEvent.selectOptions(screen.getByRole('combobox'), '1');
    await userEvent.type(screen.getByPlaceholderText(/target id/i), '123');
    await userEvent.type(screen.getByPlaceholderText(/^reason$/i), 'because');
    await userEvent.click(screen.getByRole('button', { name: /^request$/i }));
    expect(mockCreateException).toHaveBeenCalled();

    await userEvent.click(await screen.findByRole('button', { name: /approve/i }));
    expect(mockApproveException).toHaveBeenCalled();
    await userEvent.click(await screen.findByRole('button', { name: /reject/i }));
    expect(mockRejectException).toHaveBeenCalled();
    await userEvent.click(await screen.findByRole('button', { name: /cancel/i }));
    expect(mockCancelException).toHaveBeenCalled();

    // Matrix tab
    await userEvent.click(screen.getByRole('button', { name: /approval matrix/i }));
    const boxes = await screen.findAllByRole('checkbox');
    expect(boxes.length).toBeGreaterThan(0);
    await userEvent.click(boxes[0]);
    expect(mockUpdateMatrix).toHaveBeenCalled();
  });
});

