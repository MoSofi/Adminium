// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { HTTP_METHODS, METHOD_TONE, MethodBadge } from './MethodBadge.js';

describe('MethodBadge', () => {
  it('renders each of the six methods in its own tone, on the opaque tint', () => {
    for (const method of HTTP_METHODS) {
      const { unmount } = render(<MethodBadge method={method} />);
      const badge = screen.getByText(method);
      expect(badge.getAttribute('data-method')).toBe(method);
      expect(badge.className).toContain(METHOD_TONE[method].text);
      expect(badge.className).toContain(METHOD_TONE[method].solid);
      unmount();
    }
    expect(METHOD_TONE.PUT.text).toBe('text-method-put');
    expect(METHOD_TONE.BATCH.solid).toBe('bg-method-batch-soft-solid');
  });

  it('draws the comp atoms: mono, 600, .04em, line-height normal, never wrapping', () => {
    render(<MethodBadge method="GET" />);
    const cls = screen.getByText('GET').className;
    for (const token of ['font-mono', 'font-semibold', 'tracking-[.04em]', 'leading-[normal]', 'whitespace-nowrap', 'shrink-0']) {
      expect(cls).toContain(token);
    }
    expect(cls).not.toContain('font-bold');
    expect(cls).not.toContain('leading-normal ');
  });

  it('has two sizes and two radii', () => {
    render(
      <>
        <MethodBadge method="GET" />
        <MethodBadge method="POST" size="md" radius={6} />
      </>,
    );
    expect(screen.getByText('GET').className).toContain('text-[9.5px]');
    expect(screen.getByText('GET').className).toContain('px-[5px] py-[2px]');
    expect(screen.getByText('GET').className).toContain('rounded-[5px]');
    expect(screen.getByText('POST').className).toContain('text-[10px]');
    expect(screen.getByText('POST').className).toContain('px-[7px] py-[3px]');
    expect(screen.getByText('POST').className).toContain('rounded-[6px]');
  });
});
