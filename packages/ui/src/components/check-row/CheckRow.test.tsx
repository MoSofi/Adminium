// SPDX-License-Identifier: AGPL-3.0-only
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CheckRow } from './CheckRow.js';

afterEach(cleanup);

describe('CheckRow', () => {
  it('is a real checkbox, not a div with a click handler', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<CheckRow label="Email" detail="Send and receive" onCheckedChange={onCheckedChange} />);

    const row = screen.getByRole('checkbox', { name: /Email/ });
    expect(row.getAttribute('aria-checked')).toBe('false');

    // Reachable by keyboard, and Space toggles it — the two things a div with
    // an onClick gets wrong, and the reason this is not one.
    await user.tab();
    expect(document.activeElement).toBe(row);
    await user.keyboard(' ');
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('takes the whole row as its target', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<CheckRow label="Email" detail="Send and receive" onCheckedChange={onCheckedChange} />);
    await user.click(screen.getByText('Send and receive'));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('describes itself with the detail and shows a trailing mono scope', () => {
    render(<CheckRow label="Manage members" detail="Invite and remove" scope="members:write" checked />);
    const row = screen.getByRole('checkbox', { name: /Manage members/ });
    expect(row.getAttribute('aria-checked')).toBe('true');
    const describedBy = row.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(describedBy)?.textContent).toBe('Invite and remove');
    expect(screen.getByText('members:write')).toBeDefined();
  });

  it('wears the selected state as a tint, which is the comp’s own signal', () => {
    const { rerender } = render(<CheckRow label="Email" checked={false} />);
    const row = screen.getByRole('checkbox');
    expect(row.classList.contains('border-border')).toBe(true);
    rerender(<CheckRow label="Email" checked />);
    expect(screen.getByRole('checkbox').classList.contains('border-accent')).toBe(true);
    expect(screen.getByRole('checkbox').classList.contains('bg-accent-soft')).toBe(true);
  });

  it('is not reachable or clickable when disabled', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<CheckRow label="Email" disabled onCheckedChange={onCheckedChange} />);
    const row = screen.getByRole('checkbox');
    expect(row.getAttribute('aria-disabled')).toBe('true');
    expect(row.hasAttribute('tabindex')).toBe(false);
    await user.keyboard(' ');
    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});
