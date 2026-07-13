import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AddFilterChip, FilterChip } from './FilterChip.js';

afterEach(cleanup);

describe('FilterChip', () => {
  it('renders field, op and value', () => {
    render(<FilterChip field="status" op="=" value="paid" />);
    expect(screen.getByText('status')).toBeDefined();
    expect(screen.getByText('=')).toBeDefined();
    expect(screen.getByText('paid')).toBeDefined();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('removes via the labeled X button', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(
      <FilterChip field="status" op="=" value="paid" onRemove={onRemove} removeLabel="Remove status filter" />,
    );
    await user.click(screen.getByRole('button', { name: 'Remove status filter' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});

describe('AddFilterChip', () => {
  it('is a button that fires onClick', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<AddFilterChip label="Add filter" onClick={onClick} />);
    await user.click(screen.getByRole('button', { name: 'Add filter' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
