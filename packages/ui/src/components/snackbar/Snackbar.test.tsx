// SPDX-License-Identifier: AGPL-3.0-only
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Snackbar } from './Snackbar.js';

afterEach(cleanup);

describe('Snackbar', () => {
  it('announces as a status region with the message', () => {
    render(<Snackbar>Message archived</Snackbar>);
    expect(screen.getByRole('status').textContent).toContain('Message archived');
  });

  it('fires the Undo action', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(<Snackbar action={{ label: 'Undo', onAction }}>Message archived</Snackbar>);
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('floats by default and can be positioned manually', () => {
    const { rerender } = render(<Snackbar>Saved</Snackbar>);
    expect(screen.getByRole('status').classList.contains('fixed')).toBe(true);
    rerender(<Snackbar floating={false}>Saved</Snackbar>);
    expect(screen.getByRole('status').classList.contains('fixed')).toBe(false);
  });
});
