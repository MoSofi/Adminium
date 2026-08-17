// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Badge } from './Badge.js';
import type { Tone } from './Badge.js';

describe('Badge', () => {
  it('renders its children in a span', () => {
    render(<Badge>Paid</Badge>);
    const badge = screen.getByText('Paid');
    expect(badge.tagName).toBe('SPAN');
  });

  it('defaults to the neutral tone', () => {
    render(<Badge>Draft</Badge>);
    const badge = screen.getByText('Draft');
    expect(badge.className).toContain('bg-surface-3');
    expect(badge.className).toContain('text-fg-muted');
    expect(badge.getAttribute('data-tone')).toBe('neutral');
  });

  it.each([
    ['accent', 'bg-accent-soft', 'text-accent'],
    ['pos', 'bg-pos-soft', 'text-pos'],
    ['warn', 'bg-warn-soft', 'text-warn'],
    ['danger', 'bg-danger-soft', 'text-danger'],
    ['info', 'bg-info-soft', 'text-info'],
  ] as const)('applies soft-bg + strong-fg classes for tone %s', (tone, bg, fg) => {
    render(<Badge tone={tone as Tone}>x</Badge>);
    const badge = screen.getByText('x');
    expect(badge.className).toContain(bg);
    expect(badge.className).toContain(fg);
    expect(badge.getAttribute('data-tone')).toBe(tone);
  });

  it('renders a decorative dot when requested', () => {
    const { container } = render(
      <Badge tone="pos" dot>
        Active
      </Badge>,
    );
    const dot = container.querySelector('span[aria-hidden="true"]');
    expect(dot).not.toBeNull();
    expect(dot?.className).toContain('rounded-full');
    expect(dot?.className).toContain('bg-current');
  });

  it('renders no dot by default', () => {
    const { container } = render(<Badge>Active</Badge>);
    expect(container.querySelector('span[aria-hidden="true"]')).toBeNull();
  });

  it('merges the consumer className last', () => {
    render(<Badge className="text-fg">y</Badge>);
    const badge = screen.getByText('y');
    expect(badge.className).toContain('text-fg');
    expect(badge.className).not.toContain('text-fg-muted');
  });

  it('supports asChild polymorphism', () => {
    render(
      <Badge asChild tone="accent">
        <a href="/releases">v2.4</a>
      </Badge>,
    );
    const link = screen.getByRole('link', { name: 'v2.4' });
    expect(link.className).toContain('bg-accent-soft');
  });
});
