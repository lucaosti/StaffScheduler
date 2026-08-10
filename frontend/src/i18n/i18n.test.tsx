/**
 * Tests for the react-i18next setup: locale switching, English fallback,
 * the organization-override merge function, and reactive RTL `dir`.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useTranslation } from 'react-i18next';
import i18n, { isRtl, isSupportedLocale } from './index';
import { applyOrganizationOverrides } from './organizationOverrides';
import DirectionSync from './DirectionSync';

const Probe: React.FC = () => {
  const { t, i18n: instance } = useTranslation();
  return (
    <div>
      <span data-testid="locale">{instance.language}</span>
      <span data-testid="signin">{t('auth.signIn')}</span>
      <span data-testid="missing">{t('this.key.does.not.exist')}</span>
      <button onClick={() => void instance.changeLanguage('it')}>switch-it</button>
      <button onClick={() => void instance.changeLanguage('ar')}>switch-ar</button>
      <button onClick={() => void instance.changeLanguage('es')}>switch-es</button>
      <button onClick={() => void instance.changeLanguage('en')}>switch-en</button>
    </div>
  );
};

describe('isRtl / isSupportedLocale', () => {
  it('flags Arabic as RTL and English/Italian as LTR', () => {
    expect(isRtl('ar')).toBe(true);
    expect(isRtl('en')).toBe(false);
    expect(isRtl('it')).toBe(false);
  });

  it('recognizes only the shipped locales as supported', () => {
    expect(isSupportedLocale('en')).toBe(true);
    expect(isSupportedLocale('it')).toBe(true);
    expect(isSupportedLocale('ar')).toBe(true);
    expect(isSupportedLocale('es')).toBe(true);
    expect(isSupportedLocale('fr')).toBe(false);
  });
});

describe('locale switching + fallback', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders the English string by default', async () => {
    await i18n.changeLanguage('en');
    render(<Probe />);
    expect(screen.getByTestId('signin')).toHaveTextContent('Sign In');
  });

  it('switches locales and updates the rendered text', async () => {
    render(<Probe />);
    await userEvent.click(screen.getByText('switch-it'));
    await waitFor(() => expect(screen.getByTestId('locale')).toHaveTextContent('it'));
    expect(screen.getByTestId('signin')).toHaveTextContent('Accedi');
  });

  it('switches to Spanish and updates the rendered text', async () => {
    render(<Probe />);
    await userEvent.click(screen.getByText('switch-es'));
    await waitFor(() => expect(screen.getByTestId('locale')).toHaveTextContent('es'));
    expect(screen.getByTestId('signin')).toHaveTextContent('Iniciar sesión');
  });

  it('falls back to the key itself when no locale has the key (no Italian override exists)', async () => {
    render(<Probe />);
    expect(screen.getByTestId('missing')).toHaveTextContent('this.key.does.not.exist');
  });
});

describe('applyOrganizationOverrides', () => {
  afterEach(() => {
    // Restore the base English catalog so later tests are not affected.
    i18n.addResourceBundle('en', 'translation', { 'auth.signIn': 'Sign In' }, true, true);
  });

  it('is a no-op when overrides is empty or missing', () => {
    const before = i18n.getResource('en', 'translation', 'auth.signIn');
    applyOrganizationOverrides('en', undefined);
    applyOrganizationOverrides('en', {});
    expect(i18n.getResource('en', 'translation', 'auth.signIn')).toBe(before);
  });

  it('overwrites a base key and is reflected by a mounted useTranslation() consumer', async () => {
    render(<Probe />);
    expect(screen.getByTestId('signin')).toHaveTextContent('Sign In');

    applyOrganizationOverrides('en', { 'auth.signIn': 'Log In (Acme Corp)' });

    await waitFor(() =>
      expect(screen.getByTestId('signin')).toHaveTextContent('Log In (Acme Corp)')
    );
  });
});

describe('DirectionSync', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('sets dir="ltr" for English', async () => {
    await i18n.changeLanguage('en');
    render(<DirectionSync />);
    await waitFor(() => expect(document.documentElement.getAttribute('dir')).toBe('ltr'));
    expect(document.documentElement.getAttribute('lang')).toBe('en');
  });

  it('reactively sets dir="rtl" when the locale changes to Arabic', async () => {
    render(<DirectionSync />);
    await waitFor(() => expect(document.documentElement.getAttribute('dir')).toBe('ltr'));

    await i18n.changeLanguage('ar');

    await waitFor(() => expect(document.documentElement.getAttribute('dir')).toBe('rtl'));
    expect(document.documentElement.getAttribute('lang')).toBe('ar');
  });
});
