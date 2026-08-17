// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PaginationFooter } from './PaginationFooter.js';

describe('PaginationFooter (keyset)', () => {
  it('renders the mono range with total, wired prev/next', async () => {
    const user = userEvent.setup();
    const onPrev = vi.fn();
    const onNext = vi.fn();
    render(
      <PaginationFooter
        rangeStart={26}
        rangeEnd={50}
        total={8402}
        hasPrev
        hasNext
        onPrev={onPrev}
        onNext={onNext}
        pageSize={25}
        onPageSizeChange={() => {}}
      />,
    );
    expect(screen.getByText('26–50 of 8,402')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Previous page' }));
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('omits the total in pure cursor mode and disables edges', () => {
    render(
      <PaginationFooter
        rangeStart={1}
        rangeEnd={25}
        total={null}
        hasPrev={false}
        hasNext={false}
        onPrev={() => {}}
        onNext={() => {}}
        pageSize={25}
        onPageSizeChange={() => {}}
      />,
    );
    expect(screen.getByText('1–25')).toBeDefined();
    expect((screen.getByRole('button', { name: 'Previous page' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Next page' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('page-size select fires onPageSizeChange with a number', async () => {
    const user = userEvent.setup();
    const onPageSizeChange = vi.fn();
    render(
      <PaginationFooter
        rangeStart={1}
        rangeEnd={25}
        hasPrev={false}
        hasNext
        onPrev={() => {}}
        onNext={() => {}}
        pageSize={25}
        onPageSizeChange={onPageSizeChange}
      />,
    );
    await user.selectOptions(screen.getByRole('combobox', { name: 'Rows per page' }), '100');
    expect(onPageSizeChange).toHaveBeenCalledWith(100);
  });

  it('shows the empty label when no rows match', () => {
    render(
      <PaginationFooter
        rangeStart={0}
        rangeEnd={0}
        total={0}
        hasPrev={false}
        hasNext={false}
        onPrev={() => {}}
        onNext={() => {}}
        pageSize={50}
        onPageSizeChange={() => {}}
      />,
    );
    expect(screen.getByText('0 rows')).toBeDefined();
  });
});
