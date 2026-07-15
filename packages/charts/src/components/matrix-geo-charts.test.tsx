// @vitest-environment happy-dom
/**
 * Render tests for the Track E chart primitives (matrix, calendar & geo-grid):
 * SVG structure, a11y contract, token-only fills, reduced-motion final state,
 * and the Sankey LTR-island invariant (paths identical in ltr/rtl). Geometry
 * determinism / RTL mirroring is covered in ../geometry/matrix-geo-geometry.test.ts.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CohortMatrixChart } from './CohortMatrixChart.js';
import { HeatCalendarChart } from './HeatCalendarChart.js';
import { HeatMonthChart } from './HeatMonthChart.js';
import { ChoroplethGridChart } from './ChoroplethGridChart.js';
import { SankeyChart } from './SankeyChart.js';

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

const cohort = {
  rowKeys: ['Jan', 'Feb', 'Mar'],
  colKeys: ['M0', 'M1', 'M2'],
  cells: [
    [100, 70, 55],
    [100, 60, null],
    [100, null, null],
  ] as (number | null)[][],
};

describe('CohortMatrixChart', () => {
  it('renders a labelled grid with tinted cells and transparent gaps', () => {
    const { container } = render(
      <CohortMatrixChart {...cohort} labels={{ label: 'Cohort retention' }} />,
    );
    expect(container.querySelector('svg[role="img"]')?.getAttribute('aria-label')).toBe('Cohort retention');
    expect(container.querySelector('svg[data-export-node]')).not.toBeNull();
    expect(container.querySelectorAll('rect[data-cohort-cell]')).toHaveLength(9);
    expect(container.querySelectorAll('rect[data-gap]')).toHaveLength(3);
    // A 100% cell flips to the on-accent text color.
    const flipped = [...container.querySelectorAll('text')].some(
      (t) => t.getAttribute('fill') === 'var(--accent-fg)',
    );
    expect(flipped).toBe(true);
    // No raw color literals in fills.
    for (const rect of container.querySelectorAll('rect[data-cohort-cell]')) {
      const fill = rect.getAttribute('fill') ?? '';
      expect(fill === 'none' || fill.startsWith('var(--')).toBe(true);
    }
  });
});

describe('HeatCalendarChart', () => {
  const points = [
    { t: '2026-06-01', v: 2 },
    { t: '2026-06-14', v: 8 },
    { t: '2026-06-28', v: 5 },
  ];

  it('renders day cells, a legend, and sets the dir attribute in RTL', () => {
    const { container } = render(
      <HeatCalendarChart points={points} weeks={8} labels={{ label: 'Contributions' }} dir="rtl" />,
    );
    expect(container.querySelectorAll('rect[data-heat-cell]').length).toBeGreaterThan(0);
    expect(container.querySelector('.adm-heatcal')?.getAttribute('dir')).toBe('rtl');
    // Legend swatches (levels = 5) present.
    expect(container.textContent).toContain('Less');
    expect(container.textContent).toContain('More');
  });
});

describe('HeatMonthChart', () => {
  it('renders in-month day numbers for June 2026 (30 days)', () => {
    const { container } = render(
      <HeatMonthChart
        year={2026}
        month={5}
        points={[{ t: '2026-06-10', v: 4 }]}
        labels={{ label: 'June activity' }}
      />,
    );
    expect(container.querySelectorAll('rect[data-heat-cell]')).toHaveLength(30);
    expect(container.textContent).toContain('Mon');
  });
});

describe('ChoroplethGridChart', () => {
  const points = [
    { code: 'CA', name: 'California', values: { sales: 90 } },
    { code: 'TX', name: 'Texas', values: { sales: 40 } },
    { code: 'NY', name: 'New York', values: { sales: 20 } },
  ];

  it('renders tilegram tiles keyed by state code with a low→high legend', () => {
    const { container } = render(
      <ChoroplethGridChart points={points} metric="sales" labels={{ label: 'Sales by state' }} />,
    );
    expect(container.querySelector('rect[data-region-tile="CA"]')).not.toBeNull();
    expect(container.textContent).toContain('CA');
    expect(container.textContent).toContain('Low');
    expect(container.textContent).toContain('High');
  });
});

describe('SankeyChart', () => {
  const nodes = [
    { id: 'a', label: 'Visited' },
    { id: 'b', label: 'Signed up' },
    { id: 'c', label: 'Paid' },
  ];
  const links = [
    { from: 'a', to: 'b', weight: 60 },
    { from: 'b', to: 'c', weight: 30 },
  ];

  it('renders ribbons + nodes and labels the SVG', () => {
    const { container } = render(<SankeyChart nodes={nodes} links={links} labels={{ label: 'Conversion flow' }} />);
    expect(container.querySelector('svg[role="img"]')?.getAttribute('aria-label')).toBe('Conversion flow');
    expect(container.querySelectorAll('path[data-sankey-link]')).toHaveLength(2);
    expect(container.querySelectorAll('rect[data-sankey-node]')).toHaveLength(3);
  });

  it('is an LTR island — ribbon paths are identical in ltr and rtl', () => {
    const path = (dir: 'ltr' | 'rtl') =>
      render(<SankeyChart nodes={nodes} links={links} labels={{ label: 'x' }} dir={dir} />)
        .container.querySelector('path[data-sankey-link]')
        ?.getAttribute('d');
    expect(path('rtl')).toBe(path('ltr'));
  });

  it('renders at final state under prefers-reduced-motion (no animation frame)', () => {
    installMatchMedia(true);
    const { container } = render(<SankeyChart nodes={nodes} links={links} labels={{ label: 'x' }} />);
    const fade = container.querySelector('.adm-chart-fade') as SVGGElement | null;
    expect(fade?.style.getPropertyValue('--adm-fade')).toBe('1');
  });
});
