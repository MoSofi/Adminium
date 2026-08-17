// SPDX-License-Identifier: AGPL-3.0-only
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { EmptyState } from './EmptyState.js';

afterEach(cleanup);

describe('EmptyState', () => {
  it('renders headline, guidance and actions', () => {
    render(
      <EmptyState
        title="No invoices yet"
        body="Create your first invoice to get started."
        actions={<button type="button">New invoice</button>}
      />,
    );
    expect(screen.getByRole('heading', { name: 'No invoices yet' })).toBeDefined();
    expect(screen.getByText('Create your first invoice to get started.')).toBeDefined();
    expect(screen.getByRole('button', { name: 'New invoice' })).toBeDefined();
  });

  it('stamps the preset and defaults to no-data', () => {
    const { container, rerender } = render(<EmptyState title="Empty" />);
    expect((container.firstElementChild as HTMLElement).dataset['preset']).toBe('no-data');
    rerender(<EmptyState preset="all-caught-up" title="All caught up" />);
    expect((container.firstElementChild as HTMLElement).dataset['preset']).toBe('all-caught-up');
  });

  it('all-caught-up preset uses the pos tone tile', () => {
    const { container } = render(<EmptyState preset="all-caught-up" title="Done" />);
    expect(container.querySelector('[data-tone="pos"]')).not.toBeNull();
  });
});
