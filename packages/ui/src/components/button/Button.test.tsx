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
    expect(button.className).toContain('bg-accent');
    expect(button.className).toContain('text-accent-fg');
    expect(button.className).toContain('shadow-glow');
    expect(button.className).toContain('h-[34px]');
  });

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
    expect(screen.getByRole('button', { name: 'x' }).className).toContain(cls);
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
    expect(link.className).toContain('bg-accent-soft');
  });
});
