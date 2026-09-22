// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { KeyRound, Route } from 'lucide-react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { Sheet, SheetBar, SheetBody, SheetFooter, SheetHeader } from './Sheet.js';

function Stacked() {
  const [outer, setOuter] = useState(false);
  const [inner, setInner] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOuter(true)}>
        Create key
      </button>
      <Sheet open={outer} onOpenChange={setOuter}>
        <SheetHeader icon={<KeyRound />} title="Create API key" subtitle="Pick endpoints" closeLabel="Close" />
        <SheetBar variant="fields">fields</SheetBar>
        <SheetBody>
          <button type="button" onClick={() => setInner(true)}>
            New endpoint
          </button>
        </SheetBody>
        <SheetFooter>footer</SheetFooter>
      </Sheet>
      <Sheet open={inner} onOpenChange={setInner}>
        <SheetHeader icon={<Route />} title="New endpoint" closeLabel="Close builder" />
        <SheetBody>builder</SheetBody>
      </Sheet>
    </>
  );
}

describe('Sheet', () => {
  it('draws the comp panel: max 1180, r18, --bg, line-height normal, the entrance motions', async () => {
    const user = userEvent.setup();
    render(<Stacked />);
    await user.click(screen.getByRole('button', { name: 'Create key' }));
    const dialog = screen.getByRole('dialog', { name: 'Create API key' });
    expect(dialog.style.getPropertyValue('--adm-sheet-max')).toBe('1180px');
    expect(dialog.className).toContain('max-w-[var(--adm-sheet-max)]');
    for (const token of ['rounded-[18px]', 'bg-bg', 'border-border', 'shadow-modal', 'leading-[normal]', 'animate-[nb-sheet_.26s_cubic-bezier(.2,.7,.3,1)]']) {
      expect(dialog.className).toContain(token);
    }
    expect(dialog.getAttribute('aria-describedby')).not.toBeNull();
  });

  it('a sheet opened over another makes the lower one inert, and Escape closes only the top', async () => {
    const user = userEvent.setup();
    render(<Stacked />);
    await user.click(screen.getByRole('button', { name: 'Create key' }));
    const outer = screen.getByRole('dialog', { name: 'Create API key' });
    expect(outer.hasAttribute('inert')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'New endpoint' }));
    await waitFor(() => expect(outer.hasAttribute('inert')).toBe(true));
    expect(screen.getByText('builder')).toBeTruthy();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByText('builder')).toBeNull());
    expect(document.body.contains(outer)).toBe(true);
    await waitFor(() => expect(outer.hasAttribute('inert')).toBe(false));

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('returns focus to the control that opened it', async () => {
    const user = userEvent.setup();
    render(<Stacked />);
    const opener = screen.getByRole('button', { name: 'Create key' });
    await user.click(opener);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('bars take the two comp variants', () => {
    render(
      <>
        <SheetBar variant="fields">a</SheetBar>
        <SheetBar>b</SheetBar>
      </>,
    );
    expect(screen.getByText('a').className).toContain('bg-surface py-4');
    expect(screen.getByText('b').className).toContain('bg-surface-2 py-3');
  });
});
