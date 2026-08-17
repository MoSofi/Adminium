// SPDX-License-Identifier: AGPL-3.0-only
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Skeleton } from './Skeleton.js';

function skeleton(container: HTMLElement): HTMLElement {
  const el = container.firstElementChild;
  if (!(el instanceof HTMLElement)) throw new Error('skeleton not rendered');
  return el;
}

describe('Skeleton', () => {
  it('is hidden from assistive technology', () => {
    const { container } = render(<Skeleton />);
    expect(skeleton(container).getAttribute('aria-hidden')).toBe('true');
  });

  it('uses the tokens nb-skel shimmer class', () => {
    const { container } = render(<Skeleton />);
    expect(skeleton(container).className).toContain('nb-skel');
  });

  it('exposes width/height through the --adm-w/--adm-h custom properties', () => {
    const { container } = render(<Skeleton width={220} height="1.5rem" />);
    const el = skeleton(container);
    expect(el.style.getPropertyValue('--adm-w')).toBe('220px');
    expect(el.style.getPropertyValue('--adm-h')).toBe('1.5rem');
    expect(el.className).toContain('w-[var(--adm-w)]');
    expect(el.className).toContain('h-[var(--adm-h)]');
  });

  it('omits the sizing classes when width/height are not given', () => {
    const { container } = render(<Skeleton />);
    const el = skeleton(container);
    expect(el.className).not.toContain('w-[var(--adm-w)]');
    expect(el.className).not.toContain('h-[var(--adm-h)]');
  });

  it.each([
    ['sm', 'rounded-sm'],
    ['md', 'rounded-md'],
    ['lg', 'rounded-lg'],
    ['full', 'rounded-full'],
  ] as const)('applies the %s radius', (rounded, cls) => {
    const { container } = render(<Skeleton rounded={rounded} />);
    expect(skeleton(container).className).toContain(cls);
  });

  it('defaults to the md radius', () => {
    const { container } = render(<Skeleton />);
    expect(skeleton(container).className).toContain('rounded-md');
  });
});
