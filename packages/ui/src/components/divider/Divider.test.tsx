// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Divider } from './Divider.js';

describe('Divider', () => {
  it('renders a horizontal separator by default', () => {
    render(<Divider />);
    const sep = screen.getByRole('separator');
    expect(sep.getAttribute('aria-orientation')).toBe('horizontal');
    expect(sep.className).toContain('h-px');
    expect(sep.className).toContain('bg-border');
  });

  it('renders a vertical separator', () => {
    render(<Divider orientation="vertical" />);
    const sep = screen.getByRole('separator');
    expect(sep.getAttribute('aria-orientation')).toBe('vertical');
    expect(sep.className).toContain('w-px');
    expect(sep.className).toContain('self-stretch');
  });

  it('renders a centered label between two rules', () => {
    render(<Divider label="or" />);
    const sep = screen.getByRole('separator');
    expect(sep.textContent).toBe('or');
    const lines = sep.querySelectorAll('span[aria-hidden="true"]');
    expect(lines.length).toBe(2);
    expect(lines[0]?.className).toContain('bg-border');
  });

  it('merges the consumer className', () => {
    render(<Divider className="my-4" />);
    expect(screen.getByRole('separator').className).toContain('my-4');
  });
});
