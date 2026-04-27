import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetEmployees = jest.fn();
const mockCreateEmployee = jest.fn();
const mockUpdateEmployee = jest.fn();
const mockDeleteEmployee = jest.fn();

jest.mock('../../services/employeeService', () => ({
  __esModule: true,
  getEmployees: (...args: unknown[]) => mockGetEmployees(...args),
  createEmployee: (...args: unknown[]) => mockCreateEmployee(...args),
  updateEmployee: (...args: unknown[]) => mockUpdateEmployee(...args),
  deleteEmployee: (...args: unknown[]) => mockDeleteEmployee(...args),
}));

// Always allow page render for role-gated UI.
jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, email: 'admin@x', role: 'admin' } }),
}));

const Employees = require('./Employees').default;

const ok = <T,>(data: T) => Promise.resolve({ success: true as const, data });

describe('<Employees />', () => {
  beforeEach(() => {
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    jest.spyOn(window, 'alert').mockImplementation(() => undefined);

    mockGetEmployees.mockResolvedValue(
      ok([
        {
          id: 1,
          employeeId: 'E-001',
          firstName: 'Ada',
          lastName: 'Lovelace',
          email: 'ada@example.com',
          department: 'Emergency Medicine',
          position: 'Senior Physician',
          employeeType: 'full-time',
          hourlyRate: 55.5,
          maxHoursPerWeek: 40,
          isActive: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 2,
          employeeId: 'E-002',
          firstName: 'Grace',
          lastName: 'Hopper',
          email: 'grace@example.com',
          department: 'Radiology',
          position: 'Nurse',
          employeeType: 'part-time',
          hourlyRate: 33.25,
          maxHoursPerWeek: 24,
          isActive: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ])
    );
    mockCreateEmployee.mockResolvedValue(ok({ id: 99 }));
    mockUpdateEmployee.mockResolvedValue(ok({ id: 1 }));
    mockDeleteEmployee.mockResolvedValue(ok(undefined));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('filters, opens modals, and triggers create/update/delete flows', async () => {
    render(<Employees />);
    expect(await screen.findByRole('heading', { name: /employees/i })).toBeInTheDocument();

    // Search filter
    const search = screen.getByPlaceholderText(/search employees/i);
    await userEvent.type(search, 'Ada');
    expect(screen.getByText(/Ada Lovelace/)).toBeInTheDocument();
    // The page also refetches on every searchTerm change; we only assert the matching row is present.

    // Department filter should keep one row
    const deptSelect = screen.getByRole('combobox');
    await userEvent.selectOptions(deptSelect, 'Emergency Medicine');
    expect(screen.getByText(/Ada Lovelace/)).toBeInTheDocument();
    expect(screen.queryByText(/Grace Hopper/)).not.toBeInTheDocument();

    // Clear search so we can operate on the full table again.
    fireEvent.change(search, { target: { value: '' } });
    await userEvent.selectOptions(deptSelect, '');

    // Edit flow opens modal with defaults and submits update
    const rows = screen.getAllByRole('row');
    const adaRow = rows.find((r) => within(r).queryByText(/Ada Lovelace/));
    expect(adaRow).toBeTruthy();
    const editBtn = within(adaRow as HTMLElement).getByTitle(/edit employee/i);
    await userEvent.click(editBtn);
    expect(screen.getByText(/Edit Employee/i)).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText(/first name/i));
    await userEvent.type(screen.getByLabelText(/first name/i), 'Ada2');
    await userEvent.click(screen.getByRole('button', { name: /update employee/i }));
    expect(mockUpdateEmployee).toHaveBeenCalled();

    // Create flow (Add Employee)
    await userEvent.click(screen.getByRole('button', { name: /add employee/i }));
    expect(screen.getByText(/Add New Employee/i)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/employee id/i), 'E-003');
    await userEvent.type(screen.getByLabelText(/^email \*/i), 'new@example.com');
    await userEvent.type(screen.getByLabelText(/first name/i), 'New');
    await userEvent.type(screen.getByLabelText(/last name/i), 'Person');
    await userEvent.selectOptions(screen.getByLabelText(/department \*/i), 'Emergency Medicine');
    await userEvent.selectOptions(screen.getByLabelText(/position \*/i), 'Nurse');
    await userEvent.selectOptions(screen.getByLabelText(/employment type/i), 'full-time');
    await userEvent.click(screen.getByRole('button', { name: /create employee/i }));
    expect(mockCreateEmployee).toHaveBeenCalled();

    // Delete flow (delete the currently visible row)
    const delBtn = within(adaRow as HTMLElement).getByTitle(/delete employee/i);
    await userEvent.click(delBtn);
    expect(window.confirm).toHaveBeenCalled();
    expect(mockDeleteEmployee).toHaveBeenCalled();
  });

  it('shows the empty-state CTA when no employees exist', async () => {
    mockGetEmployees.mockResolvedValueOnce(ok([]));
    render(<Employees />);
    expect(await screen.findByText(/No employees found/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /add first employee/i }));
    expect(screen.getByText(/Add New Employee/i)).toBeInTheDocument();
  });
});

