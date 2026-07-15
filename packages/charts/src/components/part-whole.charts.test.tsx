// @vitest-environment happy-dom
/**
 * Render tests for the part-to-whole & hierarchy chart primitives (04-T09):
 * labelled SVG + export marker, one mark per datum, token-only colors, the
 * categorical RTL mirroring policy, and the reduced-motion path (final state,
 * no fade gate). Storybook stories live in the @adminium/widgets wrappers.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Treemap } from './Treemap.js';
import { Funnel } from './Funnel.js';
import { RadialBar } from './RadialBar.js';
import { Radar } from './Radar.js';
import { Chord } from './Chord.js';
import { Sunburst } from './Sunburst.js';
import { WordCloud } from './WordCloud.js';

function installMatchMedia(reducedMotion: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: reducedMotion && query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    })),
  );
}

beforeEach(() => installMatchMedia(false));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const NO_HEX = /#[0-9a-fA-F]{3,8}\b/;

/** Every fill/stroke on the rendered SVG must be a token or 'none'/'transparent'. */
function assertTokenColors(container: HTMLElement): void {
  const painted = container.querySelectorAll('[fill],[stroke]');
  for (const el of Array.from(painted)) {
    for (const attr of ['fill', 'stroke'] as const) {
      const value = el.getAttribute(attr);
      if (value === null || value === 'none' || value === 'transparent') continue;
      expect(value, `${attr}="${value}"`).not.toMatch(NO_HEX);
    }
  }
}

describe('Treemap', () => {
  const data = [
    { label: 'A', value: 50 },
    { label: 'B', value: 30 },
    { label: 'C', value: 15 },
    { label: 'D', value: 5 },
  ];

  it('renders a labelled export node with one tile per category, token colors', () => {
    const { container } = render(<Treemap data={data} labels={{ label: 'Storage by table' }} />);
    const svg = container.querySelector('svg[role="img"]');
    expect(svg?.getAttribute('aria-label')).toBe('Storage by table');
    expect(svg?.hasAttribute('data-export-node')).toBe(true);
    expect(container.querySelectorAll('[data-tile]')).toHaveLength(4);
    assertTokenColors(container);
  });

  it('gates the fade on mount and skips it under reduced motion', () => {
    const gated = render(<Treemap data={data} labels={{ label: 'x' }} />);
    const gatedTile = gated.container.querySelector('g.adm-chart-fade') as SVGGElement;
    expect(gatedTile.style.getPropertyValue('--adm-fade')).toBe('0');
    gated.unmount();

    installMatchMedia(true); // prefers-reduced-motion → final state immediately
    const reduced = render(<Treemap data={data} labels={{ label: 'x' }} />);
    const reducedTile = reduced.container.querySelector('g.adm-chart-fade') as SVGGElement;
    expect(reducedTile.style.getPropertyValue('--adm-fade')).toBe('1');
  });
});

describe('Funnel', () => {
  const data = [
    { label: 'Visit', value: 1000 },
    { label: 'Signup', value: 400 },
    { label: 'Paid', value: 120 },
  ];

  it('renders one bar per stage plus step-conversion and overall footer', () => {
    const { container } = render(<Funnel data={data} labels={{ label: 'Onboarding funnel' }} />);
    expect(container.querySelector('svg[role="img"]')?.getAttribute('aria-label')).toBe('Onboarding funnel');
    expect(container.querySelectorAll('[data-stage]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-step-conversion]').length).toBe(2); // between stages
    expect(container.querySelector('[data-overall-conversion]')?.textContent).toContain('%');
    assertTokenColors(container);
  });

  it('mirrors bar x in RTL vs LTR', () => {
    const xOf = (dir: 'ltr' | 'rtl') => {
      const { container } = render(<Funnel data={data} labels={{ label: 'x' }} dir={dir} variant="horizontal" />);
      return Number(container.querySelector('[data-stage="Signup"] rect')?.getAttribute('x'));
    };
    expect(xOf('rtl')).toBeGreaterThan(xOf('ltr'));
  });
});

describe('RadialBar', () => {
  const data = [
    { label: 'Desktop', value: 62 },
    { label: 'Mobile', value: 30 },
    { label: 'Tablet', value: 8 },
  ];

  it('renders track + value arcs per ring and a legend, token colors', () => {
    const { container } = render(<RadialBar data={data} labels={{ label: 'Sessions by device' }} />);
    expect(container.querySelectorAll('[data-ring]')).toHaveLength(3);
    expect(container.querySelectorAll('path[data-value]')).toHaveLength(3);
    expect(container.querySelectorAll('.adm-donut-legend-row')).toHaveLength(3);
    assertTokenColors(container);
  });
});

describe('Radar', () => {
  const axes = ['Speed', 'Power', 'Range', 'Cost', 'UX'];
  const series = [
    { label: 'Current', values: [80, 60, 90, 40, 70] },
    { label: 'Target', values: [90, 90, 90, 90, 90] },
  ];

  it('renders a polygon per series with axis labels and grid rings', () => {
    const { container } = render(<Radar axes={axes} series={series} labels={{ label: 'Scorecard' }} />);
    expect(container.querySelectorAll('path[data-series]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-axis-label]')).toHaveLength(5);
    assertTokenColors(container);
  });
});

describe('Chord', () => {
  const nodes = [
    { id: 'a', label: 'Design' },
    { id: 'b', label: 'Eng' },
    { id: 'c', label: 'PM' },
  ];
  const links = [
    { from: 'a', to: 'b', weight: 10 },
    { from: 'a', to: 'c', weight: 5 },
    { from: 'b', to: 'c', weight: 8 },
  ];

  it('renders node arcs + weighted ribbons and a legend', () => {
    const { container } = render(<Chord nodes={nodes} links={links} labels={{ label: 'Collaboration' }} />);
    expect(container.querySelectorAll('path[data-node]')).toHaveLength(3);
    expect(container.querySelectorAll('path[data-ribbon]')).toHaveLength(3);
    expect(container.querySelectorAll('.adm-donut-legend-row')).toHaveLength(3);
    assertTokenColors(container);
  });
});

describe('Sunburst', () => {
  const data = [
    { label: 'Direct', children: [{ label: 'Home', value: 30 }, { label: 'Docs', value: 10 }] },
    { label: 'Search', children: [{ label: 'Brand', value: 25 }, { label: 'Generic', value: 35 }] },
  ];

  it('renders nested parent + child arcs and a parent legend', () => {
    const { container } = render(<Sunburst data={data} labels={{ label: 'Traffic sources' }} />);
    expect(container.querySelectorAll('path[data-depth="0"]')).toHaveLength(2);
    expect(container.querySelectorAll('path[data-depth="1"]')).toHaveLength(4);
    expect(container.querySelectorAll('.adm-donut-legend-row')).toHaveLength(2);
    assertTokenColors(container);
  });
});

describe('WordCloud', () => {
  const data = [
    { term: 'database', weight: 90 },
    { term: 'schema', weight: 50 },
    { term: 'query', weight: 70 },
  ];

  it('renders one sized text per term with token colors and an export marker', () => {
    const { container } = render(<WordCloud data={data} labels={{ label: 'Top search terms' }} />);
    expect(container.querySelector('svg[role="img"]')?.getAttribute('aria-label')).toBe('Top search terms');
    const terms = container.querySelectorAll('text[data-term]');
    expect(terms).toHaveLength(3);
    expect(Number(terms[0]?.getAttribute('font-size'))).toBeGreaterThan(Number(terms[1]?.getAttribute('font-size')));
    assertTokenColors(container);
  });
});
