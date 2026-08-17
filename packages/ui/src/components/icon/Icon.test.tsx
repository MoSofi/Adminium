// SPDX-License-Identifier: AGPL-3.0-only
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { Icon } from './Icon.js';

function renderIcon(ui: ReactElement): SVGSVGElement {
  const { container } = render(ui);
  const svg = container.querySelector('svg');
  if (!svg) throw new Error('Icon did not render an <svg>');
  return svg;
}

describe('Icon', () => {
  it('renders the named lucide icon as an svg sized 16 with stroke-width 2 by default', () => {
    const svg = renderIcon(<Icon name="Search" />);
    expect(svg.getAttribute('width')).toBe('16');
    expect(svg.getAttribute('height')).toBe('16');
    expect(svg.getAttribute('stroke-width')).toBe('2');
  });

  it('inherits currentColor', () => {
    const svg = renderIcon(<Icon name="Search" />);
    expect(svg.getAttribute('stroke')).toBe('currentColor');
  });

  it('applies design-system sizes', () => {
    const svg = renderIcon(<Icon name="Bell" size={26} />);
    expect(svg.getAttribute('width')).toBe('26');
    expect(svg.getAttribute('height')).toBe('26');
  });

  it('accepts a custom strokeWidth', () => {
    const svg = renderIcon(<Icon name="Bell" strokeWidth={1.5} />);
    expect(svg.getAttribute('stroke-width')).toBe('1.5');
  });

  it('is decorative by default (aria-hidden, no role)', () => {
    const svg = renderIcon(<Icon name="Search" />);
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.hasAttribute('role')).toBe(false);
  });

  it('becomes a labelled image when aria-label is passed', () => {
    const svg = renderIcon(<Icon name="Search" aria-label="Search" />);
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('Search');
    expect(svg.hasAttribute('aria-hidden')).toBe(false);
  });

  it('adds the RTL mirror utility only when rtlMirror is set', () => {
    const mirrored = renderIcon(<Icon name="ChevronRight" rtlMirror />);
    expect(mirrored.getAttribute('class')).toContain('rtl:-scale-x-100');

    const plain = renderIcon(<Icon name="ChevronRight" />);
    expect(plain.getAttribute('class') ?? '').not.toContain('rtl:-scale-x-100');
  });

  it('merges a consumer className after the mirror class', () => {
    const svg = renderIcon(<Icon name="ChevronRight" rtlMirror className="text-accent" />);
    const className = svg.getAttribute('class') ?? '';
    expect(className).toContain('rtl:-scale-x-100');
    expect(className).toContain('text-accent');
  });
});
