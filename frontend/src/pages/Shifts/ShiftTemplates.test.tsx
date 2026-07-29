/**
 * Shift templates.
 *
 * The assertion with the most weight is the wording: the button says Retire,
 * not Delete. The server marks a template inactive and leaves every shift ever
 * created from it untouched, so "Delete" would promise a reach into past
 * schedules that does not happen — and that nobody should want, since a shift
 * people have already worked cannot be edited by changing its pattern.
 *
 * @author Luca Ostinelli
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../test-utils/renderWithClient';
import ShiftTemplates from './ShiftTemplates';

const okResponse = <T,>(data: T) => Promise.resolve({ success: true as const, data });

let permissions: string[] = ['schedule.read', 'shift.manage'];
jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 5, permissions } }),
}));

const getShiftTemplates = jest.fn();
const createShiftTemplate = jest.fn();
const deleteShiftTemplate = jest.fn();

jest.mock('../../services/shiftService', () => ({
  __esModule: true,
  getShiftTemplates: (...a: unknown[]) => getShiftTemplates(...a),
  createShiftTemplate: (...a: unknown[]) => createShiftTemplate(...a),
  deleteShiftTemplate: (...a: unknown[]) => deleteShiftTemplate(...a),
  updateShiftTemplate: jest.fn(),
}));

const getDepartments = jest.fn();
jest.mock('../../services/departmentService', () => ({
  __esModule: true,
  getDepartments: (...a: unknown[]) => getDepartments(...a),
}));

const template = (over: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'Early',
  description: null,
  departmentId: 3,
  departmentName: 'Ward A',
  startTime: '07:00:00',
  endTime: '15:00:00',
  minStaff: 2,
  maxStaff: 4,
  ...over,
});

beforeEach(() => {
  permissions = ['schedule.read', 'shift.manage'];
  getShiftTemplates.mockReset().mockImplementation(() => okResponse([template()]));
  createShiftTemplate.mockReset().mockImplementation(() => okResponse(template({ id: 2 })));
  deleteShiftTemplate.mockReset().mockImplementation(() => okResponse(undefined));
  getDepartments.mockReset().mockImplementation(() => okResponse([{ id: 3, name: 'Ward A' }]));
});

describe('ShiftTemplates', () => {
  it('lists a template with its hours and staffing', async () => {
    render(<ShiftTemplates />);
    expect(await screen.findByRole('cell', { name: 'Early' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '07:00–15:00' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '2–4' })).toBeInTheDocument();
  });

  it('shows the empty state rather than a bare table', async () => {
    getShiftTemplates.mockImplementation(() => okResponse([]));
    render(<ShiftTemplates />);
    expect(await screen.findByText(/no shift templates/i)).toBeInTheDocument();
  });

  it('creates a template', async () => {
    render(<ShiftTemplates />);
    await screen.findByRole('cell', { name: 'Early' });

    await userEvent.type(screen.getByLabelText('Name'), 'Late');
    await userEvent.selectOptions(screen.getByLabelText('Department'), '3');
    await userEvent.click(screen.getByRole('button', { name: 'Add template' }));

    await waitFor(() =>
      expect(createShiftTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Late', departmentId: 3, minStaff: 1, maxStaff: 1 })
      )
    );
  });

  describe('retiring', () => {
    it('calls the action Retire, not Delete', async () => {
      render(<ShiftTemplates />);
      await screen.findByRole('cell', { name: 'Early' });
      // The server marks it inactive and leaves every shift created from it
      // untouched; "Delete" would promise a reach into past schedules that
      // does not happen.
      expect(screen.getByRole('button', { name: 'Retire' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    });

    it('says on the page what happens to shifts already created', async () => {
      render(<ShiftTemplates />);
      // "Retire" with no explanation invites the reader to wonder what became
      // of the shifts.
      expect(await screen.findByText(/already\s+created from it are unaffected/i)).toBeInTheDocument();
    });

    it('retires a template', async () => {
      render(<ShiftTemplates />);
      await userEvent.click(await screen.findByRole('button', { name: 'Retire' }));
      await waitFor(() => expect(deleteShiftTemplate).toHaveBeenCalledWith(1));
    });
  });

  describe('permissions', () => {
    it('shows templates but no controls without shift.manage', async () => {
      permissions = ['schedule.read'];
      render(<ShiftTemplates />);
      await screen.findByRole('cell', { name: 'Early' });

      expect(screen.queryByRole('button', { name: 'Add template' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Retire' })).not.toBeInTheDocument();
    });

    it('never fetches departments for a reader', async () => {
      permissions = ['schedule.read'];
      render(<ShiftTemplates />);
      await screen.findByRole('cell', { name: 'Early' });
      // The list exists to fill a picker that a reader never sees.
      expect(getDepartments).not.toHaveBeenCalled();
    });
  });

  it('relays the server\'s refusal', async () => {
    createShiftTemplate.mockImplementation(() =>
      Promise.reject(new Error('End time must differ from start time'))
    );
    render(<ShiftTemplates />);
    await screen.findByRole('cell', { name: 'Early' });
    await userEvent.type(screen.getByLabelText('Name'), 'Broken');
    await userEvent.selectOptions(screen.getByLabelText('Department'), '3');
    await userEvent.click(screen.getByRole('button', { name: 'Add template' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/must differ/);
  });
});
