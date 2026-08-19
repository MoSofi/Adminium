// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Button } from './Button.js';

describe('Button', () => {
  it('renders a type=button with its children', () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.getAttribute('type')).toBe('button');
  });

  it('defaults to primary/md with accent bg and glow shadow', () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.classList.contains('bg-accent')).toBe(true);
    expect(button.classList.contains('text-accent-fg')).toBe(true);
    expect(button.classList.contains('shadow-glow')).toBe(true);
    expect(button.classList.contains('h-[34px]')).toBe(true);
  });

  /**
   * `classList.contains`, not `className.toContain`: the substring form cannot tell `bg-accent`
   * from `bg-accent-soft` or `bg-accent-soft-solid`, so it passes for a fill this file never
   * meant to accept. Every tinted-chip assertion in the library shared that blind spot and rode
   * straight through the translucent → pre-composited tint change without noticing.
   *
   * The two soft variants below still name the TRANSLUCENT `-soft` wash, and deliberately so —
   * Button keeps its own variant map rather than importing `toneSoftClasses`, so it did not move
   * with the chips. If it is ever pointed at the opaque `-soft-solid` tints (which is what a
   * soft button on a tinted card would need — see tokens.css, THE OPAQUE CHIP TINTS), these two
   * rows fail, which is the intended way to find out.
   */
  it.each([
    ['secondary', 'bg-surface'],
    ['ghost', 'hover:bg-surface-3'],
    ['outline', 'border-border-strong'],
    ['destructive', 'bg-danger'],
    ['destructiveSoft', 'bg-danger-soft'],
    ['soft', 'bg-accent-soft'],
    ['link', 'underline-offset-2'],
    ['inverse', 'bg-fg'],
  ] as const)('applies the %s variant classes', (variant, cls) => {
    render(<Button variant={variant}>x</Button>);
    expect(screen.getByRole('button', { name: 'x' }).classList.contains(cls), cls).toBe(true);
  });

  it.each([
    ['sm', 'h-7'],
    ['md', 'h-[34px]'],
    ['lg', 'h-10'],
  ] as const)('applies the %s size class', (size, cls) => {
    render(<Button size={size}>x</Button>);
    expect(screen.getByRole('button', { name: 'x' }).className).toContain(cls);
  });

  it('fires onClick from mouse and keyboard', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    const button = screen.getByRole('button', { name: 'Go' });
    await user.click(button);
    button.focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(3);
  });

  it('shows a spinner, sets aria-busy and blocks clicks while loading', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { container } = render(
      <Button loading onClick={onClick}>
        Saving
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Saving' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(container.querySelector('.nb-spin')).not.toBeNull();
    await user.click(button).catch(() => undefined);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('replaces iconLeft with the spinner while loading', () => {
    const { container, rerender } = render(<Button iconLeft={<svg data-testid="icon" />}>Add</Button>);
    expect(screen.getByTestId('icon')).not.toBeNull();
    rerender(
      <Button iconLeft={<svg data-testid="icon" />} loading>
        Add
      </Button>,
    );
    expect(screen.queryByTestId('icon')).toBeNull();
    expect(container.querySelector('.nb-spin')).not.toBeNull();
  });

  it('renders iconLeft and iconRight slots', () => {
    render(
      <Button iconLeft={<svg data-testid="left" />} iconRight={<svg data-testid="right" />}>
        Both
      </Button>,
    );
    expect(screen.getByTestId('left')).not.toBeNull();
    expect(screen.getByTestId('right')).not.toBeNull();
  });

  it('does not fire onClick when disabled', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Nope
      </Button>,
    );
    await user.click(screen.getByRole('button', { name: 'Nope' })).catch(() => undefined);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders the child element with button classes when asChild', () => {
    render(
      <Button asChild variant="soft">
        <a href="/docs">Docs</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'Docs' });
    expect(link.getAttribute('href')).toBe('/docs');
    expect(link.classList.contains('bg-accent-soft')).toBe(true);
  });
});
