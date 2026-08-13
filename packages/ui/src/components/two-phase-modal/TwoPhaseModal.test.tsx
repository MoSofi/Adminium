import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ModalBody, ModalFooter, ModalHeader } from '../modal/index.js';
import { MODAL_EXIT_MS, TwoPhaseModal, useModalFlow } from './TwoPhaseModal.js';

afterEach(cleanup);

function InviteHarness() {
  const [open, setOpen] = useState(true);
  const flow = useModalFlow<{ email: string }>();
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Reopen
      </button>
      <TwoPhaseModal
      open={open}
      onOpenChange={setOpen}
      flow={flow}
      successTitle="Invitation sent"
      successBody={(p) => `We emailed ${p.email}.`}
      doneLabel="Done"
    >
      <ModalHeader title="Invite member" closeLabel="Close" />
      <ModalBody>
        <button type="button" onClick={() => flow.toSuccess({ email: 'kim@acme.io' })}>
          Send invite
        </button>
      </ModalBody>
      <ModalFooter />
      </TwoPhaseModal>
    </>
  );
}

describe('TwoPhaseModal', () => {
  it('renders the form phase, then swaps to SuccessState echoing the payload', async () => {
    const user = userEvent.setup();
    render(<InviteHarness />);
    expect(screen.getByText('Invite member')).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Send invite' }));
    expect(screen.queryByText('Invite member')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Invitation sent' })).toBeDefined();
    expect(screen.getByText('We emailed kim@acme.io.')).toBeDefined();
  });

  it('focuses the Done button in the success phase', async () => {
    const user = userEvent.setup();
    render(<InviteHarness />);
    await user.click(screen.getByRole('button', { name: 'Send invite' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Done' }));
  });

  it('Done closes the modal and flow resets to the form phase after the exit animation', async () => {
    const user = userEvent.setup();
    render(<InviteHarness />);
    await user.click(screen.getByRole('button', { name: 'Send invite' }));
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    // flow.reset() is deferred past the exit animation.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, MODAL_EXIT_MS + 30));
    });
    await user.click(screen.getByRole('button', { name: 'Reopen' }));
    expect(screen.getByText('Invite member')).toBeDefined();
    expect(screen.queryByRole('heading', { name: 'Invitation sent' })).toBeNull();
  });

  it('unmounting before the exit animation cancels the deferred reset', () => {
    // Regression: the deferred `flow.reset()` used to survive unmount, firing a
    // setState against a dead component — and, on a slow CI runner, after the
    // test environment had been torn down.
    const reset = vi.fn();
    function UnmountHarness() {
      const flow = useModalFlow<{ email: string }>();
      return (
        <TwoPhaseModal open flow={{ ...flow, reset }} successTitle="Invitation sent" doneLabel="Done">
          <ModalHeader title="Invite member" closeLabel="Close" />
          <ModalBody />
          <ModalFooter />
        </TwoPhaseModal>
      );
    }

    vi.useFakeTimers();
    try {
      const { unmount } = render(<UnmountHarness />);
      // Radix's close button runs onOpenChange(false), scheduling the reset.
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      unmount();
      act(() => {
        vi.advanceTimersByTime(MODAL_EXIT_MS * 4);
      });
      expect(reset).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('Esc closes from the form phase (Radix built-in)', async () => {
    const user = userEvent.setup();
    render(<InviteHarness />);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
