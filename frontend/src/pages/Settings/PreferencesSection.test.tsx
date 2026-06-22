/**
 * Tests for PreferencesSection (Settings → Personal tab).
 *
 * @author Luca Ostinelli
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PreferencesSection from './PreferencesSection';

const defaultSettings = {
  theme: 'light' as const,
  language: 'en' as const,
  timezone: 'UTC',
  notifications: { email: true, push: false, sms: false },
};

describe('<PreferencesSection />', () => {
  it('renders all form fields', () => {
    render(
      <PreferencesSection
        settings={defaultSettings}
        onChange={jest.fn()}
        onSave={jest.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.getByLabelText(/^theme$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^language$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^timezone$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email notifications/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/push notifications/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/sms notifications/i)).toBeInTheDocument();
  });

  it('calls onChange when theme is changed', async () => {
    const onChange = jest.fn();
    render(
      <PreferencesSection
        settings={defaultSettings}
        onChange={onChange}
        onSave={jest.fn().mockResolvedValue(undefined)}
      />
    );

    await userEvent.selectOptions(screen.getByLabelText(/^theme$/i), 'dark');
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ theme: 'dark' })
    );
  });

  it('calls onChange when language is changed', async () => {
    const onChange = jest.fn();
    render(
      <PreferencesSection
        settings={defaultSettings}
        onChange={onChange}
        onSave={jest.fn().mockResolvedValue(undefined)}
      />
    );

    await userEvent.selectOptions(screen.getByLabelText(/^language$/i), 'it');
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'it' })
    );
  });

  it('calls onChange when timezone is changed', async () => {
    const onChange = jest.fn();
    render(
      <PreferencesSection
        settings={defaultSettings}
        onChange={onChange}
        onSave={jest.fn().mockResolvedValue(undefined)}
      />
    );

    await userEvent.selectOptions(screen.getByLabelText(/^timezone$/i), 'Europe/Rome');
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ timezone: 'Europe/Rome' })
    );
  });

  it('calls onChange when email notification is toggled', async () => {
    const onChange = jest.fn();
    render(
      <PreferencesSection
        settings={defaultSettings}
        onChange={onChange}
        onSave={jest.fn().mockResolvedValue(undefined)}
      />
    );

    await userEvent.click(screen.getByLabelText(/email notifications/i));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        notifications: expect.objectContaining({ email: false }),
      })
    );
  });

  it('calls onChange when push notification is toggled', async () => {
    const onChange = jest.fn();
    render(
      <PreferencesSection
        settings={defaultSettings}
        onChange={onChange}
        onSave={jest.fn().mockResolvedValue(undefined)}
      />
    );

    await userEvent.click(screen.getByLabelText(/push notifications/i));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        notifications: expect.objectContaining({ push: true }),
      })
    );
  });

  it('calls onChange when SMS notification is toggled', async () => {
    const onChange = jest.fn();
    render(
      <PreferencesSection
        settings={defaultSettings}
        onChange={onChange}
        onSave={jest.fn().mockResolvedValue(undefined)}
      />
    );

    await userEvent.click(screen.getByLabelText(/sms notifications/i));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        notifications: expect.objectContaining({ sms: true }),
      })
    );
  });

  it('calls onSave and shows success message on successful submit', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    render(
      <PreferencesSection
        settings={defaultSettings}
        onChange={jest.fn()}
        onSave={onSave}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /save personal settings/i }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/personal preferences saved successfully/i)).toBeInTheDocument();
  });

  it('shows an error message when onSave rejects', async () => {
    const onSave = jest.fn().mockRejectedValue(new Error('Server error'));
    render(
      <PreferencesSection
        settings={defaultSettings}
        onChange={jest.fn()}
        onSave={onSave}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /save personal settings/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(await screen.findByText(/server error/i)).toBeInTheDocument();
  });
});
