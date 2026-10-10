// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AdminiumMark } from './AdminiumMark.js';

describe('AdminiumMark', () => {
  it('draws the four rows in the caller’s colour and is hidden from assistive technology', () => {
    const { container } = render(<AdminiumMark />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('fill')).toBe('currentColor');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelectorAll('rect')).toHaveLength(4);
  });

  it('is an image with a name when it stands alone', () => {
    render(<AdminiumMark title="Adminium" />);
    expect(screen.getByRole('img', { name: 'Adminium' })).toBeDefined();
  });

  it('takes the caller’s size over its own', () => {
    const { container } = render(<AdminiumMark className="size-3" />);
    const classes = container.querySelector('svg')?.getAttribute('class') ?? '';
    expect(classes).toContain('size-3');
    expect(classes).not.toContain('size-4');
  });
});
