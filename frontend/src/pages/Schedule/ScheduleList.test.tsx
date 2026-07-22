/**
 * Tests for ScheduleList component.
 *
 * @author Luca Ostinelli
 */

import { render, screen, fireEvent } from '@testing-library/react';
import ScheduleList from './ScheduleList';
import type { Schedule } from '../../types';

const makeSchedule = (overrides: Partial<Schedule> = {}): Schedule => ({
  id: 1,
  name: 'Test Schedule',
  status: 'draft',
  startDate: '2025-01-01',
  endDate: '2025-01-31',
  departmentId: 1,
  departmentName: 'Cardiology',
  createdAt: '2025-01-01',
  updatedAt: '2025-01-01',
  ...overrides,
});

describe('<ScheduleList />', () => {
  const defaultProps = {
    schedules: [],
    onGenerate: jest.fn(),
    onPublish: jest.fn(),
    onArchive: jest.fn(),
    onCreateNew: jest.fn(),
  };

  afterEach(() => jest.clearAllMocks());

  it('renders the empty state when schedules array is empty', () => {
    render(<ScheduleList {...defaultProps} />);
    expect(screen.getByText(/no schedules yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new schedule/i })).toBeInTheDocument();
  });

  it('calls onCreateNew when the empty state button is clicked', () => {
    render(<ScheduleList {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /new schedule/i }));
    expect(defaultProps.onCreateNew).toHaveBeenCalledTimes(1);
  });

  it('renders a card for each schedule', () => {
    const schedules = [makeSchedule({ id: 1, name: 'S1' }), makeSchedule({ id: 2, name: 'S2' })];
    render(<ScheduleList {...defaultProps} schedules={schedules} />);
    expect(screen.getByText('S1')).toBeInTheDocument();
    expect(screen.getByText('S2')).toBeInTheDocument();
  });

  it('shows the department badge when departmentName is set', () => {
    render(<ScheduleList {...defaultProps} schedules={[makeSchedule()]} />);
    expect(screen.getByText('Cardiology')).toBeInTheDocument();
  });

  it('renders a "draft" badge for draft schedules', () => {
    render(<ScheduleList {...defaultProps} schedules={[makeSchedule({ status: 'draft' })]} />);
    expect(screen.getByText('draft')).toBeInTheDocument();
  });

  it('renders a "published" badge for published schedules', () => {
    render(<ScheduleList {...defaultProps} schedules={[makeSchedule({ status: 'published' })]} />);
    expect(screen.getByText('published')).toBeInTheDocument();
  });

  it('calls onGenerate when the Generate button is clicked', () => {
    const schedule = makeSchedule();
    render(<ScheduleList {...defaultProps} schedules={[schedule]} />);
    fireEvent.click(screen.getByRole('button', { name: /generate/i }));
    expect(defaultProps.onGenerate).toHaveBeenCalledWith(schedule);
  });

  it('shows the Publish button only for draft schedules', () => {
    render(<ScheduleList {...defaultProps} schedules={[makeSchedule({ status: 'draft' })]} />);
    expect(screen.getByRole('button', { name: /publish/i })).toBeInTheDocument();
  });

  it('hides the Publish button for published schedules', () => {
    render(<ScheduleList {...defaultProps} schedules={[makeSchedule({ status: 'published' })]} />);
    expect(screen.queryByRole('button', { name: /publish/i })).not.toBeInTheDocument();
  });

  it('calls onPublish with the schedule id when Publish is clicked', () => {
    const schedule = makeSchedule({ id: 42, status: 'draft' });
    render(<ScheduleList {...defaultProps} schedules={[schedule]} />);
    fireEvent.click(screen.getByRole('button', { name: /publish/i }));
    expect(defaultProps.onPublish).toHaveBeenCalledWith(42);
  });

  it('shows the Archive button for non-archived schedules', () => {
    render(<ScheduleList {...defaultProps} schedules={[makeSchedule({ status: 'draft' })]} />);
    expect(screen.getByRole('button', { name: /archive/i })).toBeInTheDocument();
  });

  it('hides the Archive button for already-archived schedules', () => {
    render(<ScheduleList {...defaultProps} schedules={[makeSchedule({ status: 'archived' })]} />);
    expect(screen.queryByRole('button', { name: /archive/i })).not.toBeInTheDocument();
  });

  it('calls onArchive with the schedule id when Archive is clicked', () => {
    const schedule = makeSchedule({ id: 7, status: 'draft' });
    render(<ScheduleList {...defaultProps} schedules={[schedule]} />);
    fireEvent.click(screen.getByRole('button', { name: /archive/i }));
    expect(defaultProps.onArchive).toHaveBeenCalledWith(7);
  });

  it('does not render departmentName badge when not set', () => {
    const schedule = makeSchedule({ departmentName: undefined });
    render(<ScheduleList {...defaultProps} schedules={[schedule]} />);
    expect(screen.queryByText('Cardiology')).not.toBeInTheDocument();
  });
});
