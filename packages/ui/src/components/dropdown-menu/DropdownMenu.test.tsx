// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Modal, ModalBody } from '../modal/index.js';
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

  /**
   * A `Modal` is a Radix dialog, and Radix locks background scroll with
   * `react-remove-scroll`: the lock cancels every `wheel`/`touchmove` that
   * reaches `document` from outside the dialog panel, and this panel is
   * portalled beside it. Nothing in the menu scrolls today — the guard is
   * what keeps a scrollable one from arriving dead to the wheel.
   */
  it('the panel keeps its wheel inside a modal, where a scroll lock is active', async () => {
    const user = userEvent.setup();
    render(
      <Modal open>
        <ModalBody>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button">Actions</button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem>Edit</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </ModalBody>
      </Modal>,
    );
    await user.click(screen.getByRole('button', { name: 'Actions' }));
    const panel = await screen.findByRole('menu');

    const wheel = new WheelEvent('wheel', { deltaY: 60, bubbles: true, cancelable: true });
    panel.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(false);

    // …and the lock is genuinely on: the same event outside the dialog is.
    const outside = document.createElement('div');
    document.body.append(outside);
    const blocked = new WheelEvent('wheel', { deltaY: 60, bubbles: true, cancelable: true });
    outside.dispatchEvent(blocked);
    expect(blocked.defaultPrevented).toBe(true);
    outside.remove();
  });

  it('still hands the panel node to a forwarded ref', async () => {
    const user = userEvent.setup();
    const seen: (HTMLElement | null)[] = [];
    render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button">Actions</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          ref={(node) => {
            seen.push(node);
          }}
        >
          <DropdownMenuItem>Edit</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    await user.click(screen.getByRole('button', { name: 'Actions' }));
    const panel = await screen.findByRole('menu');
    expect(seen).toContain(panel);
  });
});
