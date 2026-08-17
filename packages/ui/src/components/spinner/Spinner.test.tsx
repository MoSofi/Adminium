// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Spinner } from './Spinner.js';

describe('Spinner', () => {
  it('is decorative (aria-hidden) when no label is given', () => {
    const { container } = render(<Spinner />);
    const spinner = container.firstElementChild;
    expect(spinner?.getAttribute('aria-hidden')).toBe('true');
    expect(spinner?.getAttribute('role')).toBeNull();
  });

  it('announces as role=status with an accessible name when labelled', () => {
    render(<Spinner label="Loading invoices" />);
    const spinner = screen.getByRole('status', { name: 'Loading invoices' });
    expect(spinner).not.toBeNull();
  });

  it('uses the nb-spin rotation animation', () => {
    const { container } = render(<Spinner />);
    const spinner = container.firstElementChild;
    expect(spinner?.className).toContain('nb-spin');
    expect(spinner?.className).toContain('animate-[nb-spin_0.8s_linear_infinite]');
  });

  it.each([
    ['sm', 'size-3.5'],
    ['md', 'size-[18px]'],
    ['lg', 'size-6'],
  ] as const)('applies the %s size class', (size, cls) => {
    const { container } = render(<Spinner size={size} />);
    expect(container.firstElementChild?.className).toContain(cls);
  });

  it('defaults to the sm size', () => {
    const { container } = render(<Spinner />);
    expect(container.firstElementChild?.className).toContain('size-3.5');
  });
});
