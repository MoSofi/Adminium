import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DeltaPill } from './DeltaPill.js';

function pill(container: HTMLElement): HTMLElement {
  const el = container.querySelector('[data-trend]');
  if (!(el instanceof HTMLElement)) throw new Error('pill not rendered');
  return el;
}

describe('DeltaPill', () => {
  it('maps trend up to the pos tone with a trend icon', () => {
    const { container } = render(<DeltaPill trend="up">+12%</DeltaPill>);
    const el = pill(container);
    expect(el.getAttribute('data-trend')).toBe('up');
    expect(el.getAttribute('data-tone')).toBe('pos');
    expect(el.className).toContain('bg-pos-soft');
    expect(el.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('maps trend down to the danger tone', () => {
    const { container } = render(<DeltaPill trend="down">-3%</DeltaPill>);
    const el = pill(container);
    expect(el.getAttribute('data-tone')).toBe('danger');
    expect(el.className).toContain('bg-danger-soft');
  });

  it('maps flat to the muted tone', () => {
    const { container } = render(<DeltaPill trend="flat">0%</DeltaPill>);
    const el = pill(container);
    expect(el.getAttribute('data-tone')).toBe('muted');
    expect(el.className).toContain('bg-surface-3');
  });

  it('invertGood swaps up/down tones but keeps flat muted', () => {
    const up = render(
      <DeltaPill trend="up" invertGood>
        +5%
      </DeltaPill>,
    );
    expect(pill(up.container).getAttribute('data-tone')).toBe('danger');

    const down = render(
      <DeltaPill trend="down" invertGood>
        -5%
      </DeltaPill>,
    );
    expect(pill(down.container).getAttribute('data-tone')).toBe('pos');

    const flat = render(
      <DeltaPill trend="flat" invertGood>
        0%
      </DeltaPill>,
    );
    expect(pill(flat.container).getAttribute('data-tone')).toBe('muted');
  });

  it('honors an explicit tone override', () => {
    const { container } = render(
      <DeltaPill trend="up" tone="muted">
        +0.1%
      </DeltaPill>,
    );
    expect(pill(container).getAttribute('data-tone')).toBe('muted');
  });

  it('renders the value through MonoText', () => {
    const { container, getByText } = render(<DeltaPill trend="up">+12%</DeltaPill>);
    const value = getByText('+12%');
    expect(value.className).toContain('font-mono');
    expect(value.className).toContain('tabular-nums');
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
