// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * Render tests for the "bars & ranking" chart primitives (04-T09): each mounts
 * on deterministic demo data without crashing, emits the expected SVG structure
 * (bars/segments/paths), mirrors under dir="rtl", and honors reduced motion
 * (final-state entrance, no gated opacity). Stories live in @adminium/widgets.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  demoBullet,
  demoMarimekko,
  demoPareto,
  demoRanking,
  demoSlope,
  demoStacked100,
  demoWaterfall,
} from '../demo/barsRanking.js';
import { BulletChart } from './BulletChart.js';
import { RankingBars } from './RankingBars.js';
import { ParetoChart } from './ParetoChart.js';
import { WaterfallChart } from './WaterfallChart.js';
import { MarimekkoChart } from './MarimekkoChart.js';
import { StackedBar100 } from './StackedBar100.js';
import { SlopeChart } from './SlopeChart.js';

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

describe('RankingBars', () => {
  it('renders one bar per item with the leader at full accent', () => {
    const { container } = render(<RankingBars data={demoRanking(7)} labels={{ label: 'Top regions' }} />);
    expect(container.querySelectorAll('g[data-rank]')).toHaveLength(6);
    const leader = container.querySelector('rect[data-leader]');
    expect(leader?.getAttribute('fill')).toBe('var(--accent)');
    expect(container.querySelector('svg[role="img"]')?.getAttribute('aria-label')).toBe('Top regions');
  });

  it('ellipsizes a label too long for the gutter and keeps the full text in <title>', () => {
    // SVG text does not wrap or ellipsize: before truncation, article titles
    // bound as the dimension column drew straight through the 104px gutter and
    // under the bars.
    const long = 'Ea dolor sint incididunt ipsum dolor sit amet consectetur';
    const { container } = render(
      <RankingBars data={[{ label: long, value: 10 }]} labels={{ label: 'Articles' }} />,
    );
    const text = container.querySelector('text.adm-chart-entity-label');
    // The drawn glyphs are the trailing text node; `textContent` would also
    // fold in the <title> child that carries the full string.
    const drawn = text?.lastChild?.textContent ?? '';
    expect(drawn).toContain('…');
    expect(drawn.length).toBeLessThan(long.length);
    expect(text?.querySelector('title')?.textContent).toBe(long);
  });

  it('leaves a label that already fits alone, with no <title> noise', () => {
    const { container } = render(
      <RankingBars data={[{ label: 'Canada', value: 10 }]} labels={{ label: 'Regions' }} />,
    );
    const text = container.querySelector('text.adm-chart-entity-label');
    expect(text?.textContent).toBe('Canada');
    expect(text?.querySelector('title')).toBeNull();
  });

  it('clips the label gutter so an underestimated width can never reach the bars', () => {
    const { container } = render(<RankingBars data={demoRanking(2)} labels={{ label: 'x' }} />);
    expect(container.querySelector('clipPath')).not.toBeNull();
    const text = container.querySelector('text.adm-chart-entity-label');
    expect(text?.getAttribute('clip-path')).toMatch(/^url\(#.+\)$/);
  });
});

describe('BulletChart', () => {
  it('renders bands + measure + target per row', () => {
    const { container } = render(<BulletChart data={demoBullet(3)} labels={{ label: 'Goals' }} />);
    expect(container.querySelectorAll('g[data-bullet-row]')).toHaveLength(4);
    expect(container.querySelectorAll('rect[data-band]').length).toBeGreaterThan(0);
    expect(container.querySelector('rect[data-measure]')?.getAttribute('fill')).toBe('var(--fg)');
    expect(container.querySelector('rect[data-target]')?.getAttribute('fill')).toBe('var(--danger)');
  });
});

describe('ParetoChart', () => {
  const data = demoPareto(5);

  it('renders bars, a cumulative line path and the cutline', () => {
    const { container } = render(<ParetoChart data={data} labels={{ label: 'Issues by cause' }} />);
    expect(container.querySelectorAll('rect[data-bar]').length).toBe(data.length);
    expect(container.querySelector('path[data-cumulative]')?.getAttribute('d')).toMatch(/^M/);
    expect(container.querySelector('line[data-cutline]')).not.toBeNull();
  });

  it('mirrors in RTL (different cumulative path)', () => {
    const path = (dir: 'ltr' | 'rtl') =>
      render(<ParetoChart data={data} labels={{ label: 'x' }} dir={dir} />).container.querySelector(
        'path[data-cumulative]',
      )?.getAttribute('d');
    expect(path('rtl')).not.toBe(path('ltr'));
  });
});

describe('WaterfallChart', () => {
  it('renders typed step bars + connectors', () => {
    const { container } = render(<WaterfallChart data={demoWaterfall(2)} labels={{ label: 'MRR bridge' }} />);
    expect(container.querySelectorAll('g[data-step]')).toHaveLength(6);
    expect(container.querySelector('g[data-type="up"] rect')?.getAttribute('fill')).toBe('var(--pos)');
    expect(container.querySelector('g[data-type="down"] rect')?.getAttribute('fill')).toBe('var(--danger)');
    expect(container.querySelectorAll('line[data-connector]')).toHaveLength(5);
  });
});

describe('MarimekkoChart', () => {
  it('renders variable-width columns of stacked segments', () => {
    const demo = demoMarimekko(4);
    const { container } = render(
      <MarimekkoChart rowKeys={demo.rowKeys} colKeys={demo.colKeys} cells={demo.cells} labels={{ label: 'Revenue by region' }} />,
    );
    expect(container.querySelectorAll('g[data-col]')).toHaveLength(demo.colKeys.length);
    expect(container.querySelectorAll('g[data-seg] rect').length).toBe(demo.colKeys.length * demo.rowKeys.length);
  });
});

describe('StackedBar100', () => {
  it('renders segments + a legend row per item', () => {
    const data = demoStacked100(6);
    const { container } = render(<StackedBar100 data={data} labels={{ label: 'Traffic by source' }} legendColumns={2} />);
    expect(container.querySelectorAll('g[data-seg] rect').length).toBe(data.length);
    expect(container.querySelectorAll('.adm-legend-row')).toHaveLength(data.length);
  });
});

describe('SlopeChart', () => {
  it('renders one slope line per record, colored by direction', () => {
    const { container } = render(
      <SlopeChart data={demoSlope(3)} labels={{ label: 'Plan mix shift' }} periodLabels={['Q1', 'Q2']} />,
    );
    expect(container.querySelectorAll('g[data-slope]')).toHaveLength(4);
    expect(container.querySelector('g[data-slope] path')?.getAttribute('d')).toMatch(/^M/);
  });
});

describe('reduced motion', () => {
  it('renders entrance groups at final state (opacity 1) when reduced motion is set', () => {
    installMatchMedia(true);
    const { container } = render(<RankingBars data={demoRanking(1)} labels={{ label: 'x' }} />);
    const fade = container.querySelector('.adm-chart-fade') as SVGGElement | null;
    expect(fade?.style.getPropertyValue('--adm-fade')).toBe('1');
  });
});
