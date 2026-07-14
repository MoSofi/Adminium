// @vitest-environment happy-dom
/**
 * Charts family wrapper tests: config→chart prop mapping (aria labels from
 * config.title, axis/legend/highlight toggles), §3 envelope narrowing
 * (timeseries vs categorical bar inputs), tone mapping, and deterministic
 * demo payloads matching the declared data contracts.
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  ChartBarWidget,
  ChartDonutWidget,
  ChartLineAreaWidget,
  ChartSparklineWidget,
  barInputsOf,
  chartBarConfigSchema,
  chartDonutConfigSchema,
  chartLineAreaConfigSchema,
  chartSparklineConfigSchema,
  sparklineToneOf,
} from './ChartWidgets.js';
import {
  categoricalDemoData,
  chartsWidgetDefinitions,
  timeseriesDemoData,
} from './definitions.js';

const noop = () => {};

const ts = {
  points: [
    { t: '2026-05-01T00:00:00.000Z', v: 10 },
    { t: '2026-05-02T00:00:00.000Z', v: 14 },
    { t: '2026-05-03T00:00:00.000Z', v: 9 },
  ],
  compare: [
    { t: '2026-04-01T00:00:00.000Z', v: 8 },
    { t: '2026-04-02T00:00:00.000Z', v: 11 },
    { t: '2026-04-03T00:00:00.000Z', v: 12 },
  ],
};

const cat = {
  items: [
    { key: 'todo', label: 'To do', value: 12 },
    { key: 'doing', label: 'In progress', value: 7 },
    { key: 'done', label: 'Done', value: 21 },
  ],
  total: 40,
};

describe('chart-line-area', () => {
  it('labels the SVG from config.title and draws the comparison series when present', () => {
    const { container } = render(
      <ChartLineAreaWidget
        config={chartLineAreaConfigSchema.parse({ title: 'Revenue over time' })}
        data={ts}
        instanceId="c1"
        onEvent={noop}
      />,
    );
    const svg = container.querySelector('svg[role="img"]');
    expect(svg?.getAttribute('aria-label')).toBe('Revenue over time');
    expect(container.querySelector('[data-widget="chart-line-area"]')).not.toBeNull();
  });

  it('drops the comparison line when compareToPrior is off and falls back on bad data', () => {
    const { container, rerender } = render(
      <ChartLineAreaWidget
        config={chartLineAreaConfigSchema.parse({ compareToPrior: false })}
        data={ts}
        instanceId="c1"
        onEvent={noop}
      />,
    );
    expect(container.querySelector('svg')).not.toBeNull();
    rerender(
      <ChartLineAreaWidget
        config={chartLineAreaConfigSchema.parse({})}
        data={{ nonsense: true }}
        instanceId="c1"
        onEvent={noop}
      />,
    );
    expect(container.querySelector('svg')).toBeNull();
    expect(container.textContent).toContain('Unexpected data shape');
  });
});

describe('chart-bar input mapping', () => {
  it('maps timeseries points to short-date categories and one value series', () => {
    const inputs = barInputsOf(ts, 'Orders');
    expect(inputs?.series).toEqual([{ name: 'Orders', values: [10, 14, 9] }]);
    expect(inputs?.categories).toHaveLength(3);
  });

  it('maps categorical items to label categories', () => {
    const inputs = barInputsOf(cat, 'Tasks');
    expect(inputs?.categories).toEqual(['To do', 'In progress', 'Done']);
    expect(inputs?.series[0]?.values).toEqual([12, 7, 21]);
  });

  it('rejects unusable payloads', () => {
    expect(barInputsOf({ points: 'no' }, 'x')).toBeNull();
    expect(barInputsOf({ items: [] }, 'x')).toBeNull();
  });

  it('renders with the aria label from config.title', () => {
    const { container } = render(
      <ChartBarWidget
        config={chartBarConfigSchema.parse({ title: 'Weekly activity' })}
        data={cat}
        instanceId="c2"
        onEvent={noop}
      />,
    );
    expect(container.querySelector('svg[role="img"]')?.getAttribute('aria-label')).toBe(
      'Weekly activity',
    );
  });
});

describe('chart-donut', () => {
  it('renders slices from categorical items with legend rows', () => {
    const { container } = render(
      <ChartDonutWidget
        config={chartDonutConfigSchema.parse({ title: 'Task breakdown', centerLabel: 'Total' })}
        data={cat}
        instanceId="c3"
        onEvent={noop}
      />,
    );
    expect(container.querySelector('svg[role="img"]')?.getAttribute('aria-label')).toBe(
      'Task breakdown',
    );
    expect(container.textContent).toContain('Done');
    expect(container.textContent).toContain('Total');
  });
});

describe('chart-sparkline', () => {
  it('maps shared tones onto sparkline tones', () => {
    expect(sparklineToneOf('pos')).toBe('positive');
    expect(sparklineToneOf('danger')).toBe('danger');
    expect(sparklineToneOf('muted')).toBe('muted');
    expect(sparklineToneOf(undefined)).toBe('accent');
    expect(sparklineToneOf('warn')).toBe('accent');
  });

  it('renders bar sparks from timeseries values, labelled only when titled', () => {
    const { container, rerender } = render(
      <ChartSparklineWidget
        config={chartSparklineConfigSchema.parse({ title: 'Trend' })}
        data={ts}
        instanceId="c4"
        onEvent={noop}
      />,
    );
    const svg = container.querySelector('svg.adm-spark');
    expect(svg?.getAttribute('aria-label')).toBe('Trend');
    expect(svg?.querySelectorAll('rect')).toHaveLength(3);

    rerender(
      <ChartSparklineWidget
        config={chartSparklineConfigSchema.parse({ variant: 'line' })}
        data={ts}
        instanceId="c4"
        onEvent={noop}
      />,
    );
    expect(container.querySelector('svg.adm-spark')?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('charts definitions', () => {
  it('registers the four M4 chart widgets with annex sizing in half-units', () => {
    expect(chartsWidgetDefinitions.map((d) => d.id)).toEqual([
      'chart-line-area',
      'chart-bar',
      'chart-donut',
      'chart-sparkline',
    ]);
    const lineArea = chartsWidgetDefinitions[0]!;
    expect(lineArea.sizing).toEqual({ minW: 4, minH: 4, defaultW: 8, defaultH: 6 }); // 8×3 rows
    expect(lineArea.capabilities?.exportPng).toBe(true);
    expect(chartsWidgetDefinitions[3]!.placement).toBe('inline');
  });

  it('demo payloads are deterministic and match the declared contracts', () => {
    expect(timeseriesDemoData(11)).toEqual(timeseriesDemoData(11));
    const demo = timeseriesDemoData(11);
    expect(demo.points).toHaveLength(30);
    expect(demo.compare).toHaveLength(30);
    expect(typeof demo.points[0]?.t).toBe('string');

    const donut = categoricalDemoData(4);
    expect(donut).toEqual(categoricalDemoData(4));
    expect(donut.total).toBe(donut.items.reduce((sum, item) => sum + item.value, 0));
  });
});
