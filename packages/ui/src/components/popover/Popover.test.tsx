// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from './Popover.js';

function renderPopover(props: { onOpenChange?: (open: boolean) => void } = {}) {
  return render(
    <Popover {...props}>
      <PopoverTrigger asChild>
        <button type="button">Open panel</button>
      </PopoverTrigger>
      <PopoverContent aria-label="Rename view">
        <input aria-label="View name" defaultValue="Active" />
        <PopoverClose asChild>
          <button type="button">Done</button>
        </PopoverClose>
      </PopoverContent>
    </Popover>,
  );
}

describe('Popover', () => {
  it('opens on trigger click and renders the panel as a dialog', async () => {
    const user = userEvent.setup();
    renderPopover();
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Open panel' }));
    expect(await screen.findByRole('dialog', { name: 'Rename view' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Open panel' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderPopover({ onOpenChange });
    const trigger = screen.getByRole('button', { name: 'Open panel' });
    await user.click(trigger);
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('closes via a PopoverClose control inside the panel', async () => {
    const user = userEvent.setup();
    renderPopover();
    await user.click(screen.getByRole('button', { name: 'Open panel' }));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('keeps form controls inside the panel usable', async () => {
    const user = userEvent.setup();
    renderPopover();
    await user.click(screen.getByRole('button', { name: 'Open panel' }));
    const input = await screen.findByRole('textbox', { name: 'View name' });
    await user.clear(input);
    await user.type(input, 'Churned');
    expect((input as HTMLInputElement).value).toBe('Churned');
  });
});
