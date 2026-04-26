import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider, useI18n } from './I18nContext';
import { translate } from './messages';

const Probe: React.FC = () => {
  const { locale, setLocale, t } = useI18n();
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <span data-testid="signin">{t('auth.signIn')}</span>
      <span data-testid="missing">{t('this.key.does.not.exist', 'fallback-text')}</span>
      <button onClick={() => setLocale('it')}>switch</button>
    </div>
  );
};

describe('translate', () => {
  it('returns the locale message when present', () => {
    expect(translate('it', 'common.save')).toBe('Salva');
  });

  it('falls back to English when the locale lacks the key', () => {
    expect(translate('it', 'common.dashboard')).toBe('Dashboard');
  });

  it('returns the explicit fallback when neither has the key', () => {
    expect(translate('en', 'never.exists', 'oh')).toBe('oh');
  });

  it('returns the key itself when no fallback was provided', () => {
    expect(translate('en', 'never.exists')).toBe('never.exists');
  });
});

describe('I18nProvider + useI18n', () => {
  beforeEach(() => localStorage.clear());

  it('throws if useI18n is called outside the provider', () => {
    const Lonely: React.FC = () => {
      useI18n();
      return null;
    };
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Lonely />)).toThrow(/within I18nProvider/);
    spy.mockRestore();
  });

  it('switches locales and updates the rendered text', async () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>
    );
    expect(screen.getByTestId('signin')).toHaveTextContent(/Sign in|Accedi/);
    await userEvent.click(screen.getByText('switch'));
    expect(screen.getByTestId('locale')).toHaveTextContent('it');
    expect(screen.getByTestId('signin')).toHaveTextContent('Accedi');
    expect(localStorage.getItem('locale')).toBe('it');
  });

  it('renders the explicit fallback for unknown keys', () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>
    );
    expect(screen.getByTestId('missing')).toHaveTextContent('fallback-text');
  });
});
