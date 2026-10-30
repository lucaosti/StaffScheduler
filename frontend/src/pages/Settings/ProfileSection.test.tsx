/**
 * Tests for ProfileSection (Settings → Work Preferences tab).
 *
 * The tab used to offer an editable minimum-rest field and three preferred
 * shift checkboxes behind a "Save Work Settings" button that did nothing and
 * then reported "Work preferences saved successfully" (#843): neither value
 * has anywhere to be stored. What remains is what the server holds — the
 * working-time limits, read-only.
 *
 * @author Luca Ostinelli
 */

import { render, screen, fireEvent } from '../../test-utils/renderWithClient';
import ProfileSection from './ProfileSection';
import * as preferencesService from '../../services/preferencesService';

jest.mock('../../services/preferencesService', () => ({
  __esModule: true,
  getMyPreferences: jest.fn(),
}));

const getMyPreferences = preferencesService.getMyPreferences as jest.Mock;

beforeEach(() => {
  getMyPreferences.mockResolvedValue({
    success: true,
    data: { userId: 1, maxHoursPerWeek: 36, minHoursPerWeek: 0, maxConsecutiveDays: 4, preferredShifts: [], avoidShifts: [], notes: null, updatedAt: 'x' },
  });
});

describe('<ProfileSection />', () => {
  it('shows the limits the server holds for the caller', async () => {
    render(<ProfileSection />);

    expect(await screen.findByLabelText(/max hours per week/i)).toHaveValue(36);
    expect(screen.getByLabelText(/max consecutive days/i)).toHaveValue(4);
  });

  /**
   * The limits are hard constraints the optimizer enforces, and legally
   * bounded in most jurisdictions, yet the self-service endpoint is guarded
   * by authentication alone — so they are displayed (they explain what
   * someone can be scheduled for) but never self-edited; changing them
   * requires `preferences.manage`.
   */
  it.each([/max hours per week/i, /max consecutive days/i])(
    'renders %s as read-only so it cannot be self-edited',
    async (label) => {
      render(<ProfileSection />);
      const field = (await screen.findByLabelText(label)) as HTMLInputElement;
      expect(field).toHaveAttribute('readOnly');
      fireEvent.change(field, { target: { value: '99' } });
      expect(field).not.toHaveValue(99);
    }
  );

  it('explains who does set the limits', async () => {
    render(<ProfileSection />);
    expect(await screen.findByRole('note')).toHaveTextContent(/set by your manager/i);
  });

  it('offers nothing it cannot store, and no save that would claim it did', async () => {
    render(<ProfileSection />);
    await screen.findByLabelText(/max hours per week/i);

    expect(screen.queryByLabelText(/min rest hours/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/day shift/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
  });

  it('says so when the caller has no limits on record', async () => {
    getMyPreferences.mockResolvedValue({ success: true, data: null });
    render(<ProfileSection />);
    expect(await screen.findByText(/no working-time limits are on record/i)).toBeInTheDocument();
  });
});
