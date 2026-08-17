// SPDX-License-Identifier: AGPL-3.0-only
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Tooltip } from './Tooltip.js';

afterEach(cleanup);

function renderTooltip(delayDuration = 0) {
  return render(
    <Tooltip content="Copy value" delayDuration={delayDuration}>
      <button type="button">Copy</button>
    </Tooltip>,
  );
}

describe('Tooltip', () => {
  it('is hidden until triggered', () => {
    renderTooltip();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('opens on hover', async () => {
    const user = userEvent.setup();
    renderTooltip();
    await user.hover(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(screen.getByRole('tooltip')).toBeDefined());
  });

  it('opens on keyboard focus and closes on Esc', async () => {
    const user = userEvent.setup();
    renderTooltip();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(screen.getByRole('tooltip')).toBeDefined());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
  });

  it('supports controlled open with onOpenChange', () => {
    const onOpenChange = vi.fn();
    render(
      <Tooltip content="Controlled" open onOpenChange={onOpenChange}>
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    expect(screen.getByRole('tooltip')).toBeDefined();
    expect(screen.getAllByText('Controlled').length).toBeGreaterThan(0);
  });

  it('styles the bubble with the inverted dark surface', async () => {
    const user = userEvent.setup();
    renderTooltip();
    await user.hover(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(screen.getByRole('tooltip')).toBeDefined());
    // Radix duplicates content into the visually-hidden tooltip role element;
    // the styled bubble is its parent Content element.
    const bubble = document.querySelector('[data-radix-popper-content-wrapper] .bg-fg');
    expect(bubble).not.toBeNull();
    expect((bubble as HTMLElement).classList.contains('text-bg')).toBe(true);
    expect((bubble as HTMLElement).classList.contains('rounded-[8px]')).toBe(true);
  });
});
