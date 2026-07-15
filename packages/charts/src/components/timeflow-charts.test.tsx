// @vitest-environment happy-dom
/**
 * Render tests for the M7 "time, forecast & flow" chart primitives (04-T09):
 * SVG structure + token-only colors, the RTL policy per chart (categorical /
 * rank axes mirror; time-axis charts stay LTR islands), and the reduced-motion
 * final-state path. Storybook lives in the @adminium/widgets wrappers.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AnomalyChart } from './AnomalyChart.js';
import { BumpChart } from './BumpChart.js';
import { CandlestickChart } from './CandlestickChart.js';
import { ForecastChart } from './ForecastChart.js';
import { MultiLineChart } from './MultiLineChart.js';
import type { MultiLineSeries } from './MultiLineChart.js';
import { StreamChart } from './StreamChart.js';
import { TimelineLanesChart } from './TimelineLanesChart.js';

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

const day = (n: number) => new Date(Date.UTC(2026, 0, n));

const timeSeries = [
  { key: 'a', label: 'Team A', points: [day(1), day(2), day(3), day(4)].map((x, i) => ({ x, y: [4, 8, 6, 10][i]! })) },
  { key: 'b', label: 'Team B', points: [day(1), day(2), day(3), day(4)].map((x, i) => ({ x, y: [2, 3, 7, 5][i]! })) },
];
const categoricalSeries = [
  { key: 'a', label: 'A', points: ['Mon', 'Tue', 'Wed'].map((x, i) => ({ x, y: [3, 6, 4][i]! })) },
  { key: 'b', label: 'B', points: ['Mon', 'Tue', 'Wed'].map((x, i) => ({ x, y: [5, 2, 8][i]! })) },
];

describe('MultiLineChart', () => {
  it('labels the SVG and draws one path + end dot + end label per series', () => {
    const { container } = render(<MultiLineChart series={timeSeries} labels={{ label: 'Cohort LTV' }} />);
    expect(container.querySelector('svg[role="img"]')?.getAttribute('aria-label')).toBe('Cohort LTV');
    expect(container.querySelectorAll('path[data-series]')).toHaveLength(2);
    expect(container.querySelectorAll('circle[data-series-dot]')).toHaveLength(2);
    expect(container.querySelector('[data-series="a"]')?.getAttribute('stroke')).toBe('var(--viz-1)');
    expect(container.querySelector('[data-series-label="b"]')?.textContent).toBe('Team B');
  });

  it('time x never mirrors; categorical x mirrors in RTL', () => {
    const path = (dir: 'ltr' | 'rtl', series: readonly MultiLineSeries[]) =>
      render(<MultiLineChart series={series} labels={{ label: 'x' }} dir={dir} />).container.querySelector(
        'path[data-series="a"]',
      )?.getAttribute('d');
    expect(path('rtl', timeSeries)).toBe(path('ltr', timeSeries)); // time = LTR island
    expect(path('rtl', categoricalSeries)).not.toBe(path('ltr', categoricalSeries));
  });
});

describe('StreamChart', () => {
  const series = [
    { key: 'a', label: 'Direct', points: categoricalSeries[0]!.points },
    { key: 'b', label: 'Search', points: categoricalSeries[1]!.points },
    { key: 'c', label: 'Social', points: ['Mon', 'Tue', 'Wed'].map((x, i) => ({ x, y: [1, 4, 2][i]! })) },
  ];

  it('renders a filled band + legend item per series', () => {
    const { container } = render(<StreamChart series={series} labels={{ label: 'Traffic composition' }} />);
    expect(container.querySelectorAll('path[data-series]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-legend-item]')).toHaveLength(3);
    expect(container.querySelector('path[data-series="a"]')?.getAttribute('fill')).toBe('var(--viz-1)');
  });

  it('spans band x from the longest series when series lengths differ (no collapse to x=0)', () => {
    // series[0] is short (3 pts); series[1] is long (6 pts). stackStream builds
    // 6-length band arrays, so the x spine must cover all 6 indices — deriving
    // it from series[0] would snap indices 3..5 back to the origin.
    const short = { key: 'short', label: 'Short', points: ['Jan', 'Feb', 'Mar'].map((x, i) => ({ x, y: [3, 4, 5][i]! })) };
    const long = {
      key: 'long',
      label: 'Long',
      points: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'].map((x, i) => ({ x, y: [2, 3, 4, 5, 6, 7][i]! })),
    };
    const { container } = render(<StreamChart series={[short, long]} smooth={false} labels={{ label: 'x' }} />);
    const d = container.querySelector('path[data-series="long"]')?.getAttribute('d') ?? '';
    const forward = [...d.matchAll(/[ML](-?[\d.]+),/g)].map((m) => Number(m[1])).slice(0, long.points.length);
    expect(forward).toHaveLength(long.points.length);
    // Top edge x-coordinates run left→right monotonically; the bug produced x=0
    // for indices past the short series, breaking monotonicity.
    expect([...forward].sort((a, b) => a - b)).toEqual(forward);
    expect(Math.max(...forward)).toBeGreaterThan(0);
  });
});

describe('ForecastChart', () => {
  const history = [day(1), day(2), day(3), day(4)].map((x, i) => ({ x, y: [10, 12, 11, 14][i]! }));
  const forecast = [day(5), day(6), day(7)].map((x, i) => ({ x, y: [15, 16, 17][i]! }));
  const band = [
    { lo: 13, hi: 17 },
    { lo: 13, hi: 19 },
    { lo: 12, hi: 22 },
  ];

  it('draws history, dashed forecast, confidence band, now divider and footer legend', () => {
    const { container } = render(
      <ForecastChart history={history} forecast={forecast} band={band} labels={{ label: 'MRR forecast' }} />,
    );
    expect(container.querySelector('path[data-series="history"]')?.getAttribute('d')).toMatch(/^M/);
    expect(container.querySelector('path[data-series="forecast"]')?.getAttribute('stroke-dasharray')).toBe('5 4');
    expect(container.querySelector('path[data-band="confidence"]')?.getAttribute('fill')).toBe('var(--viz-1)');
    expect(container.querySelector('[data-now-divider]')).not.toBeNull();
    expect(container.querySelector('[data-footer-legend]')).not.toBeNull();
  });

  it('is a time-axis LTR island (identical history path in ltr and rtl)', () => {
    const path = (dir: 'ltr' | 'rtl') =>
      render(
        <ForecastChart history={history} forecast={forecast} band={band} labels={{ label: 'x' }} dir={dir} />,
      ).container.querySelector('path[data-series="history"]')?.getAttribute('d');
    expect(path('rtl')).toBe(path('ltr'));
  });
});

describe('AnomalyChart', () => {
  const points = [10, 10, 11, 10, 40, 10, 9, 10, 11].map((y, i) => ({ x: day(i + 1), y }));

  it('draws actual + expected lines, a band and a halo on the injected spike', () => {
    const { container } = render(<AnomalyChart points={points} labels={{ label: 'Requests/s' }} sensitivity={2} window={3} />);
    expect(container.querySelector('path[data-series="actual"]')).not.toBeNull();
    expect(container.querySelector('path[data-series="expected"]')?.getAttribute('stroke-dasharray')).toBe('4 4');
    expect(container.querySelector('path[data-band="expected"]')).not.toBeNull();
    const anomalies = container.querySelectorAll('[data-anomaly]');
    expect(anomalies.length).toBeGreaterThan(0);
    expect(container.querySelector('[data-anomaly="4"] circle')?.getAttribute('fill')).toBe('var(--danger)');
  });
});

describe('CandlestickChart', () => {
  const candles = [
    { t: '1', o: 10, h: 12, l: 9, c: 11 },
    { t: '2', o: 11, h: 11.5, l: 8, c: 9 },
    { t: '3', o: 9, h: 13, l: 8.5, c: 12.5 },
  ];

  it('colors candles by direction, draws the last-price line and optional live pill', () => {
    const { container } = render(<CandlestickChart candles={candles} labels={{ label: 'ADMN' }} livePill livePillLabel="Live" />);
    expect(container.querySelectorAll('[data-candle]')).toHaveLength(3);
    expect(container.querySelector('[data-candle="0"] rect[data-body]')?.getAttribute('fill')).toBe('var(--pos)');
    expect(container.querySelector('[data-candle="1"] rect[data-body]')?.getAttribute('fill')).toBe('var(--danger)');
    expect(container.querySelector('[data-last-price]')?.getAttribute('stroke-dasharray')).toBe('3 3');
    expect(container.querySelector('[data-live-pill]')).not.toBeNull();
  });

  it('price axis is an LTR island: candle order identical in ltr and rtl', () => {
    const centerX = (dir: 'ltr' | 'rtl') =>
      Number(
        render(<CandlestickChart candles={candles} labels={{ label: 'x' }} dir={dir} />).container
          .querySelector('[data-candle="0"] line')
          ?.getAttribute('x1'),
      );
    expect(centerX('rtl')).toBe(centerX('ltr'));
  });
});

describe('BumpChart', () => {
  const series = [
    { key: 'a', label: 'Organic', ranks: [1, 2, 1, 1] },
    { key: 'b', label: 'Paid', ranks: [2, 1, 3, 2] },
    { key: 'c', label: 'Email', ranks: [3, 3, 2, 3] },
  ];

  it('draws a polyline + hollow dots + end label per entity', () => {
    const { container } = render(<BumpChart series={series} periods={4} maxRank={3} labels={{ label: 'Channel rank' }} />);
    expect(container.querySelectorAll('path[data-series]')).toHaveLength(3);
    expect(container.querySelectorAll('circle[data-series-dot]').length).toBe(12);
    expect(container.querySelector('circle[data-series-dot]')?.getAttribute('fill')).toBe('var(--surface)');
    expect(container.querySelector('[data-series-label="a"]')?.textContent).toBe('Organic');
  });

  it('mirrors the period axis in RTL (rankings mirror)', () => {
    const path = (dir: 'ltr' | 'rtl') =>
      render(<BumpChart series={series} periods={4} maxRank={3} labels={{ label: 'x' }} dir={dir} />).container
        .querySelector('path[data-series="a"]')
        ?.getAttribute('d');
    expect(path('rtl')).not.toBe(path('ltr'));
  });
});

describe('TimelineLanesChart', () => {
  const lanes = ['Deploys', 'Incidents', 'Releases'];
  const events = [
    { lane: 'Deploys', position: 0.1, label: 'v1.2' },
    { lane: 'Deploys', position: 0.8, label: 'v1.3' },
    { lane: 'Incidents', position: 0.5, label: 'SEV2', tone: 'danger' },
    { lane: 'Releases', position: 0.9, label: 'GA' },
  ];

  it('stacks lanes with labels and positioned event pills', () => {
    const { container } = render(
      <TimelineLanesChart lanes={lanes} events={events} labels={{ label: 'Release timeline' }} axisLabels={['W1', 'W2', 'W3']} />,
    );
    expect(container.querySelectorAll('[data-lane]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-lane-label]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-event]')).toHaveLength(4);
    expect(container.querySelector('[data-event="SEV2"] rect')?.getAttribute('stroke')).toBe('var(--danger)');
  });

  it('is an LTR island: lane label anchors at the inline-start in both directions', () => {
    const anchor = (dir: 'ltr' | 'rtl') =>
      render(<TimelineLanesChart lanes={lanes} events={events} labels={{ label: 'x' }} dir={dir} />).container
        .querySelector('[data-lane-label]')
        ?.getAttribute('text-anchor');
    expect(anchor('ltr')).toBe('end');
    expect(anchor('rtl')).toBe('end');
  });
});

describe('reduced motion', () => {
  it('renders every chart at its final fade state immediately (no animation frames)', () => {
    installMatchMedia(true);
    const fade = (el: HTMLElement) =>
      (el.querySelector('.adm-chart-fade') as SVGGElement | null)?.style.getPropertyValue('--adm-fade');
    expect(fade(render(<MultiLineChart series={timeSeries} labels={{ label: 'x' }} />).container)).toBe('1');
    expect(
      fade(
        render(
          <ForecastChart
            history={[day(1), day(2)].map((x, i) => ({ x, y: [1, 2][i]! }))}
            forecast={[{ x: day(3), y: 3 }]}
            band={[{ lo: 2, hi: 4 }]}
            labels={{ label: 'x' }}
          />,
        ).container,
      ),
    ).toBe('1');
    expect(fade(render(<BumpChart series={[{ key: 'a', label: 'A', ranks: [1, 2] }]} periods={2} maxRank={2} labels={{ label: 'x' }} />).container)).toBe('1');
  });
});
