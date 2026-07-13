import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './DropdownMenu.js';

function renderMenu(props: { onSelect?: () => void; onCheckedChange?: (checked: boolean) => void } = {}) {
  return render(
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button">Actions</button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>Record</DropdownMenuLabel>
        <DropdownMenuItem {...(props.onSelect ? { onSelect: props.onSelect } : {})}>Edit</DropdownMenuItem>
        <DropdownMenuItem disabled>Export</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked
          {...(props.onCheckedChange ? { onCheckedChange: props.onCheckedChange } : {})}
        >
          Show archived
        </DropdownMenuCheckboxItem>
        <DropdownMenuItem destructive>Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>,
  );
}

describe('DropdownMenu', () => {
  it('opens on trigger click and shows menu semantics', async () => {
    const user = userEvent.setup();
    renderMenu();
    expect(screen.queryByRole('menu')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Actions' }));
    expect(await screen.findByRole('menu')).toBeDefined();
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeDefined();
    expect(screen.getByText('Record')).toBeDefined();
  });

  it('selects an item with Enter via keyboard navigation and closes', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderMenu({ onSelect });
    await user.click(screen.getByRole('button', { name: 'Actions' }));
    await screen.findByRole('menu');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onSelect).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    renderMenu();
    const trigger = screen.getByRole('button', { name: 'Actions' });
    await user.click(trigger);
    await screen.findByRole('menu');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('exposes checkable items with aria-checked and toggles them', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    renderMenu({ onCheckedChange });
    await user.click(screen.getByRole('button', { name: 'Actions' }));
    const checkItem = await screen.findByRole('menuitemcheckbox', { name: 'Show archived' });
    expect(checkItem.getAttribute('aria-checked')).toBe('true');
    await user.click(checkItem);
    expect(onCheckedChange).toHaveBeenCalledWith(false);
  });

  it('marks destructive items and disables disabled ones', async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByRole('button', { name: 'Actions' }));
    await screen.findByRole('menu');
    const destructive = screen.getByRole('menuitem', { name: 'Delete' });
    expect(destructive.hasAttribute('data-destructive')).toBe(true);
    expect(destructive.className).toContain('text-danger');
    expect(screen.getByRole('menuitem', { name: 'Export' }).getAttribute('data-disabled')).not.toBeNull();
  });
});
