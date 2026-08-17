// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ProgressBar } from './ProgressBar.js';

function fill(bar: HTMLElement): HTMLElement {
  const el = bar.firstElementChild;
  if (!(el instanceof HTMLElement)) throw new Error('fill not rendered');
  return el;
}

describe('ProgressBar', () => {
  it('exposes progressbar semantics with a label', () => {
    render(<ProgressBar value={40} label="Import progress" />);
    const bar = screen.getByRole('progressbar', { name: 'Import progress' });
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    expect(bar.getAttribute('aria-valuenow')).toBe('40');
  });

  it('supports a custom max and maps the fill width to a percentage', () => {
    render(<ProgressBar value={256} max={512} label="x" />);
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuemax')).toBe('512');
    expect(bar.getAttribute('aria-valuenow')).toBe('256');
    expect(fill(bar).style.getPropertyValue('--adm-progress')).toBe('50%');
  });

  it('clamps values outside [0, max]', () => {
    const { rerender } = render(<ProgressBar value={-20} label="x" />);
    let bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('0');
    expect(fill(bar).style.getPropertyValue('--adm-progress')).toBe('0%');

    rerender(<ProgressBar value={140} label="x" />);
    bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('100');
    expect(fill(bar).style.getPropertyValue('--adm-progress')).toBe('100%');
  });

  it('renders a surface-3 pill track with the default accent fill', () => {
    render(<ProgressBar value={50} label="x" />);
    const bar = screen.getByRole('progressbar');
    expect(bar.className).toContain('bg-surface-3');
    expect(bar.className).toContain('rounded-full');
    expect(fill(bar).className).toContain('bg-accent');
  });

  it.each([
    ['neutral', 'bg-fg-subtle'],
    ['pos', 'bg-pos'],
    ['warn', 'bg-warn'],
    ['danger', 'bg-danger'],
    ['info', 'bg-info'],
  ] as const)('applies the %s tone fill', (tone, cls) => {
    render(<ProgressBar value={50} tone={tone} label="x" />);
    const bar = screen.getByRole('progressbar');
    expect(fill(bar).className).toContain(cls);
    expect(bar.getAttribute('data-tone')).toBe(tone);
  });

  it.each([
    ['sm', 'h-1'],
    ['md', 'h-1.5'],
    ['lg', 'h-2.5'],
  ] as const)('applies the %s track height', (size, cls) => {
    render(<ProgressBar value={50} size={size} label="x" />);
    expect(screen.getByRole('progressbar').className).toContain(cls);
  });

  it('animates the fill with nb-grow unless animated is false', () => {
    const { rerender } = render(<ProgressBar value={50} label="x" />);
    expect(fill(screen.getByRole('progressbar')).className).toContain('nb-grow');
    rerender(<ProgressBar value={50} animated={false} label="x" />);
    expect(fill(screen.getByRole('progressbar')).className).not.toContain('nb-grow');
  });
});
