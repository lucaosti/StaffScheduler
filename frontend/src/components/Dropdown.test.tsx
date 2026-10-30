/**
 * Dropdown keyboard and focus behaviour — the parts of a menu Bootstrap's
 * JavaScript used to provide and a click-only replacement loses (#840 review).
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Dropdown from './Dropdown';

const onEdit = jest.fn();

const renderMenu = () =>
  render(
    <>
      <Dropdown toggleClassName="btn" toggleLabel="Actions" toggleContent="⋯">
        <li role="none">
          <button className="dropdown-item" type="button" role="menuitem" onClick={onEdit}>Edit</button>
        </li>
        <li role="none">
          <button className="dropdown-item" type="button" role="menuitem">Delete</button>
        </li>
      </Dropdown>
      <button type="button">Elsewhere</button>
    </>
  );

beforeEach(() => onEdit.mockClear());

describe('<Dropdown />', () => {
  it('exposes a menu of menuitems and moves focus into it on open', async () => {
    renderMenu();
    await userEvent.click(screen.getByRole('button', { name: 'Actions' }));

    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus();
  });

  it('moves between items with the arrow keys, wrapping around', async () => {
    renderMenu();
    await userEvent.click(screen.getByRole('button', { name: 'Actions' }));

    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus();
  });

  it('returns focus to the toggle on Escape', async () => {
    renderMenu();
    await userEvent.click(screen.getByRole('button', { name: 'Actions' }));

    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Actions' })).toHaveFocus();
  });

  it('returns focus to the toggle after a choice', async () => {
    renderMenu();
    await userEvent.click(screen.getByRole('button', { name: 'Actions' }));

    await userEvent.keyboard('{Enter}');

    expect(onEdit).toHaveBeenCalled();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Actions' })).toHaveFocus();
  });

  it('closes when focus tabs out of it', async () => {
    renderMenu();
    await userEvent.click(screen.getByRole('button', { name: 'Actions' }));

    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
