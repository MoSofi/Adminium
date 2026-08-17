// SPDX-License-Identifier: AGPL-3.0-only
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TOAST_DEFAULT_DURATIONS, Toast, ToastStack } from './Toast.js';

afterEach(cleanup);

describe('Toast', () => {
  it('renders title, description and a status role', () => {
    render(
      <Toast
        variant="success"
        title="Record saved"
        description="Invoice #1042 was updated."
        dismissLabel="Dismiss"
      />,
    );
    const toast = screen.getByRole('status');
    expect(toast.dataset['variant']).toBe('success');
    expect(screen.getByText('Record saved')).toBeDefined();
    expect(screen.getByText('Invoice #1042 was updated.')).toBeDefined();
  });

  it('uses role="alert" for errors', () => {
    render(<Toast variant="error" title="Export failed" dismissLabel="Dismiss" />);
    expect(screen.getByRole('alert')).toBeDefined();
  });

  it('calls onDismiss when the close button is pressed', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<Toast title="Saved" dismissLabel="Dismiss notification" onDismiss={onDismiss} />);
    await user.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('hides the close button when onDismiss is not provided', () => {
    render(<Toast title="Saved" dismissLabel="Dismiss" />);
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });

  it('fires the action callback (Undo pattern)', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(
      <Toast
        title="12 records deleted"
        action={{ label: 'Undo', onAction }}
        dismissLabel="Dismiss"
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('renders the timer bar with the per-variant default duration', () => {
    render(<Toast variant="warning" title="Degraded" dismissLabel="Dismiss" />);
    const bar = screen.getByTestId('toast-timer-bar');
    expect(bar.style.getPropertyValue('--adm-duration')).toBe(
      `${TOAST_DEFAULT_DURATIONS.warning}ms`,
    );
  });

  it('hides the timer bar for loading and for duration={null}', () => {
    render(<Toast variant="loading" title="Exporting…" dismissLabel="Dismiss" />);
    expect(screen.queryByTestId('toast-timer-bar')).toBeNull();
    cleanup();
    render(<Toast variant="success" title="Saved" duration={null} dismissLabel="Dismiss" />);
    expect(screen.queryByTestId('toast-timer-bar')).toBeNull();
  });
});

describe('ToastStack', () => {
  it('renders the controlled list and dismisses by id', async () => {
    const user = userEvent.setup();
    const onDismissToast = vi.fn();
    render(
      <ToastStack
        label="Notifications"
        dismissLabel="Dismiss notification"
        onDismissToast={onDismissToast}
        toasts={[
          { id: 'a', variant: 'success', title: 'Saved' },
          { id: 'b', variant: 'info', title: 'Scheduled' },
        ]}
      />,
    );
    expect(screen.getByRole('region', { name: 'Notifications' })).toBeDefined();
    expect(screen.getAllByRole('status')).toHaveLength(2);
    const closeButtons = screen.getAllByRole('button', { name: 'Dismiss notification' });
    await user.click(closeButtons[1] as HTMLElement);
    expect(onDismissToast).toHaveBeenCalledWith('b');
  });

  it('anchors to bottom / inline-end', () => {
    render(
      <ToastStack toasts={[]} onDismissToast={() => {}} dismissLabel="Dismiss" label="Notifications" />,
    );
    const region = screen.getByRole('region', { name: 'Notifications' });
    expect(region.classList.contains('end-4')).toBe(true);
    expect(region.classList.contains('bottom-4')).toBe(true);
  });
});
