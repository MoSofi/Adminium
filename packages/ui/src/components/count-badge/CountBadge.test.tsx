// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CountBadge } from './CountBadge.js';

describe('CountBadge', () => {
  it('renders a neutral mono pill by default', () => {
    render(<CountBadge>12</CountBadge>);
    const el = screen.getByText('12');
    expect(el.tagName).toBe('SPAN');
    expect(el.className).toContain('font-mono');
    expect(el.className).toContain('tabular-nums');
    expect(el.className).toContain('bg-surface-3');
    expect(el.className).toContain('text-fg-muted');
    expect(el.hasAttribute('data-active')).toBe(false);
  });

  it('switches to solid accent when active', () => {
    render(<CountBadge active>7</CountBadge>);
    const el = screen.getByText('7');
    expect(el.className).toContain('bg-accent');
    expect(el.className).toContain('text-accent-fg');
    expect(el.className).not.toContain('bg-surface-3');
    expect(el.hasAttribute('data-active')).toBe(true);
  });

  it('merges the consumer className', () => {
    render(<CountBadge className="ms-2">9</CountBadge>);
    expect(screen.getByText('9').className).toContain('ms-2');
  });
});
