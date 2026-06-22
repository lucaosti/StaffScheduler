/**
 * Tests for OrgTree component.
 *
 * @author Luca Ostinelli
 */

import { render, screen, fireEvent } from '@testing-library/react';
import OrgTree from './OrgTree';
import type { OrgUnit, OrgUnitNode } from '../../services/orgService';

const makeUnit = (overrides: Partial<OrgUnit> = {}): OrgUnit => ({
  id: 1,
  name: 'Root Unit',
  description: null,
  parentId: null,
  managerUserId: null,
  isActive: true,
  createdAt: '2025-01-01',
  updatedAt: '2025-01-01',
  ...overrides,
});

const makeNode = (overrides: Partial<OrgUnitNode> = {}): OrgUnitNode => ({
  id: 1,
  name: 'Root Unit',
  description: null,
  parentId: null,
  managerUserId: null,
  isActive: true,
  createdAt: '2025-01-01',
  updatedAt: '2025-01-01',
  children: [],
  ...overrides,
});

const defaultNewUnit = { name: '', parentId: '', managerUserId: '' };

const defaultProps = {
  units: [],
  tree: [],
  busy: false,
  canAdmin: true,
  newUnit: defaultNewUnit,
  onNewUnitChange: jest.fn(),
  onCreateUnit: jest.fn(),
  onDeleteUnit: jest.fn(),
  onViewMembers: jest.fn(),
};

describe('<OrgTree />', () => {
  afterEach(() => jest.clearAllMocks());

  it('renders the empty state when tree is empty', () => {
    render(<OrgTree {...defaultProps} />);
    expect(screen.getByText(/no org units yet/i)).toBeInTheDocument();
  });

  it('shows the create form when canAdmin is true', () => {
    render(<OrgTree {...defaultProps} />);
    expect(screen.getByRole('button', { name: /create/i })).toBeInTheDocument();
  });

  it('hides the create form when canAdmin is false', () => {
    render(<OrgTree {...defaultProps} canAdmin={false} />);
    expect(screen.queryByRole('button', { name: /create/i })).not.toBeInTheDocument();
  });

  it('renders a row for each tree node', () => {
    const tree = [
      makeNode({ id: 1, name: 'Unit A' }),
      makeNode({ id: 2, name: 'Unit B' }),
    ];
    render(<OrgTree {...defaultProps} tree={tree} />);
    expect(screen.getByText('Unit A')).toBeInTheDocument();
    expect(screen.getByText('Unit B')).toBeInTheDocument();
  });

  it('renders an active badge for active units', () => {
    render(<OrgTree {...defaultProps} tree={[makeNode({ isActive: true })]} />);
    expect(screen.getByText('active')).toBeInTheDocument();
  });

  it('renders an inactive badge for inactive units', () => {
    render(<OrgTree {...defaultProps} tree={[makeNode({ isActive: false })]} />);
    expect(screen.getByText('inactive')).toBeInTheDocument();
  });

  it('shows the manager user id when set', () => {
    render(<OrgTree {...defaultProps} tree={[makeNode({ managerUserId: 42 })]} />);
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('shows a dash when managerUserId is null', () => {
    render(<OrgTree {...defaultProps} tree={[makeNode({ managerUserId: null })]} />);
    expect(screen.getAllByText('-').length).toBeGreaterThan(0);
  });

  it('calls onViewMembers when Members button is clicked', () => {
    const node = makeNode({ id: 7 });
    render(<OrgTree {...defaultProps} tree={[node]} />);
    fireEvent.click(screen.getByRole('button', { name: /members/i }));
    expect(defaultProps.onViewMembers).toHaveBeenCalledWith(7);
  });

  it('calls onDeleteUnit when Delete button is clicked', () => {
    const node = makeNode({ id: 3 });
    render(<OrgTree {...defaultProps} tree={[node]} />);
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    expect(defaultProps.onDeleteUnit).toHaveBeenCalledWith(3);
  });

  it('hides the Delete button when canAdmin is false', () => {
    render(<OrgTree {...defaultProps} canAdmin={false} tree={[makeNode()]} />);
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });

  it('renders child nodes recursively', () => {
    const tree = [
      makeNode({
        id: 1,
        name: 'Parent',
        children: [makeNode({ id: 2, name: 'Child', parentId: 1 })],
      }),
    ];
    render(<OrgTree {...defaultProps} tree={tree} />);
    expect(screen.getByText('Parent')).toBeInTheDocument();
    expect(screen.getByText('Child')).toBeInTheDocument();
  });

  it('calls onNewUnitChange when unit name input changes', () => {
    render(<OrgTree {...defaultProps} />);
    const nameInput = screen.getByPlaceholderText(/unit name/i);
    fireEvent.change(nameInput, { target: { value: 'New Unit' } });
    expect(defaultProps.onNewUnitChange).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'New Unit' })
    );
  });

  it('populates the parent select with available units', () => {
    const units = [makeUnit({ id: 5, name: 'Root' })];
    render(<OrgTree {...defaultProps} units={units} />);
    expect(screen.getByRole('option', { name: 'Root' })).toBeInTheDocument();
  });

  it('calls onCreateUnit when the form is submitted', () => {
    render(<OrgTree {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /create/i }));
    expect(defaultProps.onCreateUnit).toHaveBeenCalledTimes(1);
  });
});
