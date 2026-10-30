/**
 * Dropdown — a Bootstrap-styled menu whose open state React owns.
 *
 * WHY NOT BOOTSTRAP'S OWN JAVASCRIPT. Only Bootstrap's CSS is imported; its
 * JavaScript never was, so every `data-bs-toggle="dropdown"` in the app was a
 * dead control (#840). Loading `bootstrap.bundle` would have revived them,
 * and was rejected: Bootstrap's plugins toggle classes and ARIA attributes on
 * DOM nodes React renders, so the next re-render of the owning component
 * silently resets them (an open menu snaps shut when the bell's 30-second
 * poll lands); it would be a second, imperative UI model next to the
 * React-rendered modals the app already uses; and it adds Popper for menus
 * that never need collision-aware placement. Owning the state here keeps one
 * model, and lets jsdom tests see what a user sees — the menu is mounted only
 * while open, so a test that skips opening it fails the way a user would,
 * where the CSS-hidden menu let every test click items no user could reach.
 *
 * Behaviour matches Bootstrap's: the toggle reports `aria-expanded`; Escape,
 * a press outside, or choosing a `.dropdown-item` closes the menu. The menu
 * carries `data-bs-popper="static"`, the attribute Bootstrap's CSS keys its
 * no-Popper placement on (`top: 100%`, and `right: 0` with
 * `dropdown-menu-end`), so it sits under the toggle in both directions.
 *
 * @author Luca Ostinelli
 */

import React, { useEffect, useRef, useState } from 'react';

interface Props {
  /** Classes for the toggle button. */
  toggleClassName: string;
  /** Accessible name of the toggle (its content is usually an icon). */
  toggleLabel: string;
  /** What the toggle renders. */
  toggleContent: React.ReactNode;
  /** Align the menu with the toggle's end edge (`dropdown-menu-end`). */
  alignEnd?: boolean;
  menuStyle?: React.CSSProperties;
  /** The menu's `<li>` items. */
  children: React.ReactNode;
}

const Dropdown: React.FC<Props> = ({
  toggleClassName,
  toggleLabel,
  toggleContent,
  alignEnd = false,
  menuStyle,
  children,
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // A choice closes the menu; anything else inside it (a "Mark all read"
  // header link, plain text) leaves it open, as Bootstrap's autoClose does.
  const onMenuClick = (event: React.MouseEvent<HTMLUListElement>) => {
    if ((event.target as HTMLElement).closest('.dropdown-item')) setOpen(false);
  };

  return (
    <div className="dropdown" ref={rootRef}>
      <button
        className={toggleClassName}
        type="button"
        aria-label={toggleLabel}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((value) => !value)}
      >
        {toggleContent}
      </button>
      {open && (
        <ul
          className={`dropdown-menu show${alignEnd ? ' dropdown-menu-end' : ''}`}
          data-bs-popper="static"
          style={menuStyle}
          onClick={onMenuClick}
        >
          {children}
        </ul>
      )}
    </div>
  );
};

export default Dropdown;
