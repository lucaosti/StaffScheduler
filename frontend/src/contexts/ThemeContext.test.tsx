import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, useTheme } from './ThemeContext';

const Probe: React.FC = () => {
  const { choice, resolved, setChoice, toggle } = useTheme();
  return (
    <div>
      <span data-testid="choice">{choice}</span>
      <span data-testid="resolved">{resolved}</span>
      <button onClick={() => setChoice('dark')}>setDark</button>
      <button onClick={toggle}>toggle</button>
    </div>
  );
};

describe('ThemeContext', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-bs-theme');
  });

  it('throws if useTheme is called outside the provider', () => {
    const Lonely: React.FC = () => {
      useTheme();
      return null;
    };
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Lonely />)).toThrow(/within ThemeProvider/);
    errorSpy.mockRestore();
  });

  it('defaults to system and reflects on data-bs-theme', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    );
    expect(screen.getByTestId('choice')).toHaveTextContent('system');
    // Either light or dark depending on environment; just assert the attribute is set.
    expect(document.documentElement.getAttribute('data-bs-theme')).toMatch(/light|dark/);
  });

  it('setChoice persists to localStorage and updates the data attribute', async () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    );
    await userEvent.click(screen.getByText('setDark'));
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(screen.getByTestId('choice')).toHaveTextContent('dark');
    expect(document.documentElement.getAttribute('data-bs-theme')).toBe('dark');
  });

  it('toggle flips dark <-> light based on the resolved value', async () => {
    localStorage.setItem('theme', 'light');
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    );
    await userEvent.click(screen.getByText('toggle'));
    expect(screen.getByTestId('choice')).toHaveTextContent('dark');
  });
});
