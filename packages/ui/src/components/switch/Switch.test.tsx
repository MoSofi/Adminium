import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Switch } from './Switch.js';

describe('Switch', () => {
  it('renders role=switch and toggles on click', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Switch aria-label="Enable 2FA" onCheckedChange={onCheckedChange} />);
    const control = screen.getByRole('switch', { name: 'Enable 2FA' });
    expect(control.getAttribute('aria-checked')).toBe('false');
    await user.click(control);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
    expect(control.getAttribute('aria-checked')).toBe('true');
    expect(control.getAttribute('data-state')).toBe('checked');
  });

  it('toggles with Space and Enter', async () => {
    const user = userEvent.setup();
    render(<Switch aria-label="Enable 2FA" />);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('switch'));
    await user.keyboard(' ');
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
    await user.keyboard('{Enter}');
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false');
  });

  it('respects the controlled checked prop', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Switch aria-label="Enable 2FA" checked onCheckedChange={onCheckedChange} />);
    const control = screen.getByRole('switch');
    expect(control.getAttribute('aria-checked')).toBe('true');
    await user.click(control);
    expect(onCheckedChange).toHaveBeenCalledWith(false);
    // still controlled-on: parent did not re-render
    expect(control.getAttribute('aria-checked')).toBe('true');
  });

  it('does not toggle when disabled', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Switch aria-label="Enable 2FA" disabled onCheckedChange={onCheckedChange} />);
    await user.click(screen.getByRole('switch')).catch(() => undefined);
    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});
