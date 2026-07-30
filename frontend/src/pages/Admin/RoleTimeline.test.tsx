/**
 * The role history panel.
 *
 * The cases with weight are the two the audit log cannot answer on its own: a
 * current grant with no event behind it, and a grant that lapsed without anyone
 * revoking it. Both are silent failures if the panel renders them as ordinary
 * rows — the first reads as "never granted", the second as "still held".
 *
 * @author Luca Ostinelli
 */

import { render, screen } from '../../test-utils/renderWithClient';
import RoleTimeline from './RoleTimeline';

const mockQuery = jest.fn();
jest.mock('../../hooks/useRbac', () => ({
  useRoleTimelineQuery: (...args: unknown[]) => mockQuery(...args),
}));

const entry = (over: Record<string, unknown> = {}) => ({
  auditId: 1,
  at: '2026-03-01T10:30:00.000Z',
  action: 'granted',
  userId: 5,
  userName: 'Anna Rossi',
  roleId: 3,
  roleName: 'Manager',
  scopeOrgUnitId: null,
  scopeOrgUnitName: null,
  expiresAt: null,
  actorId: 99,
  actorName: 'Carla Neri',
  justification: 'new hire',
  derived: false,
  ...over,
});

const grant = (over: Record<string, unknown> = {}) => ({
  userId: 5,
  userName: 'Anna Rossi',
  roleId: 3,
  roleName: 'Manager',
  scopeOrgUnitId: null,
  scopeOrgUnitName: null,
  expiresAt: null,
  hasHistory: true,
  ...over,
});

const result = (data: unknown) => ({
  data,
  isLoading: false,
  isError: false,
  error: null,
  refetch: jest.fn(),
});

const subject = { kind: 'user' as const, id: 5 };

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockReturnValue(result({ current: [grant()], entries: [entry()], truncated: false }));
});

describe('<RoleTimeline />', () => {
  it('asks for nothing until a subject is chosen', () => {
    render(<RoleTimeline subject={null} />);
    expect(mockQuery).toHaveBeenCalledWith(null);
    expect(screen.getByText(/select someone/i)).toBeInTheDocument();
  });

  it('shows who granted what, and why', () => {
    render(<RoleTimeline subject={subject} />);

    // "Who gave this person that, and what did they say" is the question; both
    // are columns rather than a click away.
    expect(screen.getByRole('cell', { name: 'Carla Neri' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'new hire' })).toBeInTheDocument();
    expect(screen.getByText('granted')).toBeInTheDocument();
  });

  it('flags a current grant the log cannot account for', () => {
    mockQuery.mockReturnValue(result({ current: [grant({ hasHistory: false })], entries: [], truncated: false }));
    render(<RoleTimeline subject={subject} />);

    // Predates the audit log, or was seeded. An empty cell would read as
    // "never granted", which is the opposite of true.
    expect(screen.getByText('not in the log')).toBeInTheDocument();
  });

  it('shows a lapsed grant as inferred, with nobody responsible', () => {
    mockQuery.mockReturnValue(
      result({
        current: [],
        entries: [entry({ auditId: null, action: 'expired', derived: true, actorId: null, actorName: null, justification: null })],
        truncated: false,
      })
    );
    render(<RoleTimeline subject={subject} />);

    expect(screen.getByText('expired')).toBeInTheDocument();
    expect(screen.getByText('inferred')).toBeInTheDocument();
    // Nobody revoked it — it simply stopped applying, and attributing it to a
    // person would be a fabrication.
    expect(screen.getByRole('cell', { name: /nobody — it lapsed/ })).toBeInTheDocument();
  });

  it('says when the list is only a window', () => {
    mockQuery.mockReturnValue(result({ current: [], entries: [entry()], truncated: true }));
    render(<RoleTimeline subject={subject} />);
    expect(screen.getByRole('note')).toHaveTextContent(/most recent events only/i);
  });

  it('does not claim truncation when there is none', () => {
    render(<RoleTimeline subject={subject} />);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('names the scope, defaulting to all units', () => {
    mockQuery.mockReturnValue(
      result({
        current: [grant({ scopeOrgUnitId: 7, scopeOrgUnitName: 'Ward A' })],
        entries: [],
        truncated: false,
      })
    );
    render(<RoleTimeline subject={subject} />);
    expect(screen.getByRole('cell', { name: 'Ward A' })).toBeInTheDocument();
  });

  it('shows the role for a person, and the person for a role', () => {
    render(<RoleTimeline subject={{ kind: 'role', id: 3 }} />);
    // The same envelope read from the other side: the column that varies is the
    // one the subject does not fix.
    expect(screen.getAllByRole('columnheader', { name: 'Person' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('cell', { name: 'Anna Rossi' }).length).toBeGreaterThan(0);
  });

  it('says plainly when nothing was recorded', () => {
    mockQuery.mockReturnValue(result({ current: [], entries: [], truncated: false }));
    render(<RoleTimeline subject={subject} />);

    expect(screen.getByText(/no roles currently granted/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing recorded/i)).toBeInTheDocument();
  });

  it('surfaces a load failure', () => {
    mockQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('boom'),
      refetch: jest.fn(),
    });
    render(<RoleTimeline subject={subject} />);
    expect(screen.getByRole('alert')).toHaveTextContent('boom');
  });
});
