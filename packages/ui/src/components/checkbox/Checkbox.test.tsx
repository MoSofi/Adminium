// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Checkbox } from './Checkbox.js';

describe('Checkbox', () => {
  it('renders an unchecked checkbox and toggles on click', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Checkbox aria-label="Accept" onCheckedChange={onCheckedChange} />);
    const checkbox = screen.getByRole('checkbox', { name: 'Accept' });
    expect(checkbox.getAttribute('aria-checked')).toBe('false');
    await user.click(checkbox);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
    expect(checkbox.getAttribute('aria-checked')).toBe('true');
    expect(checkbox.getAttribute('data-state')).toBe('checked');
  });

  it('toggles with the keyboard (Space)', async () => {
    const user = userEvent.setup();
    render(<Checkbox aria-label="Accept" />);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('checkbox'));
    await user.keyboard(' ');
    expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('true');
  });

  it('supports the indeterminate (mixed) state', () => {
    render(<Checkbox aria-label="Select all" checked="indeterminate" />);
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox.getAttribute('aria-checked')).toBe('mixed');
    expect(checkbox.getAttribute('data-state')).toBe('indeterminate');
  });

  it('does not toggle when disabled', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Checkbox aria-label="Accept" disabled onCheckedChange={onCheckedChange} />);
    await user.click(screen.getByRole('checkbox')).catch(() => undefined);
    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it('merges consumer className last', () => {
    render(<Checkbox aria-label="Accept" className="bg-surface" />);
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox.className).toContain('bg-surface');
    expect(checkbox.className).not.toContain('bg-surface-2');
  });
});
