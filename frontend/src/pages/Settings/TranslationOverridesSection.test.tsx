/**
 * The translation-override admin panel: renaming or correcting shipped
 * strings per organization.
 *
 * @author Luca Ostinelli
 */

import { render, screen, waitFor } from '../../test-utils/renderWithClient';
import userEvent from '@testing-library/user-event';
import TranslationOverridesSection from './TranslationOverridesSection';

const mockList = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();

jest.mock('../../services/translationOverrideService', () => ({
  listTranslationOverrides: (...args: unknown[]) => mockList(...args),
  createTranslationOverride: (...args: unknown[]) => mockCreate(...args),
  updateTranslationOverride: (...args: unknown[]) => mockUpdate(...args),
  deleteTranslationOverride: (...args: unknown[]) => mockDelete(...args),
}));

const row = (over: Record<string, unknown> = {}) => ({
  id: 1,
  organizationName: 'Acme',
  locale: 'en',
  overrides: { 'auth.signIn': 'Enter' },
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockList.mockResolvedValue({ success: true, data: [] });
  mockCreate.mockResolvedValue({ success: true, data: row() });
  mockUpdate.mockResolvedValue({ success: true, data: row({ overrides: { a: 'b' } }) });
  mockDelete.mockResolvedValue({ success: true });
});

describe('<TranslationOverridesSection />', () => {
  it('shows an empty state when there are no overrides', async () => {
    render(<TranslationOverridesSection organizationName="Acme" />);
    expect(await screen.findByText(/no translation overrides set yet/i)).toBeInTheDocument();
  });

  it('lists an existing override row', async () => {
    mockList.mockResolvedValue({ success: true, data: [row()] });
    render(<TranslationOverridesSection organizationName="Acme" />);
    expect(await screen.findByText('Acme')).toBeInTheDocument();
    expect(screen.getByText('en')).toBeInTheDocument();
  });

  it('marks a row with no organization as Global', async () => {
    mockList.mockResolvedValue({ success: true, data: [row({ organizationName: null })] });
    render(<TranslationOverridesSection organizationName="Acme" />);
    expect(await screen.findByText('Global')).toBeInTheDocument();
  });

  it('creates an override from the form', async () => {
    render(<TranslationOverridesSection organizationName="Acme" />);
    await userEvent.click(await screen.findByRole('button', { name: /add override/i }));

    await userEvent.type(screen.getByLabelText(/translation key/i), 'auth.signIn');
    await userEvent.type(screen.getByLabelText(/translation value/i), 'Enter');
    await userEvent.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith(
        {
          organizationName: 'Acme',
          locale: 'en',
          overrides: { 'auth.signIn': 'Enter' },
        },
        expect.anything()
      )
    );
  });

  it('edits an existing override, keeping scope and locale fixed', async () => {
    mockList.mockResolvedValue({ success: true, data: [row()] });
    render(<TranslationOverridesSection organizationName="Acme" />);

    await userEvent.click(await screen.findByRole('button', { name: /edit/i }));
    expect(screen.getByLabelText(/applies to/i)).toBeDisabled();
    expect(screen.getByLabelText(/^locale$/i)).toBeDisabled();

    const valueInput = screen.getByLabelText(/translation value/i);
    await userEvent.clear(valueInput);
    await userEvent.type(valueInput, 'Log in');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(1, { overrides: { 'auth.signIn': 'Log in' } })
    );
  });

  it('removes an override after confirmation', async () => {
    mockList.mockResolvedValue({ success: true, data: [row()] });
    window.confirm = jest.fn().mockReturnValue(true);
    render(<TranslationOverridesSection organizationName="Acme" />);

    await userEvent.click(await screen.findByRole('button', { name: /remove/i }));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith(1));
  });
});
