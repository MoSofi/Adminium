// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { IconButton } from './IconButton.js';

describe('IconButton', () => {
  it('renders a type=button named by the required label prop', () => {
    render(
      <IconButton label="Toggle theme">
        <svg />
      </IconButton>,
    );
    const button = screen.getByRole('button', { name: 'Toggle theme' });
    expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('aria-label')).toBe('Toggle theme');
  });

  it('defaults to ghost/md with the nb-ib interaction class', () => {
    render(
      <IconButton label="x">
        <svg />
      </IconButton>,
    );
    const button = screen.getByRole('button', { name: 'x' });
    expect(button.className).toContain('nb-ib');
    expect(button.className).toContain('size-8');
    expect(button.className).not.toContain('border-border-strong');
  });

  it('applies the bordered variant classes', () => {
    render(
      <IconButton label="x" variant="bordered">
        <svg />
      </IconButton>,
    );
    const button = screen.getByRole('button', { name: 'x' });
    expect(button.className).toContain('border-border-strong');
    expect(button.className).toContain('bg-surface');
  });

  it.each([
    ['sm', 'size-7'],
    ['md', 'size-8'],
    ['lg', 'size-[34px]'],
    ['xl', 'size-[38px]'],
  ] as const)('applies the %s square size', (size, cls) => {
    render(
      <IconButton label="x" size={size}>
        <svg />
      </IconButton>,
    );
    expect(screen.getByRole('button', { name: 'x' }).className).toContain(cls);
  });

  it('fires onClick from mouse and keyboard', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <IconButton label="Go" onClick={onClick}>
        <svg />
      </IconButton>,
    );
    const button = screen.getByRole('button', { name: 'Go' });
    await user.click(button);
    button.focus();
    await user.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('keeps the aria-label on the child element with asChild', () => {
    render(
      <IconButton label="Open settings" asChild>
        <a href="/settings">
          <svg />
        </a>
      </IconButton>,
    );
    const link = screen.getByRole('link', { name: 'Open settings' });
    expect(link.className).toContain('nb-ib');
  });
  it('shows the label as a tooltip on focus when opted in', async () => {
    // Icon-only controls gave a sighted mouse user nothing to read: `label`
    // reached assistive tech via aria-label and stopped there.
    render(
      <IconButton label="Duplicate widget" tooltip>
        <svg />
      </IconButton>,
    );
    expect(screen.getByRole('button', { name: 'Duplicate widget' })).toBeDefined();
    expect(screen.queryByText('Duplicate widget')).toBeNull();

    // Radix opens on hover AND on keyboard focus; focus is the path that works
    // headlessly (synthetic hover does not drive its pointer heuristics), and it
    // is also the one that matters for a11y.
    screen.getByRole('button', { name: 'Duplicate widget' }).focus();
    expect((await screen.findAllByText('Duplicate widget')).length).toBeGreaterThan(0);
  });

  it('stays a bare button without the opt-in, and never wraps an asChild trigger', () => {
    const { unmount } = render(
      <IconButton label="Plain">
        <svg />
      </IconButton>,
    );
    expect(screen.getByRole('button', { name: 'Plain' }).parentElement?.tagName).not.toBe('BUTTON');
    unmount();

    // asChild means the element is already somebody else's trigger; a second
    // Radix trigger on it would be fragile, so the tooltip is skipped.
    render(
      <IconButton label="Menu" tooltip asChild>
        <a href="/x">
          <svg />
        </a>
      </IconButton>,
    );
    expect(screen.getByRole('link', { name: 'Menu' })).toBeDefined();
  });
});
