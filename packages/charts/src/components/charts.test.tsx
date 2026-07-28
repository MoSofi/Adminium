// @vitest-environment happy-dom
/**
 * Render tests for the chart primitives (happy-dom): SVG structure/paths,
 * a11y contract, categorical RTL mirroring, reduced-motion path. Storybook
 * stories live in Wave B's @adminium/widgets wrappers, not here.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { demoCategorical, demoDonut, demoSparkline, demoTimeseries } from '../demo/generators.js';
import { formatShortDate } from '../utils/format.js';
import { BarChart } from './BarChart.js';
import { ChartSurface } from './ChartSurface.js';
import { DonutChart } from './DonutChart.js';
import { LineAreaChart } from './LineAreaChart.js';
import { Sparkline } from './Sparkline.js';

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

beforeEach(() => {
  installMatchMedia(false);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ChartSurface', () => {
  it('renders a labelled SVG viewport with desc, export marker and a11y fallback', () => {
    const { container } = render(
      <ChartSurface
        labels={{ label: 'Revenue over time', description: 'Daily revenue, last 30 days' }}
        height={200}
        a11yFallback={<table />}
      >
        {({ innerWidth, innerHeight }) => <rect width={innerWidth} height={innerHeight} data-plot="" />}
      </ChartSurface>,
    );
    const svg = container.querySelector('svg[role="img"]');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('aria-label')).toBe('Revenue over time');
    expect(svg?.hasAttribute('data-export-node')).toBe(true);
    expect(svg?.querySelector('desc')?.textContent).toBe('Daily revenue, last 30 days');
    expect(container.querySelector('[data-plot]')).not.toBeNull();
    expect(container.querySelector('.adm-chart-sr table')).not.toBeNull();
  });
});

describe('LineAreaChart', () => {
  const data = demoTimeseries(7, { points: 14 });

  it('renders line + gradient area paths and axis labels', () => {
    const { container } = render(
      <LineAreaChart data={data} labels={{ label: 'Signups' }} />,
    );
    expect(container.querySelector('path[data-series="line"]')?.getAttribute('d')).toMatch(/^M/);
    const areaFill = container.querySelector('path[data-series="area"]')?.getAttribute('fill') ?? '';
    expect(areaFill).toMatch(/^url\(#/);
    expect(container.querySelector('linearGradient stop')?.getAttribute('stop-color')).toBe('var(--accent-area)');
    expect(container.querySelectorAll('.adm-chart-axis-label').length).toBeGreaterThan(0);
  });

  it('renders the dashed comparison series when provided', () => {
    const comparison = data.map((p) => ({ x: p.x, y: p.y * 0.8 }));
    const { container } = render(
      <LineAreaChart data={data} comparison={comparison} labels={{ label: 'Signups vs prior' }} />,
    );
    const dashed = container.querySelector('path[data-series="comparison"]');
    expect(dashed?.getAttribute('stroke-dasharray')).toBe('4 4');
    expect(dashed?.getAttribute('stroke')).toBe('var(--viz-2)');
  });

  it('time x NEVER mirrors: identical line path in ltr and rtl', () => {
    const ltr = render(<LineAreaChart data={data} labels={{ label: 'x' }} dir="ltr" />);
    const rtl = render(<LineAreaChart data={data} labels={{ label: 'x' }} dir="rtl" />);
    const path = (c: HTMLElement) => c.querySelector('path[data-series="line"]')?.getAttribute('d');
    expect(path(rtl.container)).toBe(path(ltr.container));
  });

  it('categorical x mirrors in rtl (different path)', () => {
    const categorical = [
      { x: 'Mon', y: 3 },
      { x: 'Tue', y: 9 },
      { x: 'Wed', y: 5 },
    ];
    const ltr = render(<LineAreaChart data={categorical} labels={{ label: 'x' }} dir="ltr" smooth={false} />);
    const rtl = render(<LineAreaChart data={categorical} labels={{ label: 'x' }} dir="rtl" smooth={false} />);
    const path = (c: HTMLElement) => c.querySelector('path[data-series="line"]')?.getAttribute('d');
    expect(path(rtl.container)).not.toBe(path(ltr.container));
  });
});

describe('BarChart', () => {
  const categories = ['Jan', 'Feb', 'Mar', 'Apr'];
  const values = [12, 40, 25, 31];

  it('renders one column per category and highlights the max by default', () => {
    const { container } = render(
      <BarChart categories={categories} series={[{ name: 'Orders', values }]} labels={{ label: 'Orders' }} />,
    );
    const bars = container.querySelectorAll('rect[data-category-index]');
    expect(bars).toHaveLength(4);
    const highlighted = container.querySelector('rect[data-highlighted]');
    expect(highlighted?.getAttribute('data-category-index')).toBe('1');
    expect(highlighted?.getAttribute('fill')).toBe('var(--accent)');
    expect(container.querySelector('rect[data-category-index="0"]')?.getAttribute('fill')).toBe('var(--viz-ramp-3)');
  });

  it('grouped 2-series mode renders 2n bars with viz-1/viz-2 fills', () => {
    const { container } = render(
      <BarChart
        categories={categories}
        series={[
          { name: 'Current', values },
          { name: 'Previous', values: values.map((v) => v - 5) },
        ]}
        labels={{ label: 'Orders by year' }}
      />,
    );
    expect(container.querySelectorAll('rect[data-category-index]')).toHaveLength(8);
    expect(container.querySelector('rect[data-series-index="0"]')?.getAttribute('fill')).toBe('var(--viz-1)');
    expect(container.querySelector('rect[data-series-index="1"]')?.getAttribute('fill')).toBe('var(--viz-2)');
  });

  it('mirrors category order in rtl (RTL flip flips categorical order)', () => {
    const chart = (dir: 'ltr' | 'rtl') =>
      render(
        <BarChart categories={categories} series={[{ name: 'v', values }]} labels={{ label: 'x' }} dir={dir} />,
      ).container;
    const xOf = (c: HTMLElement, index: number) =>
      Number(c.querySelector(`rect[data-category-index="${index}"]`)?.getAttribute('x'));
    const ltr = chart('ltr');
    const rtl = chart('rtl');
    expect(xOf(ltr, 0)).toBeLessThan(xOf(ltr, 3));
    expect(xOf(rtl, 0)).toBeGreaterThan(xOf(rtl, 3));
  });

  it('gates the nb-grow entrance on mount and skips it under reduced motion', () => {
    const gated = render(
      <BarChart categories={categories} series={[{ name: 'v', values }]} labels={{ label: 'x' }} />,
    );
    const gatedBar = gated.container.querySelector('rect[data-category-index="0"]') as SVGRectElement;
    expect(gatedBar.style.getPropertyValue('--adm-grow')).toBe('0');
    expect(gatedBar.getAttribute('class')).toContain('adm-chart-grow');
    gated.unmount();

    installMatchMedia(true); // prefers-reduced-motion: reduce → final state immediately
    const reduced = render(
      <BarChart categories={categories} series={[{ name: 'v', values }]} labels={{ label: 'x' }} />,
    );
    const reducedBar = reduced.container.querySelector('rect[data-category-index="0"]') as SVGRectElement;
    expect(reducedBar.style.getPropertyValue('--adm-grow')).toBe('1');
  });
});

describe('DonutChart', () => {
  it('renders arcs, inner total, legend rows with dot + mono value', () => {
    const data = demoDonut(3);
    const total = data.reduce((s, d) => s + d.value, 0);
    const { container, getByRole } = render(
      <DonutChart data={data} labels={{ label: 'Plan distribution' }} centerLabel="Total" />,
    );
    expect(getByRole('img').getAttribute('aria-label')).toBe('Plan distribution');
    expect(container.querySelectorAll('path[data-slice]')).toHaveLength(4);
    expect(container.querySelector('.adm-donut-center-value')?.textContent?.length).toBeGreaterThan(0);
    expect(container.querySelector('.adm-donut-center-label')?.textContent).toBe('Total');
    const rows = container.querySelectorAll('.adm-donut-legend-row');
    expect(rows).toHaveLength(4);
    const dot = rows[0]?.querySelector('.adm-donut-legend-dot') as HTMLElement;
    expect(dot.style.getPropertyValue('--adm-dot')).toBe('var(--viz-1)');
    expect(rows[0]?.querySelector('.adm-donut-legend-value')).not.toBeNull();
    expect(total).toBeGreaterThan(0);
  });

  it('buckets slices beyond maxSlices into "Other"', () => {
    const data = Array.from({ length: 8 }, (_, i) => ({ label: `S${i}`, value: 10 + i }));
    const { container } = render(
      <DonutChart data={data} labels={{ label: 'x' }} maxSlices={5} />,
    );
    const slices = container.querySelectorAll('path[data-slice]');
    expect(slices).toHaveLength(6);
    const other = container.querySelector('path[data-other]');
    expect(other?.getAttribute('data-slice')).toBe('Other');
    expect(other?.getAttribute('fill')).toBe('var(--fg-subtle)');
  });
});

describe('chart-primitive label localization (ui:charts.*)', () => {
  it('resolves bundle strings inside I18nProvider and falls back to English outside', async () => {
    const { createI18n } = await import('@adminium/i18n');
    const { I18nProvider } = await import('@adminium/i18n/react');
    const i18n = await createI18n({
      locale: 'de_DE',
      loadBundle: async (_tag, ns) => (ns === 'ui' ? { charts: { otherLabel: 'Sonstige' } } : null),
    });
    const data = Array.from({ length: 8 }, (_, i) => ({ label: `S${i}`, value: 10 + i }));
    const provided = render(
      <I18nProvider i18n={i18n}>
        <DonutChart data={data} labels={{ label: 'x' }} maxSlices={5} />
      </I18nProvider>,
    );
    // The translated default threads through the geometry's bucket label.
    expect(provided.container.querySelector('path[data-other]')?.getAttribute('data-slice')).toBe('Sonstige');

    cleanup();
    const bare = render(<DonutChart data={data} labels={{ label: 'x' }} maxSlices={5} />);
    expect(bare.container.querySelector('path[data-other]')?.getAttribute('data-slice')).toBe('Other');
  });

  it('formatShortDate stays byte-identical for en-US and localizes via the locale param', () => {
    const date = new Date(Date.UTC(2026, 2, 4));
    expect(formatShortDate(date)).toBe('Mar 4');
    expect(formatShortDate(date, 'en-US')).toBe('Mar 4');
    expect(formatShortDate(date, 'de-DE')).not.toBe('Mar 4');
  });
});

describe('Sparkline', () => {
  const data = demoSparkline(5);

  it('bar variant: one rect per point, last emphasized, decorative by default', () => {
    const { container } = render(<Sparkline data={data} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    const bars = container.querySelectorAll('rect');
    expect(bars).toHaveLength(data.length);
    const last = container.querySelector('rect[data-last]');
    expect(last?.getAttribute('opacity')).toBe('1');
    expect(bars[0]?.getAttribute('opacity')).toBe('0.45');
  });

  it('line variant renders a polyline + last-point marker; label makes it role=img', () => {
    const { container } = render(<Sparkline data={data} variant="line" label="Trend, last 8 days" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.getAttribute('aria-label')).toBe('Trend, last 8 days');
    expect(container.querySelector('polyline')?.getAttribute('points')?.length).toBeGreaterThan(0);
    expect(container.querySelector('circle[data-last]')).not.toBeNull();
  });

  it('demo categorical data feeds BarChart cleanly (smoke)', () => {
    const cats = demoCategorical(11);
    const { container } = render(
      <BarChart
        categories={cats.map((c) => c.label)}
        series={[{ name: 'v', values: cats.map((c) => c.value) }]}
        labels={{ label: 'Demo' }}
      />,
    );
    expect(container.querySelectorAll('rect[data-category-index]')).toHaveLength(cats.length);
  });
});
