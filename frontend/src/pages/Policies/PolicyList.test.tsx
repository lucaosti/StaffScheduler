/**
 * Tests for PolicyList component.
 *
 * @author Luca Ostinelli
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import PolicyList from './PolicyList';
import type { Policy, PolicyScope } from '../../services/policyService';

const makePolicy = (overrides: Partial<Policy> = {}): Policy => ({
  id: 1,
  scopeType: 'global',
  scopeId: null,
  policyKey: 'min_rest_hours',
  policyValue: { hours: 11 },
  description: 'Minimum rest hours',
  imposedByUserId: 1,
  isActive: true,
  createdAt: '2025-01-01',
  updatedAt: '2025-01-01',
  ...overrides,
});

const defaultForm = {
  scopeType: 'global' as PolicyScope,
  scopeId: '',
  policyKey: '',
  policyValue: '',
  description: '',
};

const defaultProps = {
  policies: [],
  busy: false,
  canManage: true,
  currentUserId: 1,
  isAdmin: true,
  policyForm: defaultForm,
  onFormChange: jest.fn(),
  onCreatePolicy: jest.fn(),
  onToggleActive: jest.fn(),
  onDeletePolicy: jest.fn(),
};

describe('<PolicyList />', () => {
  afterEach(() => jest.clearAllMocks());

  it('renders the empty state when no policies exist', () => {
    render(<PolicyList {...defaultProps} />);
    expect(screen.getAllByText(/no policies/i).length).toBeGreaterThan(0);
  });

  it('shows the create form when canManage is true', () => {
    render(<PolicyList {...defaultProps} />);
    expect(screen.getByRole('button', { name: /^add$/i })).toBeInTheDocument();
  });

  it('hides the create form when canManage is false', () => {
    render(<PolicyList {...defaultProps} canManage={false} />);
    expect(screen.queryByRole('button', { name: /^add$/i })).not.toBeInTheDocument();
  });

  it('renders a row for each policy', () => {
    const policies = [
      makePolicy({ id: 1, policyKey: 'min_rest_hours' }),
      makePolicy({ id: 2, policyKey: 'max_shifts_per_week' }),
    ];
    render(<PolicyList {...defaultProps} policies={policies} />);
    expect(screen.getByText('min_rest_hours')).toBeInTheDocument();
    expect(screen.getByText('max_shifts_per_week')).toBeInTheDocument();
  });

  it('shows active badge for active policies', () => {
    render(<PolicyList {...defaultProps} policies={[makePolicy({ isActive: true })]} />);
    expect(screen.getByText('active')).toBeInTheDocument();
  });

  it('shows inactive badge for inactive policies', () => {
    render(<PolicyList {...defaultProps} policies={[makePolicy({ isActive: false })]} />);
    expect(screen.getByText('inactive')).toBeInTheDocument();
  });

  it('calls onToggleActive when Deactivate is clicked', () => {
    const policy = makePolicy({ isActive: true });
    render(<PolicyList {...defaultProps} policies={[policy]} />);
    fireEvent.click(screen.getByRole('button', { name: /deactivate/i }));
    expect(defaultProps.onToggleActive).toHaveBeenCalledWith(policy);
  });

  it('calls onToggleActive with Activate for inactive policies', () => {
    const policy = makePolicy({ isActive: false });
    render(<PolicyList {...defaultProps} policies={[policy]} />);
    fireEvent.click(screen.getByRole('button', { name: /activate/i }));
    expect(defaultProps.onToggleActive).toHaveBeenCalledWith(policy);
  });

  it('calls onDeletePolicy when Delete is clicked', () => {
    const policy = makePolicy({ id: 42 });
    render(<PolicyList {...defaultProps} policies={[policy]} />);
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    expect(defaultProps.onDeletePolicy).toHaveBeenCalledWith(42);
  });

  it('hides action buttons when neither owner nor admin', () => {
    const policy = makePolicy({ id: 1, imposedByUserId: 99 });
    render(
      <PolicyList
        {...defaultProps}
        policies={[policy]}
        currentUserId={1}
        isAdmin={false}
      />
    );
    expect(screen.queryByRole('button', { name: /deactivate/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });

  it('shows action buttons when user is the policy owner', () => {
    const policy = makePolicy({ id: 1, imposedByUserId: 5 });
    render(
      <PolicyList
        {...defaultProps}
        policies={[policy]}
        currentUserId={5}
        isAdmin={false}
      />
    );
    expect(screen.getByRole('button', { name: /deactivate/i })).toBeInTheDocument();
  });

  it('calls onFormChange when scope type select changes', () => {
    render(<PolicyList {...defaultProps} />);
    const scopeSelect = screen.getAllByRole('combobox')[0];
    fireEvent.change(scopeSelect, { target: { value: 'org_unit' } });
    expect(defaultProps.onFormChange).toHaveBeenCalledWith(
      expect.objectContaining({ scopeType: 'org_unit' })
    );
  });

  it('renders scopeId in parentheses when set', () => {
    const policy = makePolicy({ scopeType: 'org_unit', scopeId: 3 });
    render(<PolicyList {...defaultProps} policies={[policy]} />);
    expect(screen.getByText('org_unit(3)')).toBeInTheDocument();
  });

  it('calls onCreatePolicy when the form is submitted', () => {
    render(<PolicyList {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));
    expect(defaultProps.onCreatePolicy).toHaveBeenCalledTimes(1);
  });
});
