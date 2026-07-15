// @vitest-environment happy-dom
/**
 * Render tests for the distribution & correlation chart primitives (04-T09):
 * SVG structure, a11y contract (role=img + aria-label), token-only fills,
 * categorical/value-axis RTL mirroring, and the reduced-motion fade gate.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BoxPlotChart } from './BoxPlotChart.js';
import { ViolinChart } from './ViolinChart.js';
import { RidgelineChart } from './RidgelineChart.js';
import { ScatterBubbleChart } from './ScatterBubbleChart.js';
import { HexbinChart } from './HexbinChart.js';
import { CorrelationMatrixChart } from './CorrelationMatrixChart.js';
import { ParallelCoordinatesChart } from './ParallelCoordinatesChart.js';

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

const boxGroups = [
  { label: 'US', min: 10, q1: 40, med: 60, q3: 90, max: 140 },
  { label: 'EU', min: 20, q1: 55, med: 75, q3: 110, max: 160 },
];

describe('BoxPlotChart', () => {
  it('renders a labelled box + median per group', () => {
    const { container, getByRole } = render(
      <BoxPlotChart groups={boxGroups} labels={{ label: 'Latency by region' }} />,
    );
    expect(getByRole('img').getAttribute('aria-label')).toBe('Latency by region');
    expect(container.querySelectorAll('[data-box]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-box-rect]')).toHaveLength(2);
    expect(container.querySelector('[data-median]')?.getAttribute('stroke')).toBe('var(--viz-1)');
  });

  it('gates the entrance fade on mount and skips it under reduced motion', () => {
    const gated = render(<BoxPlotChart groups={boxGroups} labels={{ label: 'x' }} />);
    expect((gated.container.querySelector('.adm-chart-fade') as SVGGElement).style.getPropertyValue('--adm-fade')).toBe('0');
    gated.unmount();
    installMatchMedia(true);
    const reduced = render(<BoxPlotChart groups={boxGroups} labels={{ label: 'x' }} />);
    expect((reduced.container.querySelector('.adm-chart-fade') as SVGGElement).style.getPropertyValue('--adm-fade')).toBe('1');
  });
});

describe('ViolinChart', () => {
  const groups = [
    { label: 'A', min: 0, max: 100, med: 50, density: [1, 4, 2, 1] },
    { label: 'B', min: 0, max: 100, med: 40, density: [2, 3, 5, 1] },
  ];

  it('renders one closed violin path + median per group', () => {
    const { container } = render(<ViolinChart groups={groups} labels={{ label: 'Distribution' }} />);
    const paths = container.querySelectorAll('[data-violin-path]');
    expect(paths).toHaveLength(2);
    expect(paths[0]?.getAttribute('d')?.endsWith('Z')).toBe(true);
    expect(paths[0]?.getAttribute('fill')).toBe('var(--accent-area)');
    expect(container.querySelectorAll('[data-median]')).toHaveLength(2);
  });
});

describe('RidgelineChart', () => {
  const groups = [
    { label: 'Mon', density: [0, 2, 5, 3, 1] },
    { label: 'Tue', density: [1, 3, 4, 2, 0] },
    { label: 'Wed', density: [0, 1, 3, 6, 2] },
  ];

  it('renders overlapping ridges with accent fills and label text', () => {
    const { container } = render(<RidgelineChart groups={groups} labels={{ label: 'Weekday density' }} />);
    expect(container.querySelectorAll('[data-ridge-area]')).toHaveLength(3);
    expect(container.querySelector('[data-ridge-area]')?.getAttribute('fill')).toBe('var(--accent)');
    expect(container.textContent).toContain('Mon');
  });
});

describe('ScatterBubbleChart', () => {
  const points = [
    { x: 1, y: 2, r: 3, segment: 'us' },
    { x: 4, y: 5, r: 6, segment: 'eu' },
    { x: 7, y: 3, r: 2, segment: 'us' },
  ];

  it('renders points, a dashed trend line, and segment colors', () => {
    const { container, getByRole } = render(
      <ScatterBubbleChart points={points} labels={{ label: 'Revenue vs size' }} />,
    );
    expect(getByRole('img').getAttribute('aria-label')).toBe('Revenue vs size');
    expect(container.querySelectorAll('[data-point-index]')).toHaveLength(3);
    const trend = container.querySelector('[data-trend]');
    expect(trend?.getAttribute('stroke-dasharray')).toBe('5 4');
    // Distinct segments → distinct viz palette colors.
    const us = container.querySelector('[data-segment="us"]')?.getAttribute('fill');
    const eu = container.querySelector('[data-segment="eu"]')?.getAttribute('fill');
    expect(us).toBe('var(--viz-1)');
    expect(eu).toBe('var(--viz-2)');
  });

  it('mirrors point x order in RTL', () => {
    const cx = (dir: 'ltr' | 'rtl') => {
      const { container } = render(
        <ScatterBubbleChart points={points} labels={{ label: 'x' }} dir={dir} trendLine={false} />,
      );
      return Number(container.querySelector('[data-point-index="0"]')?.getAttribute('cx'));
    };
    // Point 0 has the smallest x → left in LTR, right in RTL.
    expect(cx('ltr')).toBeLessThan(cx('rtl'));
  });
});

describe('HexbinChart', () => {
  const cells = [
    [1, 4, null],
    [null, 6, 2],
  ];

  it('renders one hex per present cell, omitting sparse cells, alpha by count', () => {
    const { container } = render(<HexbinChart cells={cells} labels={{ label: 'User density' }} />);
    const hexes = container.querySelectorAll('polygon[data-count]');
    expect(hexes).toHaveLength(4); // two nulls omitted
    for (const hex of hexes) expect(hex.getAttribute('fill')).toBe('var(--accent)');
    const peak = container.querySelector('polygon[data-count="6"]');
    const low = container.querySelector('polygon[data-count="1"]');
    expect(Number(peak?.getAttribute('fill-opacity'))).toBeGreaterThan(Number(low?.getAttribute('fill-opacity')));
  });
});

describe('CorrelationMatrixChart', () => {
  const columns = ['mrr', 'seats', 'age'];
  const cells = [
    [1, 0.82, -0.31],
    [0.82, 1, -0.12],
    [-0.31, -0.12, 1],
  ];

  it('renders accent/danger cells by sign with mono values', () => {
    const { container } = render(
      <CorrelationMatrixChart cells={cells} columns={columns} labels={{ label: 'Correlations' }} height={300} />,
    );
    const cellGroups = container.querySelectorAll('[data-cell-row]');
    expect(cellGroups).toHaveLength(9);
    expect(container.querySelector('[data-sign="pos"]')?.getAttribute('fill')).toBe('var(--accent)');
    expect(container.querySelector('[data-sign="neg"]')?.getAttribute('fill')).toBe('var(--danger)');
    expect(container.textContent).toContain('0.82');
    expect(container.textContent).toContain('-0.31');
  });
});

describe('ParallelCoordinatesChart', () => {
  const axes = [
    { key: 'a', label: 'Speed', min: 0, max: 10 },
    { key: 'b', label: 'Reach', min: 0, max: 10 },
    { key: 'c', label: 'Cost', min: 0, max: 10 },
  ];
  const records = [
    { values: [2, 8, 5], segment: 'free' },
    { values: [6, 4, 9], segment: 'pro' },
  ];

  it('renders vertical axes + one polyline per record with segment colors', () => {
    const { container } = render(
      <ParallelCoordinatesChart axes={axes} records={records} labels={{ label: 'Segment profiles' }} />,
    );
    expect(container.querySelectorAll('[data-axis-index]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-record-index]')).toHaveLength(2);
    expect(container.querySelector('[data-segment="free"]')?.getAttribute('stroke')).toBe('var(--viz-1)');
    expect(container.querySelector('[data-segment="pro"]')?.getAttribute('stroke')).toBe('var(--viz-2)');
    expect(container.textContent).toContain('Speed');
  });
});
