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

  /**
   * These two used to assert that changing the field called `onChange` — i.e.
   * that an employee could edit their own working-time limits. That was the
   * defect: the values are hard constraints the optimizer enforces, and are
   * legally bounded in most jurisdictions, yet the self-service endpoint that
   * saved them is guarded by authentication alone.
   *
   * They are displayed rather than hidden because they explain what someone
   * can be scheduled for; changing them requires `preferences.manage`.
   */
  it.each([/max hours per week/i, /max consecutive days/i])(
    'renders %s as read-only so it cannot be self-edited',
    (label) => {
      const onChange = jest.fn();
      render(
        <ProfileSection
          settings={defaultSettings}
          onChange={onChange}
          onSave={jest.fn().mockResolvedValue(undefined)}
        />
      );

      const field = screen.getByLabelText(label) as HTMLInputElement;
      expect(field).toHaveAttribute('readOnly');

      // A readOnly input still emits change events if something dispatches
      // one, so assert the handler is not wired rather than trusting the
      // attribute alone.
      fireEvent.change(field, { target: { value: '99' } });
      expect(onChange).not.toHaveBeenCalled();
    }
  );

  it('explains who does set the limits', () => {
    render(
      <ProfileSection
        settings={defaultSettings}
        onChange={jest.fn()}
        onSave={jest.fn().mockResolvedValue(undefined)}
      />
    );
    expect(screen.getByRole('note')).toHaveTextContent(/set by your manager/i);
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
