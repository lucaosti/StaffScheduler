import { fireEvent, screen, within } from '@testing-library/react';
import { render } from '../../test-utils/renderWithClient';
import userEvent from '@testing-library/user-event';
import { createUserBody } from '@staff-scheduler/shared';

const mockGetEmployees = jest.fn();
const mockCreateEmployee = jest.fn();
const mockUpdateEmployee = jest.fn();
const mockDeleteEmployee = jest.fn();
const mockGetDepartments = jest.fn();

jest.mock('../../services/employeeService', () => ({
  __esModule: true,
  getEmployees: (...args: unknown[]) => mockGetEmployees(...args),
  createEmployee: (...args: unknown[]) => mockCreateEmployee(...args),
  updateEmployee: (...args: unknown[]) => mockUpdateEmployee(...args),
  deleteEmployee: (...args: unknown[]) => mockDeleteEmployee(...args),
}));

jest.mock('../../services/departmentService', () => ({
  __esModule: true,
  getDepartments: (...args: unknown[]) => mockGetDepartments(...args),
}));

// Always allow page render for role-gated UI.
jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, email: 'admin@x', role: 'admin' } }),
}));

const Employees = require('./Employees').default;

const ok = <T,>(data: T) => Promise.resolve({ success: true as const, data });

describe('<Employees />', () => {
  beforeEach(() => {
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
    mockGetDepartments.mockResolvedValue(ok([
      { id: 1, name: 'Emergency Medicine', isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 2, name: 'Radiology', isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ]));
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

    // Department filter should keep one row (the filter combobox in the toolbar uses employee department names)
    const comboboxes = screen.getAllByRole('combobox');
    const deptSelect = comboboxes[0]; // first combobox is the department filter
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
    await userEvent.type(screen.getByLabelText(/initial password/i), 'Password1!');
    await userEvent.selectOptions(screen.getByLabelText(/^department$/i), '1');
    await userEvent.type(screen.getByLabelText(/^position$/i), 'Engineer');
    await userEvent.click(screen.getByRole('button', { name: /create employee/i }));
    expect(mockCreateEmployee).toHaveBeenCalled();

    // Asserting only that the service was called is what let a broken flow
    // pass: the form collected no password, which createUserBody requires, so
    // every real creation was rejected with a 400 while this test stayed
    // green. Validate the payload the form actually built against the schema
    // the server enforces.
    const sent = mockCreateEmployee.mock.calls[0][0];
    const parsed = createUserBody.safeParse(sent);
    expect(parsed.success).toBe(true);

    // Delete flow: click delete button, confirm via modal
    const delBtn = within(adaRow as HTMLElement).getByTitle(/delete employee/i);
    await userEvent.click(delBtn);
    // ConfirmModal should now be visible
    const confirmModal = await screen.findByRole('dialog');
    expect(confirmModal).toBeInTheDocument();
    await userEvent.click(within(confirmModal).getByRole('button', { name: /^delete$/i }));
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

