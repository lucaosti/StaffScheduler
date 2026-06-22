/**
 * Tests for MemberList component.
 *
 * @author Luca Ostinelli
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import MemberList from './MemberList';
import type { OrgUnit, UserOrgUnit } from '../../services/orgService';

const makeUnit = (overrides: Partial<OrgUnit> = {}): OrgUnit => ({
  id: 1,
  name: 'Cardiology',
  parentId: null,
  managerUserId: null,
  isActive: true,
  createdAt: '2025-01-01',
  updatedAt: '2025-01-01',
  ...overrides,
});

const makeMember = (overrides: Partial<UserOrgUnit> = {}): UserOrgUnit => ({
  id: 1,
  userId: 10,
  orgUnitId: 1,
  isPrimary: false,
  assignedAt: '2025-01-01',
  ...overrides,
});

const defaultProps = {
  units: [makeUnit()],
  selectedUnitId: null,
  members: [],
  busy: false,
  canManage: true,
  memberForm: { userId: '', isPrimary: false },
  onUnitSelect: jest.fn(),
  onMemberFormChange: jest.fn(),
  onAddMember: jest.fn(),
  onSetPrimary: jest.fn(),
  onRemoveMember: jest.fn(),
};

describe('<MemberList />', () => {
  afterEach(() => jest.clearAllMocks());

  it('renders a unit selector', () => {
    render(<MemberList {...defaultProps} />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('renders options for each unit', () => {
    const units = [makeUnit({ id: 1, name: 'Alpha' }), makeUnit({ id: 2, name: 'Beta' })];
    render(<MemberList {...defaultProps} units={units} />);
    expect(screen.getByRole('option', { name: 'Alpha' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Beta' })).toBeInTheDocument();
  });

  it('calls onUnitSelect when a unit is selected', () => {
    render(<MemberList {...defaultProps} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '1' } });
    expect(defaultProps.onUnitSelect).toHaveBeenCalledWith(1);
  });

  it('calls onUnitSelect with null when empty option is selected', () => {
    render(<MemberList {...defaultProps} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } });
    expect(defaultProps.onUnitSelect).toHaveBeenCalledWith(null);
  });

  it('does not show member content when no unit is selected', () => {
    render(<MemberList {...defaultProps} selectedUnitId={null} />);
    expect(screen.queryByText(/no members/i)).not.toBeInTheDocument();
  });

  it('shows the empty state when unit is selected but no members', () => {
    render(<MemberList {...defaultProps} selectedUnitId={1} members={[]} />);
    expect(screen.getByText(/no members/i)).toBeInTheDocument();
  });

  it('shows the add member form when canManage is true and unit is selected', () => {
    render(<MemberList {...defaultProps} selectedUnitId={1} />);
    expect(screen.getByRole('button', { name: /add member/i })).toBeInTheDocument();
  });

  it('hides the add member form when canManage is false', () => {
    render(<MemberList {...defaultProps} selectedUnitId={1} canManage={false} />);
    expect(screen.queryByRole('button', { name: /add member/i })).not.toBeInTheDocument();
  });

  it('renders a row for each member', () => {
    const members = [
      makeMember({ userId: 10 }),
      makeMember({ id: 2, userId: 20 }),
    ];
    render(<MemberList {...defaultProps} selectedUnitId={1} members={members} />);
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('20')).toBeInTheDocument();
  });

  it('shows "primary" badge for primary members', () => {
    const members = [makeMember({ isPrimary: true })];
    render(<MemberList {...defaultProps} selectedUnitId={1} members={members} />);
    expect(screen.getByText('primary')).toBeInTheDocument();
  });

  it('shows Make Primary button for non-primary members when canManage', () => {
    const members = [makeMember({ isPrimary: false })];
    render(<MemberList {...defaultProps} selectedUnitId={1} members={members} />);
    expect(screen.getByRole('button', { name: /make primary/i })).toBeInTheDocument();
  });

  it('hides Make Primary button for primary members', () => {
    const members = [makeMember({ isPrimary: true })];
    render(<MemberList {...defaultProps} selectedUnitId={1} members={members} />);
    expect(screen.queryByRole('button', { name: /make primary/i })).not.toBeInTheDocument();
  });

  it('calls onSetPrimary with userId when Make Primary is clicked', () => {
    const members = [makeMember({ userId: 10, isPrimary: false })];
    render(<MemberList {...defaultProps} selectedUnitId={1} members={members} />);
    fireEvent.click(screen.getByRole('button', { name: /make primary/i }));
    expect(defaultProps.onSetPrimary).toHaveBeenCalledWith(10);
  });

  it('calls onRemoveMember with userId when Remove is clicked', () => {
    const members = [makeMember({ userId: 10 })];
    render(<MemberList {...defaultProps} selectedUnitId={1} members={members} />);
    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    expect(defaultProps.onRemoveMember).toHaveBeenCalledWith(10);
  });

  it('calls onMemberFormChange when Primary checkbox is toggled', () => {
    render(<MemberList {...defaultProps} selectedUnitId={1} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(defaultProps.onMemberFormChange).toHaveBeenCalledWith(
      expect.objectContaining({ isPrimary: true })
    );
  });
});
