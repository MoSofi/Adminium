// SPDX-License-Identifier: AGPL-3.0-only
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BulkActionBar, BulkActionButton } from './BulkActionBar.js';

afterEach(cleanup);

describe('BulkActionBar', () => {
  it('renders toolbar with count, actions and clear', async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    const onDelete = vi.fn();
    render(
      <BulkActionBar
        label="Bulk actions"
        count={3}
        countLabel="selected"
        onClear={onClear}
        clearLabel="Clear selection"
      >
        <BulkActionButton onClick={onDelete} destructive>
          Delete
        </BulkActionButton>
      </BulkActionBar>,
    );

    const bar = screen.getByRole('toolbar', { name: 'Bulk actions' });
    expect(bar.textContent).toContain('3');
    expect(bar.textContent).toContain('selected');

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('floats by default; floating=false removes fixed positioning', () => {
    const { rerender } = render(
      <BulkActionBar count={1} countLabel="selected" onClear={() => {}} clearLabel="Clear" />,
    );
    expect(screen.getByRole('toolbar').classList.contains('fixed')).toBe(true);
    rerender(
      <BulkActionBar floating={false} count={1} countLabel="selected" onClear={() => {}} clearLabel="Clear" />,
    );
    expect(screen.getByRole('toolbar').classList.contains('fixed')).toBe(false);
  });
});
