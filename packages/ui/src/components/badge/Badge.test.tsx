// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Badge } from './Badge.js';
import type { Tone } from './Badge.js';
import { toneSoftClasses } from '../../lib/tones.js';

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

  /**
   * WHOLE class names, via classList — `className.toContain('bg-accent-soft')` is a SUBSTRING
   * match and passes for `bg-accent-soft-solid` too. That is not hypothetical: this file, and
   * every other class assertion on a tinted chip, stayed green through the translucent →
   * pre-composited token swap without registering it. A test that cannot tell the two tints
   * apart is not testing the tint.
   */
  it.each(['accent', 'pos', 'warn', 'danger', 'info'] as const)(
    'paints the shared chip recipe for tone %s',
    (tone) => {
      render(<Badge tone={tone as Tone}>x</Badge>);
      const badge = screen.getByText('x');
      for (const cls of toneSoftClasses[tone].split(' ')) {
        expect(badge.classList.contains(cls), cls).toBe(true);
      }
      expect(badge.getAttribute('data-tone')).toBe(tone);
    },
  );

  /**
   * …and the recipe above is only worth asserting if the recipe itself is pinned, since every
   * component test derives from it and would follow a bad edit silently. A chip's background must
   * be the OPAQUE `-soft-solid` tint: the translucent `-soft` wash has no contrast of its own —
   * it inherits whatever the chip was re-parented onto, which is how a tag on a selected row and
   * a count badge on an active nav item measured 4.41:1 and 4.36:1 against AA's 4.5:1. This is
   * the one assertion in the suite that is allowed to name the tokens literally.
   * (`neutral` is `--surface-3`, already opaque, so it has no solid twin.)
   */
  it('builds every tinted chip on the pre-composited tint, never the translucent wash', () => {
    for (const tone of ['accent', 'pos', 'warn', 'danger', 'info'] as const) {
      expect(toneSoftClasses[tone].split(' ')).toEqual([`bg-${tone}-soft-solid`, `text-${tone}`]);
    }
    expect(toneSoftClasses.neutral).toBe('bg-surface-3 text-fg-muted');
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
    expect(link.classList.contains('bg-accent-soft-solid')).toBe(true);
  });
});
