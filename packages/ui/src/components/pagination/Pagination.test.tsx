import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Pagination, paginationRange } from './Pagination.js';

afterEach(cleanup);

const baseProps = {
  label: 'Pagination',
  previousLabel: 'Previous page',
  nextLabel: 'Next page',
  pageLabel: (n: number) => `Page ${n}`,
};

describe('paginationRange', () => {
  it('returns all pages when they fit', () => {
    expect(paginationRange(1, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it('adds gaps on both sides for a middle page', () => {
    expect(paginationRange(10, 20)).toEqual([1, null, 9, 10, 11, null, 20]);
  });

  it('keeps a stable window near the edges', () => {
    expect(paginationRange(1, 20)).toEqual([1, 2, 3, 4, 5, null, 20]);
    expect(paginationRange(20, 20)).toEqual([1, null, 16, 17, 18, 19, 20]);
  });
});

describe('Pagination', () => {
  it('marks the active page and fires onPageChange', async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(<Pagination page={2} pageCount={5} onPageChange={onPageChange} {...baseProps} />);

    const active = screen.getByRole('button', { name: 'Page 2' });
    expect(active.getAttribute('aria-current')).toBe('page');

    await user.click(screen.getByRole('button', { name: 'Page 4' }));
    expect(onPageChange).toHaveBeenCalledWith(4);
  });

  it('chevrons step and disable at the bounds', async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    const { rerender } = render(
      <Pagination page={1} pageCount={3} onPageChange={onPageChange} {...baseProps} />,
    );
    expect((screen.getByRole('button', { name: 'Previous page' }) as HTMLButtonElement).disabled).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onPageChange).toHaveBeenCalledWith(2);

    rerender(<Pagination page={3} pageCount={3} onPageChange={onPageChange} {...baseProps} />);
    expect((screen.getByRole('button', { name: 'Next page' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders ellipses for long ranges', () => {
    render(<Pagination page={10} pageCount={20} onPageChange={() => {}} {...baseProps} />);
    expect(screen.getAllByText('…')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Page 1' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Page 20' })).toBeDefined();
  });
});
