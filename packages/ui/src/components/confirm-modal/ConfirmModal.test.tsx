import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfirmModal } from './ConfirmModal.js';

afterEach(cleanup);

function Harness({ onConfirm }: { onConfirm: () => void | Promise<void> }) {
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
    />
  );
}

describe('ConfirmModal', () => {
  it('keeps the danger button disabled until the exact word is typed', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);

    const confirm = screen.getByRole('button', { name: 'Delete project' });
    const input = screen.getByLabelText('Type "acme-prod" to confirm');
    expect((confirm as HTMLButtonElement).disabled).toBe(true);

    await user.type(input, 'acme');
    expect((confirm as HTMLButtonElement).disabled).toBe(true);

    await user.type(input, '-prod');
    expect((confirm as HTMLButtonElement).disabled).toBe(false);

    // Case/extra characters break the match again.
    await user.type(input, 'x');
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
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
});
