// SPDX-License-Identifier: AGPL-3.0-only
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Modal, ModalBody, ModalFooter, ModalHeader, ModalTrigger } from './Modal.js';

afterEach(cleanup);

function renderModal(props: { onOpenChange?: (open: boolean) => void; defaultOpen?: boolean } = {}) {
  return render(
    <Modal
      size="sm"
      {...(props.defaultOpen === undefined ? {} : { defaultOpen: props.defaultOpen })}
      {...(props.onOpenChange === undefined ? {} : { onOpenChange: props.onOpenChange })}
    >
      <ModalTrigger>Open dialog</ModalTrigger>
      <ModalHeader title="Invite a member" subtitle="Sends an email invite." closeLabel="Close dialog" />
      <ModalBody>Body content</ModalBody>
      <ModalFooter>
        <button type="button">Send invite</button>
      </ModalFooter>
    </Modal>,
  );
}

describe('Modal', () => {
  it('is closed until the trigger is clicked, then opens with the accessible title', async () => {
    const user = userEvent.setup();
    renderModal();
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Open dialog' }));
    const dialog = await screen.findByRole('dialog', { name: 'Invite a member' });
    expect(dialog).toBeDefined();
    expect(screen.getByText('Body content')).toBeDefined();
  });

  it('closes via the header close icon-button', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderModal({ defaultOpen: true, onOpenChange });
    await user.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderModal({ defaultOpen: true, onOpenChange });
    expect(screen.getByRole('dialog')).toBeDefined();
    await user.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('traps initial focus inside the dialog', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole('button', { name: 'Open dialog' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('applies the size max-width and modal chrome', () => {
    renderModal({ defaultOpen: true });
    const dialog = screen.getByRole('dialog');
    for (const cls of ['max-w-[410px]', 'rounded-xl', 'shadow-modal', 'bg-surface']) {
      expect(dialog.classList.contains(cls)).toBe(true);
    }
  });

  it('renders the footer on surface-2', () => {
    renderModal({ defaultOpen: true });
    const footer = screen.getByRole('button', { name: 'Send invite' }).parentElement as HTMLElement;
    expect(footer.classList.contains('bg-surface-2')).toBe(true);
  });

  it('describes the dialog with the subtitle, and hosts block content outside a <p>', () => {
    // `subtitle` is a ReactNode and callers pass block content through it (the
    // delete-preflight consequence list). Radix's default <p> made that invalid
    // HTML: the browser auto-closes the <p>, so the DOM stops matching the React
    // tree. The description must stay wired to aria-describedby either way.
    render(
      <Modal size="sm" defaultOpen>
        <ModalHeader
          title="Delete customer"
          subtitle={
            <div data-testid="subtitle-block">
              <span>Deleting this row also affects 3 rows.</span>
            </div>
          }
          closeLabel="Close dialog"
        />
        <ModalBody>Body content</ModalBody>
      </Modal>,
    );
    const describedBy = screen.getByRole('dialog').getAttribute('aria-describedby') ?? '';
    const description = document.getElementById(describedBy);
    expect(description?.textContent).toBe('Deleting this row also affects 3 rows.');
    expect(screen.getByTestId('subtitle-block').closest('p')).toBeNull();
  });
});
