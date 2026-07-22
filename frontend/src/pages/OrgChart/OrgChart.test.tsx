/**
 * Tests for OrgChart page.
 *
 * @author Luca Ostinelli
 */

import { screen, waitFor } from '@testing-library/react';
import { render } from '../../test-utils/renderWithClient';
import userEvent from '@testing-library/user-event';
import OrgChart from './OrgChart';

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, email: 'admin@demo.staffscheduler.local' } }),
}));

jest.mock('../../services/orgService', () => ({
  getTree: jest.fn(),
  getManagerChain: jest.fn(),
  listMembersDetailed: jest.fn(),
}));

const { getTree: mockGetTree, getManagerChain: mockGetManagerChain, listMembersDetailed: mockListMembersDetailed } =
  jest.requireMock('../../services/orgService') as {
    getTree: jest.Mock;
    getManagerChain: jest.Mock;
    listMembersDetailed: jest.Mock;
  };

const TREE = [
  {
    id: 1,
    name: 'Engineering',
    description: 'Tech department',
    parentId: null,
    children: [
      {
        id: 2,
        name: 'Backend',
        description: null,
        parentId: 1,
        children: [],
      },
      {
        id: 3,
        name: 'Frontend',
        description: 'UI team',
        parentId: 1,
        children: [],
      },
    ],
  },
  {
    id: 4,
    name: 'HR',
    description: null,
    parentId: null,
    children: [],
  },
];

const makeResponse = (data: unknown = TREE) => ({ success: true, data });

beforeEach(() => {
  mockGetTree.mockResolvedValue(makeResponse());
  mockGetManagerChain.mockResolvedValue(makeResponse([]));
  mockListMembersDetailed.mockResolvedValue(makeResponse([]));
});

afterEach(() => jest.clearAllMocks());

describe('<OrgChart />', () => {
  it('renders the page heading', async () => {
    render(<OrgChart />);
    expect(screen.getByRole('heading', { name: /organisation chart/i })).toBeInTheDocument();
  });

  it('renders all nodes after loading', async () => {
    render(<OrgChart />);
    expect(await screen.findByRole('button', { name: /^engineering/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /backend/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /frontend/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /hr/i })).toBeInTheDocument();
  });

  it('shows empty state when no org units', async () => {
    mockGetTree.mockResolvedValue(makeResponse([]));
    render(<OrgChart />);
    expect(await screen.findByText(/no org units found/i)).toBeInTheDocument();
  });

  it('shows error alert on load failure', async () => {
    mockGetTree.mockRejectedValue(new Error('Unauthorized'));
    render(<OrgChart />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('shows SVG with aria-label after loading', async () => {
    render(<OrgChart />);
    expect(await screen.findByRole('img', { name: /organisation chart/i })).toBeInTheDocument();
  });

  it('parent node exposes an expand/collapse toggle', async () => {
    render(<OrgChart />);
    await screen.findByRole('button', { name: /^engineering/i });
    expect(screen.getByRole('button', { name: /collapse engineering/i })).toBeInTheDocument();
  });

  it('collapses children when the toggle control is clicked', async () => {
    render(<OrgChart />);
    await screen.findByRole('button', { name: /^engineering/i });

    await userEvent.click(screen.getByRole('button', { name: /collapse engineering/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /expand engineering/i })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /^backend/i })).not.toBeInTheDocument();
  });

  it('re-expands on second click', async () => {
    render(<OrgChart />);
    await screen.findByRole('button', { name: /^engineering/i });

    await userEvent.click(screen.getByRole('button', { name: /collapse engineering/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /expand engineering/i })).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /expand engineering/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /collapse engineering/i })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /^backend/i })).toBeInTheDocument();
  });

  it('leaf nodes do not expose an expand/collapse toggle', async () => {
    render(<OrgChart />);
    await screen.findByRole('button', { name: /^hr/i });
    expect(screen.queryByRole('button', { name: /expand hr|collapse hr/i })).not.toBeInTheDocument();
  });

  it('clicking a node opens its member detail panel', async () => {
    mockListMembersDetailed.mockResolvedValue(makeResponse([
      { userId: 9, firstName: 'Mario', lastName: 'Rossi', email: 'mario@demo.local', position: 'Engineer', isPrimary: true },
    ]));
    render(<OrgChart />);
    await screen.findByRole('button', { name: /^engineering/i });

    await userEvent.click(screen.getByRole('button', { name: /^engineering/i }));

    expect(await screen.findByRole('dialog', { name: /engineering details/i })).toBeInTheDocument();
    expect(await screen.findByText('Mario Rossi')).toBeInTheDocument();
    expect(mockListMembersDetailed).toHaveBeenCalledWith(1);
  });

  it('Collapse all button collapses all parent nodes', async () => {
    render(<OrgChart />);
    await screen.findByRole('button', { name: /^engineering/i });

    await userEvent.click(screen.getByRole('button', { name: /collapse all nodes/i }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /backend/i })).not.toBeInTheDocument());
  });

  it('Expand all button restores all nodes', async () => {
    render(<OrgChart />);
    await screen.findByRole('button', { name: /^engineering/i });

    await userEvent.click(screen.getByRole('button', { name: /collapse all nodes/i }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /backend/i })).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /expand all nodes/i }));
    await screen.findByRole('button', { name: /backend/i });
  });

  it('Refresh button reloads tree', async () => {
    render(<OrgChart />);
    await screen.findByRole('button', { name: /^engineering/i });

    await userEvent.click(screen.getByRole('button', { name: /refresh org chart/i }));
    await waitFor(() => expect(mockGetTree).toHaveBeenCalledTimes(2));
  });
});
