/**
 * ThemeToggle button.
 *
 * Cycles through light → dark → system. Renders a Bootstrap icon that
 * reflects the resolved theme so the user always has visual feedback,
 * even when the choice is `system`.
 *
 * @author Luca Ostinelli
 */

import React from 'react';
import { useTheme } from '../contexts/ThemeContext';

const NEXT: Record<'light' | 'dark' | 'system', 'light' | 'dark' | 'system'> = {
  light: 'dark',
  dark: 'system',
  system: 'light',
};

const ThemeToggle: React.FC = () => {
  const { choice, resolved, setChoice } = useTheme();
  const icon = resolved === 'dark' ? 'bi-moon-stars-fill' : 'bi-sun-fill';
  const label =
    choice === 'system' ? `System (${resolved})` : choice.charAt(0).toUpperCase() + choice.slice(1);

  return (
    <button
      type="button"
      className="btn btn-outline-secondary btn-sm"
      aria-label={`Theme: ${label}. Click to switch.`}
      title={`Theme: ${label}`}
      onClick={() => setChoice(NEXT[choice])}
    >
      <i className={`bi ${icon}`} aria-hidden="true"></i>
      <span className="visually-hidden">{label}</span>
    </button>
  );
};

export default ThemeToggle;
