// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Tag } from './Tag.js';

describe('Tag', () => {
  it('renders a neutral mini chip by default', () => {
    render(<Tag>PDF</Tag>);
    const tag = screen.getByText('PDF');
    expect(tag.tagName).toBe('SPAN');
    expect(tag.className).toContain('bg-surface-3');
    expect(tag.className).toContain('rounded-sm');
    expect(tag.getAttribute('data-tone')).toBe('neutral');
  });

  it('applies tone classes', () => {
    render(<Tag tone="danger">DELETE</Tag>);
    const tag = screen.getByText('DELETE');
    expect(tag.className).toContain('bg-danger-soft');
    expect(tag.className).toContain('text-danger');
  });

  it('applies the mono variant for type chips', () => {
    render(<Tag mono>varchar</Tag>);
    const tag = screen.getByText('varchar');
    expect(tag.className).toContain('font-mono');
  });

  it('renders no remove button unless removable', () => {
    render(<Tag>plain</Tag>);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('calls onRemove from a labelled ✕ button on click', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(
      <Tag onRemove={onRemove} removeLabel="Remove varchar">
        varchar
      </Tag>,
    );
    await user.click(screen.getByRole('button', { name: 'Remove varchar' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('supports keyboard removal (Tab to focus, Enter and Space activate)', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(
      <Tag onRemove={onRemove} removeLabel="Remove chip">
        chip
      </Tag>,
    );
    await user.tab();
    const button = screen.getByRole('button', { name: 'Remove chip' });
    expect(document.activeElement).toBe(button);
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onRemove).toHaveBeenCalledTimes(2);
  });

  it('supports asChild polymorphism', () => {
    render(
      <Tag asChild tone="info">
        <a href="/schema">FK</a>
      </Tag>,
    );
    const link = screen.getByRole('link', { name: 'FK' });
    expect(link.className).toContain('bg-info-soft');
  });
});
