/**
 * The cost-plan admin panel: setting the labor-cost target compared against
 * actual spend on the Dashboard.
 *
 * @author Luca Ostinelli
 */

import { render, screen, waitFor, fireEvent } from '../../test-utils/renderWithClient';
import userEvent from '@testing-library/user-event';
import CostPlansSection from './CostPlansSection';

const mockList = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();

jest.mock('../../services/costPlanService', () => ({
  listCostPlans: (...args: unknown[]) => mockList(...args),
  createCostPlan: (...args: unknown[]) => mockCreate(...args),
  updateCostPlan: (...args: unknown[]) => mockUpdate(...args),
  deleteCostPlan: (...args: unknown[]) => mockDelete(...args),
}));

jest.mock('../../services/departmentService', () => ({
  getDepartments: () =>
    Promise.resolve({
      success: true,
      data: [{ id: 2, name: 'ER', isActive: true }],
    }),
}));

const plan = (over: Record<string, unknown> = {}) => ({
  id: 1,
  departmentId: 2,
  startDate: '2026-08-01',
  endDate: '2026-08-31',
  targetAmount: 10000,
  setByUserId: 7,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockList.mockResolvedValue({ success: true, data: [] });
  mockCreate.mockResolvedValue({ success: true, data: plan() });
  mockUpdate.mockResolvedValue({ success: true, data: plan({ targetAmount: 12000 }) });
  mockDelete.mockResolvedValue({ success: true });
});

describe('<CostPlansSection />', () => {
  it('shows an empty state when there are no plans', async () => {
    render(<CostPlansSection />);
    expect(await screen.findByText(/no cost plans set yet/i)).toBeInTheDocument();
  });

  it('lists an existing plan against its department', async () => {
    mockList.mockResolvedValue({ success: true, data: [plan()] });
    render(<CostPlansSection />);
    // Two "ER" occurrences once departments load: the table cell and the
    // (unrelated) select option — the row is what this test cares about.
    await waitFor(() => expect(screen.getAllByText('ER').length).toBeGreaterThan(0));
    expect(screen.getByText(/2026-08-01/)).toBeInTheDocument();
  });

  it('creates a plan from the form', async () => {
    render(<CostPlansSection />);
    // Wait for the department list to load before the option exists to select.
    await waitFor(() => expect(screen.getAllByText('ER').length).toBeGreaterThan(0));

    await userEvent.selectOptions(screen.getByLabelText(/department/i), '2');
    // Date inputs are typed digit-by-digit under userEvent's locale rules;
    // firing a plain change event with the ISO value is simpler and exact.
    fireEvent.change(screen.getByLabelText(/start date/i), { target: { value: '2026-08-01' } });
    fireEvent.change(screen.getByLabelText(/end date/i), { target: { value: '2026-08-31' } });
    await userEvent.type(screen.getByLabelText(/target amount/i), '10000');
    await userEvent.click(screen.getByRole('button', { name: /^create$/i }));

    // mutationFn is invoked with (variables, mutationContext) by this
    // TanStack Query version — only the first argument is this service call's
    // own payload.
    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith(
        {
          departmentId: 2,
          startDate: '2026-08-01',
          endDate: '2026-08-31',
          targetAmount: 10000,
        },
        expect.anything()
      )
    );
  });

  it('edits the target amount of an existing plan, keeping department and period fixed', async () => {
    mockList.mockResolvedValue({ success: true, data: [plan()] });
    render(<CostPlansSection />);

    await userEvent.click(await screen.findByRole('button', { name: /edit/i }));
    expect(screen.getByLabelText(/department/i)).toBeDisabled();

    const amountInput = screen.getByLabelText(/target amount/i);
    await userEvent.clear(amountInput);
    await userEvent.type(amountInput, '12000');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith(1, { targetAmount: 12000 }));
  });

  it('removes a plan after confirmation', async () => {
    mockList.mockResolvedValue({ success: true, data: [plan()] });
    window.confirm = jest.fn().mockReturnValue(true);
    render(<CostPlansSection />);

    await userEvent.click(await screen.findByRole('button', { name: /remove/i }));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith(1));
  });
});
