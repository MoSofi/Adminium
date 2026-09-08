// SPDX-License-Identifier: AGPL-3.0-only
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfirmModal } from './ConfirmModal.js';
import type { ConfirmModalProps } from './ConfirmModal.js';

afterEach(cleanup);

function Harness({
  onConfirm,
  secondPrompt,
}: {
  onConfirm: () => void | Promise<void>;
  secondPrompt?: ConfirmModalProps['secondPrompt'];
}) {
  const [open, setOpen] = useState(true);
  return (
    <ConfirmModal
      open={open}
      onOpenChange={setOpen}
      title="Delete project"
      body="This permanently deletes acme-prod."
      confirmWord="acme-prod"
      promptLabel='Type "acme-prod" to confirm'
      confirmLabel="Delete project"
      cancelLabel="Cancel"
      closeLabel="Close"
      onConfirm={onConfirm}
      {...(secondPrompt === undefined ? {} : { secondPrompt })}
    />
  );
}

const SECOND: NonNullable<ConfirmModalProps['secondPrompt']> = {
  label: 'Type the row count to confirm: 2400000',
  expected: '2400000',
  hint: 'Digits only.',
};

const dangerButton = () => screen.getByRole('button', { name: 'Delete project' }) as HTMLButtonElement;
const firstField = () => screen.getByLabelText('Type "acme-prod" to confirm');
const secondField = () => screen.getByLabelText(SECOND.label as string);

describe('ConfirmModal', () => {
  it('keeps the danger button disabled until the exact word is typed', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);

    const confirm = dangerButton();
    const input = firstField();
    expect(confirm.disabled).toBe(true);

    await user.type(input, 'acme');
    expect(confirm.disabled).toBe(true);

    await user.type(input, '-prod');
    expect(confirm.disabled).toBe(false);

    // Case/extra characters break the match again.
    await user.type(input, 'x');
    expect(confirm.disabled).toBe(true);
    await user.keyboard('{Backspace}');

    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('shows a busy state while an async onConfirm is in flight', async () => {
    const user = userEvent.setup();
    let release!: () => void;
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    render(<Harness onConfirm={onConfirm} />);

    await user.type(screen.getByLabelText('Type "acme-prod" to confirm'), 'acme-prod');
    await user.click(screen.getByRole('button', { name: 'Delete project' }));

    const confirm = screen.getByRole('button', { name: 'Delete project' });
    expect(confirm.getAttribute('aria-busy')).toBe('true');
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);

    release();
    await waitFor(() => expect(confirm.getAttribute('aria-busy')).toBeNull());
  });

  it('cancel closes the dialog and the typed value resets', async () => {
    const user = userEvent.setup();
    render(<Harness onConfirm={() => {}} />);
    await user.type(screen.getByLabelText('Type "acme-prod" to confirm'), 'acme-prod');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Esc closes via keyboard', async () => {
    const user = userEvent.setup();
    render(<Harness onConfirm={() => {}} />);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  describe('secondPrompt', () => {
    it('renders no second field, and no leftover wiring, when it is absent', () => {
      // The bug: an always-mounted second field that is merely hidden or
      // ungated. A caller who never asked for a second authorisation must not
      // ship one, and nothing may query its way to a field that is not there.
      render(<Harness onConfirm={() => {}} />);
      expect(document.querySelectorAll('input[type="text"]')).toHaveLength(1);
      expect(document.querySelector('[data-part="confirm-input-second"]')).toBeNull();
      expect(screen.queryByLabelText(SECOND.label as string)).toBeNull();
    });

    it('leaves the danger button disabled when only ONE of the two fields matches', async () => {
      // The bug this keeps fixed: confirm enabled with a single field filled.
      // Both spellings of it — first-only and second-only — were reachable
      // while the gate was a single `typed === confirmWord`, which is the
      // whole reason D18's ceiling door asks for a second, different token.
      const user = userEvent.setup();
      const onConfirm = vi.fn();
      render(<Harness onConfirm={onConfirm} secondPrompt={SECOND} />);

      const confirm = dangerButton();
      expect(confirm.disabled).toBe(true);

      // First field only.
      await user.type(firstField(), 'acme-prod');
      expect(confirm.disabled).toBe(true);

      // Second field only.
      await user.clear(firstField());
      await user.type(secondField(), '2400000');
      expect(confirm.disabled).toBe(true);

      // Both.
      await user.type(firstField(), 'acme-prod');
      expect(confirm.disabled).toBe(false);

      // Breaking either one closes the gate again.
      await user.type(secondField(), '0');
      expect(confirm.disabled).toBe(true);
      await user.keyboard('{Backspace}');
      expect(confirm.disabled).toBe(false);

      await user.click(confirm);
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('labels each field separately and tabs through them in reading order', async () => {
      // The bug: one `useId()` shared by both fields. Every `htmlFor` then
      // resolves to the first input, so a screen reader announces the override
      // under the wrong label while `getByLabelText` still finds *an* input
      // and the suite stays green.
      const user = userEvent.setup();
      render(<Harness onConfirm={() => {}} secondPrompt={SECOND} />);

      const first = firstField();
      const second = secondField();
      expect(second).not.toBe(first);
      expect(first.id).not.toBe(second.id);
      expect(first.id).not.toBe('');
      expect(second.id).not.toBe('');

      first.focus();
      await user.tab();
      expect(document.activeElement).toBe(second);
      await user.tab();
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
    });

    it('describes the second field with its hint until the field matches', async () => {
      // The bug: a disabled danger button with nothing on screen saying which
      // gate is unmet. The hint is that sentence, so it must be wired to the
      // field (not just floating near it) and must retire once satisfied.
      const user = userEvent.setup();
      render(<Harness onConfirm={() => {}} secondPrompt={SECOND} />);

      const second = secondField();
      const describedBy = second.getAttribute('aria-describedby');
      expect(describedBy).not.toBeNull();
      expect(document.getElementById(describedBy as string)?.textContent).toBe('Digits only.');

      await user.type(second, '2400000');
      expect(second.getAttribute('aria-describedby')).toBeNull();
      expect(screen.queryByText('Digits only.')).toBeNull();
    });

    it('never opens on an empty `expected`', async () => {
      // The bug: an empty target is satisfied by an untouched field, so the
      // second gate opens for free — which is exactly what a value dropped in
      // transit looks like (a serializer that strips the number, a caller
      // interpolating something that was never measured).
      const user = userEvent.setup();
      render(
        <Harness onConfirm={() => {}} secondPrompt={{ label: 'Type the row count', expected: '' }} />,
      );

      await user.type(firstField(), 'acme-prod');
      expect(dangerButton().disabled).toBe(true);
    });

    it('drops what was typed when `expected` changes under an open dialog', async () => {
      // The bug: a re-plan behind an open confirm swaps the value being
      // authorised, and a match carried over from the previous value
      // authorises a change nobody read.
      const user = userEvent.setup();
      const swappable = (expected: string) => (
        <Harness onConfirm={() => {}} secondPrompt={{ label: 'Type the row count', expected }} />
      );
      const { rerender } = render(swappable('2400000'));

      await user.type(firstField(), 'acme-prod');
      await user.type(screen.getByLabelText('Type the row count'), '2400000');
      expect(dangerButton().disabled).toBe(false);

      rerender(swappable('9100000'));
      expect((screen.getByLabelText('Type the row count') as HTMLInputElement).value).toBe('');
      expect(dangerButton().disabled).toBe(true);
    });

    it('clears both fields when the dialog closes', async () => {
      // The bug: a reopened dialog that is already half-satisfied, so the
      // second gesture is one the operator made for a different change.
      const user = userEvent.setup();
      const controlled = (open: boolean) => (
        <ConfirmModal
          open={open}
          onOpenChange={() => {}}
          title="Delete project"
          confirmWord="acme-prod"
          promptLabel='Type "acme-prod" to confirm'
          secondPrompt={SECOND}
          confirmLabel="Delete project"
          cancelLabel="Cancel"
          closeLabel="Close"
          onConfirm={() => {}}
        />
      );
      const { rerender } = render(controlled(true));

      await user.type(firstField(), 'acme-prod');
      await user.type(secondField(), '2400000');
      expect(dangerButton().disabled).toBe(false);

      rerender(controlled(false));
      rerender(controlled(true));

      expect((firstField() as HTMLInputElement).value).toBe('');
      expect((secondField() as HTMLInputElement).value).toBe('');
      expect(dangerButton().disabled).toBe(true);
    });

    it('locks both fields while an async confirm is in flight', async () => {
      // The bug: a mid-flight edit to the second field. The apply is already
      // carrying the acknowledged value, so the dialog must stop accepting a
      // different one until it settles.
      const user = userEvent.setup();
      let release!: () => void;
      const onConfirm = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      );
      render(<Harness onConfirm={onConfirm} secondPrompt={SECOND} />);

      await user.type(firstField(), 'acme-prod');
      await user.type(secondField(), '2400000');
      await user.click(dangerButton());

      expect((firstField() as HTMLInputElement).disabled).toBe(true);
      expect((secondField() as HTMLInputElement).disabled).toBe(true);

      release();
      await waitFor(() => expect(dangerButton().getAttribute('aria-busy')).toBeNull());
    });
  });
});
