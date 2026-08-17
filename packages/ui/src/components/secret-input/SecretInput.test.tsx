// SPDX-License-Identifier: AGPL-3.0-only
import { act, fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SecretInput } from './SecretInput.js';

const LABELS = {
  revealLabel: 'Reveal value',
  hideLabel: 'Hide value',
  copyLabel: 'Copy value',
  copiedLabel: 'Copied',
};

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SecretInput', () => {
  it('masks the value as a password input in mono', () => {
    const { container } = render(<SecretInput {...LABELS} defaultValue="sk_live_123" />);
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.type).toBe('password');
    expect(input.className).toContain('font-mono');
  });

  it('toggles reveal/hide via the eye button', async () => {
    const user = userEvent.setup();
    const { container } = render(<SecretInput {...LABELS} defaultValue="sk_live_123" />);
    const input = container.querySelector('input') as HTMLInputElement;
    const toggle = screen.getByRole('button', { name: 'Reveal value' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    await user.click(toggle);
    expect(input.type).toBe('text');
    const hide = screen.getByRole('button', { name: 'Hide value' });
    expect(hide.getAttribute('aria-pressed')).toBe('true');
    await user.click(hide);
    expect(input.type).toBe('password');
  });

  it('copies the current value and announces via the live region', async () => {
    vi.useFakeTimers();
    const onCopy = vi.fn();
    render(<SecretInput {...LABELS} defaultValue="sk_live_123" onCopy={onCopy} />);
    // fireEvent (not userEvent): userEvent's internal waits stall under fake timers
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy value' }));
    });
    expect(writeText).toHaveBeenCalledWith('sk_live_123');
    expect(onCopy).toHaveBeenCalledTimes(1);
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('Copied');
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(status.textContent).toBe('');
  });

  it('keeps the copy button labelled by copyLabel during feedback (state via data-copied)', async () => {
    vi.useFakeTimers();
    render(<SecretInput {...LABELS} defaultValue="x" />);
    const copy = screen.getByRole('button', { name: 'Copy value' });
    await act(async () => {
      fireEvent.click(copy);
    });
    expect(copy.hasAttribute('data-copied')).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(copy.hasAttribute('data-copied')).toBe(false);
  });

  it('sets aria-invalid on the input when error', () => {
    const { container } = render(<SecretInput {...LABELS} error defaultValue="x" />);
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect((container.firstElementChild as HTMLElement).hasAttribute('data-invalid')).toBe(true);
  });
});
