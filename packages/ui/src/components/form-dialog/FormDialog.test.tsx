// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `FormDialog` — the shell, its behaviour, and the four places its anatomy
 * deliberately differs from `Modal`'s.
 *
 * The anatomy assertions are not style nitpicking. Radius 16, 88vh, the 4px
 * blur and the footnote band are what the comp draws for a working form, and
 * the reason this is a second component rather than a fifth `Modal` size. A
 * test that did not pin them would let the two quietly converge.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  FormDialog,
  FormDialogBody,
  FormDialogFooter,
  FormDialogHeader,
  FormDialogTrigger,
} from './FormDialog.js';

afterEach(cleanup);

function renderDialog(
  props: { onOpenChange?: (open: boolean) => void; defaultOpen?: boolean; width?: number } = {},
) {
  return render(
    <FormDialog
      {...(props.width === undefined ? {} : { width: props.width })}
      {...(props.defaultOpen === undefined ? {} : { defaultOpen: props.defaultOpen })}
      {...(props.onOpenChange === undefined ? {} : { onOpenChange: props.onOpenChange })}
    >
      <FormDialogTrigger>New patient</FormDialogTrigger>
      <FormDialogHeader title="New patient" subtitle="Contact details" closeLabel="Close" />
      <FormDialogBody>
        <label htmlFor="full-name">Full name</label>
        <input id="full-name" />
      </FormDialogBody>
      <FormDialogFooter footnote="Required fields marked *">
        <button type="button">Cancel</button>
        <button type="button">Create patient</button>
      </FormDialogFooter>
    </FormDialog>,
  );
}

describe('FormDialog', () => {
  it('opens from its trigger with the title as its accessible name', async () => {
    const user = userEvent.setup();
    renderDialog();
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'New patient' }));
    expect(await screen.findByRole('dialog', { name: 'New patient' })).toBeDefined();
  });

  it('closes on the close button and on Escape (D30)', async () => {
    const user = userEvent.setup();

    const onClose = vi.fn();
    renderDialog({ defaultOpen: true, onOpenChange: onClose });
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledWith(false);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    cleanup();

    const onEscape = vi.fn();
    renderDialog({ defaultOpen: true, onOpenChange: onEscape });
    await user.keyboard('{Escape}');
    expect(onEscape).toHaveBeenCalledWith(false);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    cleanup();

    /*
     * The comp closes on an OUTSIDE CLICK too (118), and this file does not
     * assert it: Radix owns that path, it needs a real pointer sequence that
     * jsdom does not produce faithfully, and a synthesized event that passes
     * here would prove nothing about a browser. What this component must not do
     * is take it away — it passes no `onInteractOutside` handler, and the
     * browser leg of gate D is where the behaviour is actually seen.
     */
    const dismissable = screen.queryByRole('dialog');
    expect(dismissable).toBeNull();
  });

  it('traps focus inside itself', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole('button', { name: 'New patient' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('wears the comp’s own anatomy, which is NOT Modal’s', () => {
    renderDialog({ defaultOpen: true, width: 440 });
    const dialog = screen.getByRole('dialog');
    // radius 16 (a comp dimension, DP1) — `Modal` is radius 20 (`rounded-xl`).
    expect(dialog.classList.contains('rounded-[16px]')).toBe(true);
    expect(dialog.classList.contains('rounded-xl')).toBe(false);
    // 88vh, not 85.
    expect(dialog.classList.contains('max-h-[88vh]')).toBe(true);
    // The width is the dialog's own, capped so a narrow viewport keeps a
    // gutter. It travels as a custom property the class reads, which is the
    // one shape the tokens-only rule allows for a per-instance value.
    expect(dialog.style.getPropertyValue('--adm-dialog-width')).toBe('min(440px, 94vw)');
    expect(dialog.classList.contains('max-w-[var(--adm-dialog-width)]')).toBe(true);
  });

  it('puts the footnote at the START of the footer band and the actions at the end', () => {
    renderDialog({ defaultOpen: true });
    const footnote = screen.getByText('Required fields marked *');
    const band = footnote.parentElement as HTMLElement;
    expect(band.classList.contains('bg-surface-2')).toBe(true);
    // `ms-auto` on the action group rather than `justify-end` on the band: the
    // actions sit at the END, which is the correct side in RTL with no second
    // rule anywhere.
    const actions = screen.getByRole('button', { name: 'Cancel' }).parentElement as HTMLElement;
    expect(actions.classList.contains('ms-auto')).toBe(true);
    expect(band.firstElementChild).toBe(footnote);
  });

  it('draws no footnote line when there is none to draw', () => {
    render(
      <FormDialog defaultOpen>
        <FormDialogHeader title="Edit patient" closeLabel="Close" />
        <FormDialogBody>body</FormDialogBody>
        <FormDialogFooter>
          <button type="button">Save changes</button>
        </FormDialogFooter>
      </FormDialog>,
    );
    const actions = screen.getByRole('button', { name: 'Save changes' }).parentElement as HTMLElement;
    const band = actions.parentElement as HTMLElement;
    expect(band.childElementCount).toBe(1);
  });

  it('describes itself with the subtitle, and hosts block content outside a <p>', () => {
    render(
      <FormDialog defaultOpen>
        <FormDialogHeader
          title="New booking"
          subtitle={<div data-testid="subtitle-block">Three steps · profile, role, access</div>}
          closeLabel="Close"
        />
        <FormDialogBody>body</FormDialogBody>
      </FormDialog>,
    );
    const describedBy = screen.getByRole('dialog').getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(describedBy)?.textContent).toBe(
      'Three steps · profile, role, access',
    );
    expect(screen.getByTestId('subtitle-block').closest('p')).toBeNull();
  });

  it('hides the close button when a flow forces a choice', () => {
    render(
      <FormDialog defaultOpen>
        <FormDialogHeader title="New booking" closeLabel="Close" hideClose />
        <FormDialogBody>body</FormDialogBody>
      </FormDialog>,
    );
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });
});
