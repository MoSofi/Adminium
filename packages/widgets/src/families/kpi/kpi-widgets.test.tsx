// @vitest-environment happy-dom
/**
 * KPI family render tests: kpi-stat-card formatting (currency/percent),
 * delta-pill trend + "down-is-good" inversion, sparkline toggle;
 * usage-meter threshold tones. Locale pinned via config.format overrides.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { KpiStatCard, kpiStatCardConfigSchema } from './KpiStatCard.js';
import { UsageMeter, usageMeterConfigSchema } from './UsageMeter.js';
import { kpiStatCardDemoData, kpiWidgetDefinitions, usageMeterDemoData } from './definitions.js';

const noop = () => {};

function statCardConfig(input: Record<string, unknown>) {
  return kpiStatCardConfigSchema.parse({ format: { locale: 'en-US' }, ...input });
}

describe('kpi-stat-card', () => {
  it('formats the value per config.metricFormat and renders label + delta', () => {
    render(
      <KpiStatCard
        config={statCardConfig({ metricLabel: 'Revenue (30d)', metricFormat: 'currency' })}
        data={{ value: 48_210, prior: 42_900 }}
        instanceId="w1"
        onEvent={noop}
      />,
    );
    expect(screen.getByText('$48,210')).toBeDefined();
    expect(screen.getByText('Revenue (30d)')).toBeDefined();
    const pill = screen.getByText('+12.4%').closest('[data-trend]');
    expect(pill?.getAttribute('data-trend')).toBe('up');
    expect(pill?.getAttribute('data-tone')).toBe('pos');
  });

  it('inverts the delta tone for down-is-good metrics (invertDeltaGood)', () => {
    render(
      <KpiStatCard
        config={statCardConfig({ metricFormat: 'percent', invertDeltaGood: true })}
        data={{ value: 0.031, prior: 0.045 }}
        instanceId="w2"
        onEvent={noop}
      />,
    );
    expect(screen.getByText('3.1%')).toBeDefined();
    const pill = document.querySelector('[data-trend]');
    expect(pill?.getAttribute('data-trend')).toBe('down');
    expect(pill?.getAttribute('data-tone')).toBe('pos'); // down reads as good
  });

  it('renders the spark bars only when configured and present, and hides the pill for deltaMode none', () => {
    const { container, rerender } = render(
      <KpiStatCard
        config={statCardConfig({ showSparkline: true })}
        data={{ value: 10, spark: [1, 2, 3, 4, 5, 6, 7, 8] }}
        instanceId="w3"
        onEvent={noop}
      />,
    );
    expect(container.querySelector('.adm-spark')).not.toBeNull();
    expect(container.querySelector('[data-trend]')).toBeNull(); // no prior/deltaPct

    rerender(
      <KpiStatCard
        config={statCardConfig({ showSparkline: false, deltaMode: 'none' })}
        data={{ value: 10, prior: 5, spark: [1, 2, 3] }}
        instanceId="w3"
        onEvent={noop}
      />,
    );
    expect(container.querySelector('.adm-spark')).toBeNull();
    expect(container.querySelector('[data-trend]')).toBeNull();
  });

  it('demo data is deterministic per seed and matches the metric+delta contract', () => {
    expect(kpiStatCardDemoData(7)).toEqual(kpiStatCardDemoData(7));
    const demo = kpiStatCardDemoData(7);
    expect(demo.value).toBeGreaterThan(0);
    expect(demo.spark).toHaveLength(8);
    expect(usageMeterDemoData(3)).toEqual(usageMeterDemoData(3));
  });
});

describe('usage-meter', () => {
  function meter(value: number, config: Record<string, unknown> = {}) {
    const { container } = render(
      <UsageMeter
        config={usageMeterConfigSchema.parse({ title: 'AI credits', limit: 100, ...config })}
        data={{ value }}
        instanceId="m1"
        onEvent={noop}
      />,
    );
    return container.querySelector('[data-widget="usage-meter"]');
  }

  it('stays accent under the warn threshold', () => {
    expect(meter(50)?.getAttribute('data-tone')).toBe('accent');
  });

  it('flips to warn at 80% and danger at 95%', () => {
    expect(meter(85)?.getAttribute('data-tone')).toBe('warn');
    expect(meter(96, { title: 'Storage' })?.getAttribute('data-tone')).toBe('danger');
  });

  it('renders the "used of limit" mono text and an accessible progressbar', () => {
    meter(72, { unit: 'GB' });
    expect(screen.getByText(/72/)).toBeDefined();
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('72');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
  });
});

describe('kpi definitions', () => {
  it('registers kpi-stat-card and usage-meter with annex sizing in half-units', () => {
    const ids = kpiWidgetDefinitions.map((d) => d.id);
    expect(ids).toEqual(['kpi-stat-card', 'usage-meter']);
    const statCard = kpiWidgetDefinitions[0]!;
    expect(statCard.sizing).toEqual({ minW: 3, minH: 2, defaultW: 3, defaultH: 3 }); // 3×1.5 rows
    expect(statCard.dataContract).toBe('metric+delta');
    expect(statCard.placement).toBe('grid');
  });
});
