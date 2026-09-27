// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * What an overview page's cards draw: a chart's figures as a table (its text
 * alternative, and "Show data"), a card's words in the page's language, a
 * figure there is none of, a pair of bars with their names, a list's second
 * line and its sold-and-held bar, and the KPI tiles a hotel and a box office
 * use.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { lazy } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { chartBarConfigSchema } from '../families/charts/charts-config.js';
import { barInputsOf, ChartBarWidget } from '../families/charts/ChartWidgets.js';
import { kpiStatCardConfigSchema } from '../families/kpi/kpi-config.js';
import { KpiStatCard } from '../families/kpi/KpiStatCard.js';
import { miniTableConfigSchema } from '../families/tables/tables-config.js';
import { MiniTableWidget } from '../families/tables/widgets.js';
import { chartTableOf, type ChartTableOptions } from '../lib/chart-table.js';
import { isEmptyData } from '../registry/data-empty.js';
import { buildRegistry } from '../registry/index.js';
import { defineWidget } from '../registry/types.js';
import { widgetMissingDefinition } from '../registry/widget-missing.js';
import { makeTestDefinition, testWidgetConfigSchema } from '../test/fixtures.js';
import { localizedConfig, WidgetHost } from './WidgetHost.js';

afterEach(cleanup);

const words: ChartTableOptions['words'] = {
  period: 'Period',
  value: 'Value',
  prior: 'Period before',
  category: 'Category',
  share: 'Share',
  row: 'Row',
  from: 'From',
  to: 'To',
  min: 'Lowest',
  q1: 'Lower quarter',
  median: 'Middle',
  q3: 'Upper quarter',
  max: 'Highest',
  open: 'Open',
  high: 'High',
  low: 'Low',
  close: 'Close',
  place: 'Place',
};
const opts: ChartTableOptions = {
  words,
  number: (n) => String(n),
  percent: (f) => `${String(Math.round(f * 100))}%`,
  period: (iso) => iso.slice(0, 10),
};

describe('a chart\'s figures as a table', () => {
  it('reads every canonical answer a chart draws', () => {
    expect(chartTableOf({ points: [{ t: '2026-07-20T00:00:00Z', v: 4 }, { t: '2026-07-27T00:00:00Z', v: 10 }], compare: [{ t: '2026-07-13T00:00:00Z', v: 3 }] }, opts)).toEqual({
      headers: ['Period', 'Value', 'Period before'],
      rows: [
        ['2026-07-20', '4', '3'],
        ['2026-07-27', '10', ''],
      ],
      numeric: [false, true, true],
    });
    expect(chartTableOf({ items: [{ key: 'w', label: 'Online', value: 34 }, { key: 'd', label: 'At the desk', value: 6 }], total: 40 }, opts)).toEqual({
      headers: ['Category', 'Value', 'Share'],
      rows: [
        ['Online', '34', '85%'],
        ['At the desk', '6', '15%'],
      ],
      numeric: [false, true, true],
    });
    // A pair: a column each, named as the card names them.
    expect(
      chartTableOf(
        { items: [{ key: '1', label: 'Neon', value: 150.3, values: { received: 150.3, owed: 25 } }], aggregates: ['received', 'owed'] },
        { ...opts, seriesNames: ['Received', 'Still owed'] },
      ),
    ).toEqual({ headers: ['Category', 'Received', 'Still owed'], rows: [['Neon', '150.3', '25']], numeric: [false, true, true] });
    expect(chartTableOf({ series: [{ key: 'a', label: 'Web', points: [{ t: '2026-07-01T00:00:00Z', v: 1 }] }, { key: 'b', label: 'Desk', points: [{ t: '2026-07-01T00:00:00Z', v: 2 }, { t: '2026-07-02T00:00:00Z', v: 5 }] }] }, opts)?.rows).toEqual([
      ['2026-07-01', '1', '2'],
      ['2026-07-02', '', '5'],
    ]);
    expect(chartTableOf({ rowKeys: ['Mon'], colKeys: ['09', '10'], cells: [[1, null]] }, opts)).toEqual({ headers: ['Row', '09', '10'], rows: [['Mon', '1', '']], numeric: [false, true, true] });
    expect(chartTableOf({ groups: [{ key: 'a', label: 'Lofts', min: 1, q1: 2, med: 3, q3: 4, max: 5 }] }, opts)?.rows).toEqual([['Lofts', '1', '2', '3', '4', '5']]);
    expect(chartTableOf({ nodes: [{ id: 'w', label: 'Web', layer: 0 }, { id: 'p', label: 'Paid', layer: 1 }], links: [{ from: 'w', to: 'p', weight: 7 }] }, opts)?.rows).toEqual([['Web', 'Paid', '7']]);
    expect(chartTableOf({ candles: [{ t: '2026-07-01T00:00:00Z', o: 1, h: 3, l: 0.5, c: 2 }] }, opts)?.rows).toEqual([['2026-07-01', '1', '3', '0.5', '2']]);
    expect(chartTableOf({ roots: [{ id: 'r', label: 'Rooms', children: [{ id: 'l', label: 'Loft', value: 4, children: [] }] }] }, opts)?.rows).toEqual([['Rooms › Loft', '4']]);
    expect(chartTableOf({ points: [{ name: 'Lisbon', values: { visits: 3 } }] }, opts)).toEqual({ headers: ['Place', 'visits'], rows: [['Lisbon', '3']], numeric: [false, true] });
    // Nothing to read: no table.
    expect(chartTableOf({ items: [] }, opts)).toBeNull();
    expect(chartTableOf({ whatever: 1 }, opts)).toBeNull();
    expect(chartTableOf(null, opts)).toBeNull();
  });
});

const chartDefinition = defineWidget({
  id: 'test-chart',
  family: 'charts',
  component: lazy(() => Promise.resolve({ default: () => <svg data-testid="the-chart" role="img" aria-label="Made each week" /> })),
  configSchema: testWidgetConfigSchema,
  dataContract: 'categorical',
  sizing: { minW: 3, minH: 2, defaultW: 3, defaultH: 3 },
  placement: 'grid',
  skeleton: 'chart',
  demoData: () => ({ items: [] }),
  descriptionKey: 'widgets.test.chart.description',
});
const registry = buildRegistry([widgetMissingDefinition, makeTestDefinition(), chartDefinition]);
const made = { status: 'success' as const, data: { shape: 'categorical', items: [{ key: 'w', label: 'Online', value: 34 }, { key: 'd', label: 'At the desk', value: 6 }], total: 40 }, refetch: () => {} };

describe('a chart card', () => {
  it('carries its figures for a screen reader, and shows them in its place on "Show data"', async () => {
    const user = userEvent.setup();
    const { container } = render(<WidgetHost widgetId="test-chart" instanceId="c1" config={{ title: 'Made online or at the desk', subtitle: 'Last 30 days' }} data={made} registry={registry} />);
    expect(await screen.findByTestId('the-chart')).toBeDefined();
    const toggle = await screen.findByRole('button', { name: 'Show data' });
    // The text alternative: the same figures, hidden from sight, captioned by what they are.
    const alternative = container.querySelector('[data-part="chart-text-alternative"]');
    expect(alternative?.className).toContain('sr-only');
    expect(alternative?.querySelector('caption')?.textContent).toBe('Made online or at the desk · Last 30 days');
    expect([...(alternative?.querySelectorAll('tbody tr') ?? [])].map((row) => row.textContent)).toEqual(['Online3485%', 'At the desk615%']);

    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    await user.click(toggle);
    expect(screen.getByRole('button', { name: 'Hide data' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByTestId('the-chart')).toBeNull();
    expect(screen.getByRole('table').querySelector('caption')?.textContent).toBe('Made online or at the desk · Last 30 days');
    expect(screen.getByRole('rowheader', { name: 'Online' })).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Hide data' }));
    expect(await screen.findByTestId('the-chart')).toBeDefined();
  });

  it('offers no table where there is nothing a chart drew: loading, empty, and a card that is not a chart', async () => {
    render(<WidgetHost widgetId="test-chart" instanceId="c2" config={{ title: 'Made' }} data={{ status: 'loading' }} registry={registry} />);
    expect(screen.queryByRole('button', { name: 'Show data' })).toBeNull();
    cleanup();
    render(<WidgetHost widgetId="test-chart" instanceId="c3" config={{ title: 'Made' }} data={{ ...made, data: { items: [] } }} registry={registry} />);
    expect(screen.queryByRole('button', { name: 'Show data' })).toBeNull();
    cleanup();
    render(<WidgetHost widgetId="test-stat-card" instanceId="k1" config={{ title: 'Revenue' }} data={{ status: 'success', data: { value: 4 }, refetch: () => {} }} registry={registry} />);
    expect(await screen.findByTestId('test-widget')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Show data' })).toBeNull();
  });
});

describe("a card's words in the page's language", () => {
  it('picks the subtitle, the caption and the empty copy as the title is picked', () => {
    const config = {
      title: 'Leaving today',
      titles: { 'de-DE': 'Abreise heute' },
      subtitle: 'balance above zero',
      subtitles: { 'de-DE': 'Saldo über null', fr: 'solde positif' },
      metricLabel: 'in house now',
      metricLabels: { 'de-DE': 'jetzt im Haus' },
      emptyState: { titleKey: 'Nobody owes', titles: { 'de-DE': 'Niemand schuldet etwas' }, bodies: { 'de-DE': 'Alle Konten sind ausgeglichen.' } },
    };
    expect(localizedConfig(config, 'de_DE')).toMatchObject({
      title: 'Abreise heute',
      subtitle: 'Saldo über null',
      metricLabel: 'jetzt im Haus',
      emptyState: { titleKey: 'Niemand schuldet etwas', bodyKey: 'Alle Konten sind ausgeglichen.' },
    });
    // Another region of a language the card speaks; a language it does not.
    expect(localizedConfig(config, 'fr_CA')['subtitle']).toBe('solde positif');
    expect(localizedConfig(config, 'cs_CZ')).toMatchObject({ title: 'Leaving today', subtitle: 'balance above zero', metricLabel: 'in house now', emptyState: { titleKey: 'Nobody owes' } });
    // No translations: the config as it was, the same object.
    const plain = { title: 'Arrivals', emptyState: { titleKey: 'widgets.empty.allCaughtUp' } };
    expect(localizedConfig(plain, 'de_DE')).toBe(plain);
  });

  it('keeps the translations a card carries through its schema', () => {
    const parsed = kpiStatCardConfigSchema.parse({ subtitles: { 'de-DE': 'heute' }, metricLabels: { 'de-DE': 'jetzt im Haus' }, emptyState: { titles: { 'de-DE': 'Nichts' }, bodies: { 'de-DE': 'Noch nichts' } } });
    expect(parsed).toMatchObject({ subtitles: { 'de-DE': 'heute' }, metricLabels: { 'de-DE': 'jetzt im Haus' }, emptyState: { titles: { 'de-DE': 'Nichts' }, bodies: { 'de-DE': 'Noch nichts' } } });
    expect(kpiStatCardConfigSchema.safeParse({ subtitles: { German: 'heute' } }).success).toBe(false);
  });
});

describe('a KPI with no figure', () => {
  it('is empty when there is nothing to count, never when the figure is zero', () => {
    expect(isEmptyData({ shape: 'single-metric', value: null }, 'single-metric')).toBe(true);
    expect(isEmptyData({ shape: 'metric+delta', value: null, prior: 0.5 }, ['single-metric', 'metric+delta'])).toBe(true);
    expect(isEmptyData({ shape: 'single-metric', value: 0 }, 'single-metric')).toBe(false);
  });
});

describe('the tiles a hotel and a box office use', () => {
  it.each(['bed-double', 'log-in', 'log-out', 'wallet', 'calendar-x', 'ticket', 'door-open', 'landmark', 'undo-2'])('draws %s', (iconName) => {
    const config = kpiStatCardConfigSchema.parse({ title: 'In house now', iconName });
    const { container } = render(<KpiStatCard instanceId="k" config={config} data={{ value: 21 }} onEvent={() => undefined} />);
    expect(container.querySelector(`svg.lucide-${iconName}`)).not.toBeNull();
  });
});

describe('paired bars', () => {
  const pair = { shape: 'categorical', items: [{ key: '3', label: 'Paper Moons', value: 1920, values: { received: 1920, owed: 0 } }, { key: '1', label: 'Neon', value: 150.3, values: { received: 150.3, owed: 25 } }], total: 2070.3, aggregates: ['received', 'owed'] };

  it('draws a series for each figure of a pair, named as the card names them', () => {
    expect(barInputsOf(pair, 'Money by show', { seriesNames: ['Received', 'Still owed'] })).toEqual({
      categories: ['Paper Moons', 'Neon'],
      series: [
        { name: 'Received', values: [1920, 150.3] },
        { name: 'Still owed', values: [0, 25] },
      ],
    });
    // Unnamed: the aliases. One figure: one series, as before.
    expect(barInputsOf(pair, 'Money')?.series.map((s) => s.name)).toEqual(['received', 'owed']);
    expect(barInputsOf({ items: [{ key: '1', label: 'Neon', value: 3 }] }, 'Sold')?.series).toEqual([{ name: 'Sold', values: [3] }]);
  });

  it('draws the legend in the card\'s words', () => {
    const config = chartBarConfigSchema.parse({ title: 'Money by show', series: [{ label: 'Received', labels: { 'de-DE': 'Eingegangen' } }, { label: 'Still owed' }] });
    const { container } = render(<ChartBarWidget instanceId="m" config={config} data={pair} onEvent={() => undefined} />);
    expect([...container.querySelectorAll('[data-part="chart-legend"] li')].map((li) => li.textContent)).toEqual(['Received', 'Still owed']);
  });
});

describe('a list row on two lines, with what a limit has taken', () => {
  const data = {
    shape: 'record-list',
    rows: [
      { id: 1, ref: 'WH-S3283', guest: 'Teodor Blank', room_type: 'Loft suite', depart: '2026-07-28', balance: 1099.03, sold: { taken: 391, held: 3, size: 414, left: 23 } },
      { id: 2, ref: 'WH-S3290', guest: 'Ana Ruiz', room_type: null, depart: '2026-07-28', balance: 12, sold: { taken: 420, held: 0, size: 414, left: -6 } },
      { id: 3, ref: 'WH-S3291', guest: 'Bo Lind', room_type: 'Garden', depart: null, balance: 0, sold: null },
    ],
    columns: [
      { name: 'id', logicalType: 'integer', nullable: false, isPrimaryKey: true },
      { name: 'guest', label: 'Guest', logicalType: 'varchar', nullable: false, isPrimaryKey: false },
      { name: 'room_type', label: 'Room type', logicalType: 'varchar', nullable: true, isPrimaryKey: false },
      { name: 'depart', label: 'Leaving', logicalType: 'date', nullable: true, isPrimaryKey: false },
      { name: 'sold', label: 'Sold', logicalType: 'json', nullable: true, isPrimaryKey: false, semantic: 'capacity-bar' },
    ],
    total: 3,
  };

  it('draws the second line under the first column, and leaves those columns off the first', () => {
    const config = miniTableConfigSchema.parse({ title: 'Leaving today with money owing', secondary: ['room_type', 'depart'] });
    const { container } = render(<MiniTableWidget instanceId="owing" config={config} data={data} onEvent={() => undefined} />);
    const lines = [...container.querySelectorAll('[data-part="mini-table-secondary"]')];
    expect(lines).toHaveLength(3);
    expect(lines[0]!.querySelector('[data-column="room_type"]')?.textContent).toBe('Loft suite');
    expect(lines[0]!.querySelector('[data-column="depart"]')).not.toBeNull();
    // An empty value is left out of the line, not drawn as a mark.
    expect(lines[1]!.querySelector('[data-column="room_type"]')).toBeNull();
    // The first line keeps the others (up to three), never the second line's.
    const firstLine = (name: string) => [...container.querySelectorAll(`[data-column="${name}"]`)].filter((cell) => cell.closest('[data-part="mini-table-secondary"]') === null);
    expect(firstLine('room_type')).toHaveLength(0);
    expect(firstLine('depart')).toHaveLength(0);
    expect(firstLine('guest')).toHaveLength(3);
    expect(miniTableConfigSchema.safeParse({ secondary: [] }).success).toBe(false);
    expect(miniTableConfigSchema.safeParse({ secondary: ['a', 'b', 'c', 'd'] }).success).toBe(false);
  });

  it('draws sold and held of the size, names the bar by its figures, and says an over-sold row in the danger tone', () => {
    const config = miniTableConfigSchema.parse({
      title: 'Coming shows',
      columns: [
        { name: 'guest', label: 'Show' },
        { name: 'sold', label: 'Sold', logicalType: 'text', semantic: 'capacity-bar' },
      ],
    });
    const { container } = render(<MiniTableWidget instanceId="coming" config={config} data={data} onEvent={() => undefined} />);
    const bars = [...container.querySelectorAll('[data-part="cell-capacity-bar"]')];
    expect(bars).toHaveLength(2);
    expect(screen.getByRole('img', { name: '391 of 414 taken, 3 held, 23 left' })).toBeDefined();
    expect(bars[0]!.querySelector('[data-part="capacity-bar-held"]')).not.toBeNull();
    expect(bars[0]!.querySelector('[data-part="capacity-bar-ratio"]')?.textContent).toBe('391 / 414');
    // More taken than there is: full bar, danger tone, no held segment.
    expect(screen.getByRole('img', { name: '420 of 414 taken, -6 left' }).getAttribute('data-over')).toBe('true');
    expect(bars[1]!.querySelector('[data-part="capacity-bar-held"]')).toBeNull();
  });

  it("draws the bar from a limit's own counts list too (the pool's row carries its figures)", () => {
    const counts = {
      shape: 'record-list',
      rows: [{ id: '1', label: 'Standing', size: 300, taken: 7, held: 2, left: 293 }],
      columns: [
        { name: 'label', logicalType: 'varchar', nullable: true, isPrimaryKey: false },
        { name: 'left', logicalType: 'integer', nullable: true, isPrimaryKey: false, semantic: 'capacity-left' },
      ],
      total: 1,
    };
    const config = miniTableConfigSchema.parse({ columns: [{ name: 'label', label: 'Type' }, { name: 'left', label: 'Sold', semantic: 'capacity-bar' }] });
    render(<MiniTableWidget instanceId="types" config={config} data={counts} onEvent={() => undefined} />);
    expect(screen.getByRole('img', { name: '7 of 300 taken, 2 held, 293 left' })).toBeDefined();
  });
});
