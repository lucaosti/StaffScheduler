/**
 * Skills catalogue page.
 *
 * The assertion that matters is the refusal path: the server explains why a
 * skill in use cannot be deleted and what to do instead, and the page must
 * relay that rather than replacing it with a generic failure — the explanation
 * is the whole value of refusing.
 *
 * @author Luca Ostinelli
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../test-utils/renderWithClient';
import Skills from './Skills';

const okResponse = <T,>(data: T) => Promise.resolve({ success: true as const, data });

const getSkills = jest.fn();
const createSkill = jest.fn();
const updateSkill = jest.fn();
const deleteSkill = jest.fn();

jest.mock('../../services/skillService', () => ({
  __esModule: true,
  getSkills: (...a: unknown[]) => getSkills(...a),
  createSkill: (...a: unknown[]) => createSkill(...a),
  updateSkill: (...a: unknown[]) => updateSkill(...a),
  deleteSkill: (...a: unknown[]) => deleteSkill(...a),
}));

const skill = (over: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'Triage',
  description: 'Assess and prioritise',
  isActive: true,
  employeeCount: 0,
  shiftRequirementCount: 0,
  ...over,
});

beforeEach(() => {
  getSkills.mockReset().mockImplementation(() => okResponse([skill()]));
  createSkill.mockReset().mockImplementation(() => okResponse(skill({ id: 2 })));
  updateSkill.mockReset().mockImplementation(() => okResponse(skill({ isActive: false })));
  deleteSkill.mockReset().mockImplementation(() => okResponse(undefined));
});

describe('Skills', () => {
  it('shows the usage counts in the table', async () => {
    getSkills.mockImplementation(() =>
      okResponse([skill({ employeeCount: 4, shiftRequirementCount: 2 })])
    );

    render(<Skills />);
    await screen.findByText('Triage');
    // Behind a detail view these are counts nobody reads before deciding.
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('shows the empty state rather than a bare table', async () => {
    getSkills.mockImplementation(() => okResponse([]));
    render(<Skills />);
    expect(await screen.findByText(/no skills defined/i)).toBeInTheDocument();
  });

  it('creates a skill and clears the form', async () => {
    render(<Skills />);
    await screen.findByText('Triage');

    await userEvent.type(screen.getByLabelText('Name'), 'Phlebotomy');
    await userEvent.click(screen.getByRole('button', { name: 'Add skill' }));

    await waitFor(() =>
      expect(createSkill).toHaveBeenCalledWith({ name: 'Phlebotomy', description: null })
    );
    // An empty description is sent as null, not as "": the column is nullable
    // and an empty string would be a different, meaningless value.
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue(''));
  });

  it('retires a skill through the ordinary update', async () => {
    render(<Skills />);
    await screen.findByText('Triage');

    await userEvent.click(screen.getByRole('button', { name: 'Retire' }));
    await waitFor(() => expect(updateSkill).toHaveBeenCalledWith(1, { isActive: false }));
  });

  it('relays the server\'s reason when a delete is refused', async () => {
    deleteSkill.mockImplementation(() =>
      Promise.reject(
        new Error(
          'Cannot delete a skill in use (3 employee(s), 2 shift requirement(s)). Deactivate it instead'
        )
      )
    );

    render(<Skills />);
    await screen.findByText('Triage');
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    // The counts and the alternative are the point of the refusal; a generic
    // "failed" would throw away everything that makes it useful.
    expect(await screen.findByRole('alert')).toHaveTextContent(/3 employee\(s\)/);
    expect(screen.getByRole('alert')).toHaveTextContent(/Deactivate it instead/);
  });

  it('deletes a skill nothing references', async () => {
    render(<Skills />);
    await screen.findByText('Triage');
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(deleteSkill).toHaveBeenCalledWith(1));
  });
});
