/**
 * The Authority page.
 *
 * The case carrying the most weight is the unresolved step. A workflow step
 * whose approver resolves to nobody means requests of that kind cannot be
 * decided at all, it is silent everywhere else in the product, and this is the
 * only screen that can show it — so rendering it as an ordinary empty cell would
 * be the failure this page exists to prevent.
 *
 * The rest is about not lying: the lookup field appears only for someone the
 * server would actually answer, and the "because" column names the scope, since
 * "Anna decides this" invites the question that "because she manages your unit"
 * answers.
 *
 * @author Luca Ostinelli
 */

import { render, screen } from '../../test-utils/renderWithClient';
import userEvent from '@testing-library/user-event';
import Authority from './Authority';

const mockUseAuth = jest.fn();
jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockQuery = jest.fn();
jest.mock('../../hooks/useOrg', () => ({
  useAuthorityQuery: (...args: unknown[]) => mockQuery(...args),
}));

const person = (id: number, first = 'Anna', last = 'Rossi') => ({
  id,
  firstName: first,
  lastName: last,
  email: `u${id}@x.y`,
});

const profile = (over: Record<string, unknown> = {}) => ({
  subject: person(9, 'Mario', 'Bianchi'),
  managerChain: [{ unitId: 10, unitName: 'Ward A', manager: person(2) }],
  roleAdministrators: [{ ...person(3, 'Carla', 'Neri'), via: 'responsibility_rule' }],
  approvals: [
    {
      changeType: 'time_off',
      description: null,
      steps: [
        {
          stepOrder: 1,
          approverScope: 'unit_manager',
          permissionCode: null,
          approvers: [person(2)],
          unresolved: false,
        },
      ],
    },
  ],
  ...over,
});

const result = (data: unknown) => ({
  data,
  isLoading: false,
  isError: false,
  error: null,
  refetch: jest.fn(),
});

beforeEach(() => {
  jest.clearAllMocks();
  mockUseAuth.mockReturnValue({ user: { id: 9, permissions: [] } });
  mockQuery.mockReturnValue(result(profile()));
});

describe('<Authority />', () => {
  it('opens on the caller, asking for no particular user', () => {
    render(<Authority />);
    // null is "mine", which is why the hook is not gated on a selection.
    expect(mockQuery).toHaveBeenCalledWith(null);
  });

  it('shows the manager chain in order, nearest first', () => {
    mockQuery.mockReturnValue(
      result(
        profile({
          // Names distinct from the default approver, so a match here can only
          // have come from the chain.
          managerChain: [
            { unitId: 10, unitName: 'Ward A', manager: person(6, 'Sofia', 'Marino') },
            { unitId: 1, unitName: 'Hospital', manager: person(4, 'Luca', 'Verdi') },
          ],
        })
      )
    );
    render(<Authority />);

    expect(screen.getByText('Sofia Marino')).toBeInTheDocument();
    expect(screen.getByText('Luca Verdi')).toBeInTheDocument();
    expect(screen.getByText('Ward A')).toBeInTheDocument();
  });

  it('flags a unit whose manager is not set', () => {
    mockQuery.mockReturnValue(
      result(profile({ managerChain: [{ unitId: 10, unitName: 'Ward A', manager: null }] }))
    );
    render(<Authority />);
    expect(screen.getByText('No manager set')).toBeInTheDocument();
  });

  it('says plainly when there is no org-unit membership at all', () => {
    mockQuery.mockReturnValue(result(profile({ managerChain: [] })));
    render(<Authority />);
    expect(screen.getByText(/no org-unit membership/i)).toBeInTheDocument();
  });

  it('distinguishes a responsibility rule from a blanket permission', () => {
    mockQuery.mockReturnValue(
      result(
        profile({
          roleAdministrators: [
            { ...person(3, 'Carla', 'Neri'), via: 'responsibility_rule' },
            { ...person(5, 'Dario', 'Blu'), via: 'permission' },
          ],
        })
      )
    );
    render(<Authority />);

    expect(screen.getByText(/made responsible for you by a rule/i)).toBeInTheDocument();
    expect(screen.getByText(/holds role.manage across the organization/i)).toBeInTheDocument();
  });

  it('names the approver and why they are the approver', () => {
    render(<Authority />);
    expect(screen.getByRole('cell', { name: 'Anna Rossi' })).toBeInTheDocument();
    // The scope is what tells you which rule to fix when the answer is wrong.
    expect(screen.getByRole('cell', { name: 'manages your unit' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Time off' })).toBeInTheDocument();
  });

  it('shows the permission code behind a responsibility-rule step', () => {
    mockQuery.mockReturnValue(
      result(
        profile({
          approvals: [
            {
              changeType: 'change_request',
              description: null,
              steps: [
                {
                  stepOrder: 1,
                  approverScope: 'responsibility_rule',
                  permissionCode: 'change.approve',
                  approvers: [person(2)],
                  unresolved: false,
                },
              ],
            },
          ],
        })
      )
    );
    render(<Authority />);
    expect(screen.getByRole('cell', { name: /change\.approve/ })).toBeInTheDocument();
  });

  it('makes a step nobody can decide impossible to miss', () => {
    mockQuery.mockReturnValue(
      result(
        profile({
          approvals: [
            {
              changeType: 'time_off',
              description: null,
              steps: [
                {
                  stepOrder: 1,
                  approverScope: 'unit_manager',
                  permissionCode: null,
                  approvers: [],
                  unresolved: true,
                },
              ],
            },
          ],
        })
      )
    );
    render(<Authority />);

    expect(screen.getByText('Nobody')).toBeInTheDocument();
    // And an explanation, because "nobody" without a cause is alarming rather
    // than actionable.
    expect(screen.getByText(/cannot be decided at all/i)).toBeInTheDocument();
  });

  it('omits that explanation when every step resolves', () => {
    render(<Authority />);
    expect(screen.queryByText(/cannot be decided at all/i)).not.toBeInTheDocument();
  });

  it('says so when no workflows are configured', () => {
    mockQuery.mockReturnValue(result(profile({ approvals: [] })));
    render(<Authority />);
    expect(screen.getByText(/no approval workflows are configured/i)).toBeInTheDocument();
  });

  describe('looking someone else up', () => {
    it('is not offered without org_unit.read', () => {
      render(<Authority />);
      // Offering a field whose answer the server refuses is worse than not
      // offering it.
      expect(screen.queryByLabelText(/look up another person/i)).not.toBeInTheDocument();
    });

    it('is offered to a caller who holds it, and re-queries for that person', async () => {
      mockUseAuth.mockReturnValue({ user: { id: 9, permissions: ['org_unit.read'] } });
      render(<Authority />);

      await userEvent.type(screen.getByLabelText(/look up another person/i), '4');
      await userEvent.click(screen.getByRole('button', { name: 'Show' }));

      expect(mockQuery).toHaveBeenLastCalledWith(4);
    });

    it('names whose profile is on screen when it is not your own', async () => {
      mockUseAuth.mockReturnValue({ user: { id: 9, permissions: ['org_unit.read'] } });
      mockQuery.mockReturnValue(result(profile({ subject: person(4, 'Elena', 'Costa') })));
      render(<Authority />);

      await userEvent.type(screen.getByLabelText(/look up another person/i), '4');
      await userEvent.click(screen.getByRole('button', { name: 'Show' }));

      expect(screen.getByRole('note')).toHaveTextContent('Elena Costa');
    });

    it('falls back to your own profile on a non-numeric entry', async () => {
      mockUseAuth.mockReturnValue({ user: { id: 9, permissions: ['org_unit.read'] } });
      render(<Authority />);

      await userEvent.type(screen.getByLabelText(/look up another person/i), 'abc');
      await userEvent.click(screen.getByRole('button', { name: 'Show' }));

      expect(mockQuery).toHaveBeenLastCalledWith(null);
    });
  });

  it('surfaces a load failure rather than an empty page', () => {
    mockQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('boom'),
      refetch: jest.fn(),
    });
    render(<Authority />);
    expect(screen.getByRole('alert')).toHaveTextContent('boom');
  });
});
