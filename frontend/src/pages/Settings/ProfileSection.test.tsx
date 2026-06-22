/**
 * Tests for ProfileSection (Settings → Work Preferences tab).
 *
 * @author Luca Ostinelli
 */

import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProfileSection from './ProfileSection';

const defaultSettings = {
  maxHoursPerWeek: 40,
  maxConsecutiveDays: 5,
  minRestHours: 11,
  preferredShifts: [],
  availabilitySettings: { unavailableDates: [], preferredDepartments: [] },
};

describe('<ProfileSection />', () => {
  it('renders all form fields', () => {
    render(
      <ProfileSection
        settings={defaultSettings}
        onChange={jest.fn()}
        onSave={jest.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.getByLabelText(/max hours per week/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/max consecutive days/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/min rest hours/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/day shift/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/afternoon shift/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/night shift/i)).toBeInTheDocument();
  });

  it('calls onChange when maxHoursPerWeek is changed', () => {
    const onChange = jest.fn();
    render(
      <ProfileSection
        settings={defaultSettings}
        onChange={onChange}
        onSave={jest.fn().mockResolvedValue(undefined)}
      />
    );

    fireEvent.change(screen.getByLabelText(/max hours per week/i), { target: { value: '45' } });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ maxHoursPerWeek: 45 })
    );
  });

  it('calls onChange when maxConsecutiveDays is changed', () => {
    const onChange = jest.fn();
    render(
      <ProfileSection
        settings={defaultSettings}
        onChange={onChange}
        onSave={jest.fn().mockResolvedValue(undefined)}
      />
    );

    fireEvent.change(screen.getByLabelText(/max consecutive days/i), { target: { value: '6' } });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ maxConsecutiveDays: 6 })
    );
  });

  it('calls onChange when minRestHours is changed', () => {
    const onChange = jest.fn();
    render(
      <ProfileSection
        settings={defaultSettings}
        onChange={onChange}
        onSave={jest.fn().mockResolvedValue(undefined)}
      />
    );

    fireEvent.change(screen.getByLabelText(/min rest hours/i), { target: { value: '12' } });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ minRestHours: 12 })
    );
  });

  it('adds a preferred shift when its checkbox is checked', async () => {
    const onChange = jest.fn();
    render(
      <ProfileSection
        settings={defaultSettings}
        onChange={onChange}
        onSave={jest.fn().mockResolvedValue(undefined)}
      />
    );

    await userEvent.click(screen.getByLabelText(/day shift/i));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ preferredShifts: ['day-shift'] })
    );
  });

  it('removes a preferred shift when its checkbox is unchecked', async () => {
    const onChange = jest.fn();
    render(
      <ProfileSection
        settings={{ ...defaultSettings, preferredShifts: ['day-shift', 'night-shift'] }}
        onChange={onChange}
        onSave={jest.fn().mockResolvedValue(undefined)}
      />
    );

    await userEvent.click(screen.getByLabelText(/day shift/i));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ preferredShifts: ['night-shift'] })
    );
  });

  it('calls onSave and shows success message on successful submit', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    render(
      <ProfileSection
        settings={defaultSettings}
        onChange={jest.fn()}
        onSave={onSave}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /save work settings/i }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/work preferences saved successfully/i)).toBeInTheDocument();
  });

  it('shows an error message when onSave rejects', async () => {
    const onSave = jest.fn().mockRejectedValue(new Error('Save failed'));
    render(
      <ProfileSection
        settings={defaultSettings}
        onChange={jest.fn()}
        onSave={onSave}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /save work settings/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(await screen.findByText(/save failed/i)).toBeInTheDocument();
  });
});
