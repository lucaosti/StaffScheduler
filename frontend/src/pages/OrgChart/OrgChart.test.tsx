/**
 * Tests for OrgChart page.
 *
 * @author Luca Ostinelli
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OrgChart from './OrgChart';

jest.mock('../../services/orgService', () => ({
  getTree: jest.fn(),
}));

const { getTree: mockGetTree } = jest.requireMock('../../services/orgService') as {
  getTree: jest.Mock;
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

const makeResponse = (data = TREE) => ({ success: true, data });

beforeEach(() => {
  mockGetTree.mockResolvedValue(makeResponse());
});

afterEach(() => jest.clearAllMocks());

describe('<OrgChart />', () => {
  it('renders the page heading', async () => {
    render(<OrgChart />);
    expect(screen.getByRole('heading', { name: /organisation chart/i })).toBeInTheDocument();
  });

  it('renders all nodes after loading', async () => {
    render(<OrgChart />);
    expect(await screen.findByRole('button', { name: /engineering/i })).toBeInTheDocument();
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

  it('parent node shows expanded aria state', async () => {
    render(<OrgChart />);
    await screen.findByRole('button', { name: /engineering/i });
    const engBtn = screen.getByRole('button', { name: /engineering/i });
    expect(engBtn).toHaveAttribute('aria-expanded', 'true');
  });

  it('collapses children when parent node is clicked', async () => {
    render(<OrgChart />);
    await screen.findByRole('button', { name: /engineering/i });

    // Click the Engineering node to collapse it
    await userEvent.click(screen.getByRole('button', { name: /engineering/i }));

    // After collapse, Engineering should be aria-expanded=false and Backend/Frontend hidden
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /engineering/i })).toHaveAttribute('aria-expanded', 'false');
    });
    expect(screen.queryByRole('button', { name: /backend/i })).not.toBeInTheDocument();
  });

  it('re-expands on second click', async () => {
    render(<OrgChart />);
    await screen.findByRole('button', { name: /engineering/i });

    await userEvent.click(screen.getByRole('button', { name: /engineering/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /engineering/i })).toHaveAttribute('aria-expanded', 'false'));

    await userEvent.click(screen.getByRole('button', { name: /engineering/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /engineering/i })).toHaveAttribute('aria-expanded', 'true'));
    expect(screen.getByRole('button', { name: /backend/i })).toBeInTheDocument();
  });

  it('leaf nodes do not have aria-expanded', async () => {
    render(<OrgChart />);
    await screen.findByRole('button', { name: /hr/i });
    expect(screen.getByRole('button', { name: /hr/i })).not.toHaveAttribute('aria-expanded');
  });

  it('Collapse all button collapses all parent nodes', async () => {
    render(<OrgChart />);
    await screen.findByRole('button', { name: /engineering/i });

    await userEvent.click(screen.getByRole('button', { name: /collapse all nodes/i }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /backend/i })).not.toBeInTheDocument());
  });

  it('Expand all button restores all nodes', async () => {
    render(<OrgChart />);
    await screen.findByRole('button', { name: /engineering/i });

    await userEvent.click(screen.getByRole('button', { name: /collapse all nodes/i }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /backend/i })).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /expand all nodes/i }));
    await screen.findByRole('button', { name: /backend/i });
  });

  it('Refresh button reloads tree', async () => {
    render(<OrgChart />);
    await screen.findByRole('button', { name: /engineering/i });

    await userEvent.click(screen.getByRole('button', { name: /refresh org chart/i }));
    await waitFor(() => expect(mockGetTree).toHaveBeenCalledTimes(2));
  });
});
