/**
 * Track E geometry tests (matrix, calendar & geo-grid): determinism (same
 * input → identical output, incl. golden path strings computed in Node with no
 * DOM — acceptance #10/#11), the RTL policy per chart (04 §7.4), and empty /
 * triangular-gap handling.
 */
import { describe, expect, it } from 'vitest';

import { cohortLayout } from './cohort.js';
import { heatCalendarLayout } from './heatCalendar.js';
import { heatMonthLayout } from './heatMonth.js';
import { US_TILEGRAM, choroplethLayout } from './choropleth.js';
import { sankeyLayout, sankeyRibbonPath } from './sankey.js';
import { heatLevel, rampColorVar, rampIndex } from './heat.js';

describe('heat helpers', () => {
  it('maps values onto discrete levels and the accent ramp, empty at zero', () => {
    expect(heatLevel(0, 100, 5)).toBe(0);
    expect(heatLevel(100, 100, 5)).toBe(4);
    expect(heatLevel(1, 100, 5)).toBe(1);
    expect(rampColorVar(0, 5)).toBe('var(--surface-2)');
    expect(rampColorVar(4, 5)).toBe('var(--viz-ramp-6)');
    expect(rampIndex(2, 7)).toBe(2);
    // Never emits a raw color literal.
    for (let level = 0; level < 5; level += 1) {
      expect(rampColorVar(level, 5)).toMatch(/^var\(--/);
    }
  });
});

describe('cohortLayout', () => {
  const rowKeys = ['Jan', 'Feb'];
  const colKeys = ['M0', 'M1'];
  const cells = [
    [100, 50],
    [80, null],
  ];

  it('places cells on a grid, tints by value, and leaves nulls transparent', () => {
    const layout = cohortLayout(rowKeys, colKeys, cells);
    // step = cellSize(40)+gap(3)=43; LTR gutter 72.
    const first = layout.cells.find((c) => c.row === 0 && c.col === 0);
    expect(first).toMatchObject({ x: 72, y: 20, size: 40, value: 100, textLight: true });
    expect(first?.colorVar).toBe('var(--viz-ramp-6)');
    const gap = layout.cells.find((c) => c.row === 1 && c.col === 1);
    expect(gap).toMatchObject({ value: null, level: -1, colorVar: 'none', textLight: false });
  });

  it('mirrors period columns in RTL, cohort labels move to the inline-start', () => {
    const ltr = cohortLayout(rowKeys, colKeys, cells, { rtl: false });
    const rtl = cohortLayout(rowKeys, colKeys, cells, { rtl: true });
    const colX = (l: typeof ltr, col: number) => l.colLabels.find((c) => c.index === col)?.pos ?? 0;
    expect(colX(ltr, 0)).toBeLessThan(colX(ltr, 1));
    expect(colX(rtl, 0)).toBeGreaterThan(colX(rtl, 1));
    expect(ltr.rowLabelAnchor).toBe('end');
    expect(rtl.rowLabelAnchor).toBe('start');
  });

  it('is deterministic (byte-identical serialization across runs)', () => {
    expect(JSON.stringify(cohortLayout(rowKeys, colKeys, cells))).toBe(
      JSON.stringify(cohortLayout(rowKeys, colKeys, cells)),
    );
  });
});

describe('heatCalendarLayout', () => {
  const points = [
    { t: '2026-06-01', v: 3 },
    { t: '2026-06-15', v: 9 },
    { t: '2026-06-30', v: 1 },
  ];

  it('builds a week×day grid, omits future cells past the last point', () => {
    const layout = heatCalendarLayout(points, { weeks: 6, startWeekday: 0 });
    expect(layout.days.length).toBeGreaterThan(0);
    expect(layout.days.length).toBeLessThanOrEqual(6 * 7);
    // No cell dated after the latest point.
    const last = layout.days.reduce((m, d) => (d.date.getTime() > m ? d.date.getTime() : m), 0);
    expect(last).toBe(new Date('2026-06-30T00:00:00.000Z').getTime());
    expect(layout.maxValue).toBe(9);
  });

  it('runs week columns right→left in RTL (04 §7.4)', () => {
    const ltr = heatCalendarLayout(points, { weeks: 6, rtl: false });
    const rtl = heatCalendarLayout(points, { weeks: 6, rtl: true });
    const xOfWeek0 = (l: typeof ltr) => l.days.find((d) => d.weekIndex === 0)?.x ?? 0;
    expect(xOfWeek0(rtl)).toBeGreaterThan(xOfWeek0(ltr));
  });

  it('is deterministic', () => {
    expect(JSON.stringify(heatCalendarLayout(points, { weeks: 10 }))).toBe(
      JSON.stringify(heatCalendarLayout(points, { weeks: 10 })),
    );
  });
});

describe('heatMonthLayout', () => {
  const points = [
    { t: '2026-06-04', v: 5 },
    { t: '2026-06-20', v: 12 },
  ];

  it('lays out a month grid with padding nulls and 30 in-month days for June', () => {
    const layout = heatMonthLayout(2026, 5, points, { startWeekday: 0 });
    const inMonth = layout.cells.filter((c) => c.day !== null);
    expect(inMonth).toHaveLength(30);
    expect(layout.cells.some((c) => c.day === null)).toBe(true);
    expect(layout.maxValue).toBe(12);
    expect(layout.cells).toHaveLength(layout.rows * 7);
  });

  it('mirrors day-of-week columns in RTL', () => {
    const ltr = heatMonthLayout(2026, 5, points, { rtl: false });
    const rtl = heatMonthLayout(2026, 5, points, { rtl: true });
    const headerX = (l: typeof ltr, col: number) => l.headerCols.find((h) => h.col === col)?.x ?? 0;
    expect(headerX(rtl, 0)).toBeGreaterThan(headerX(ltr, 0));
  });
});

describe('choroplethLayout', () => {
  const points = [
    { code: 'CA', name: 'California', values: { sales: 100 } },
    { code: 'NY', name: 'New York', values: { sales: 50 } },
    { code: 'TX', name: 'Texas', values: { sales: 20 } },
  ];

  it('covers all 50 states + DC in the tilegram', () => {
    expect(Object.keys(US_TILEGRAM)).toHaveLength(51);
  });

  it('positions tilegram tiles by state code and tints by metric', () => {
    const layout = choroplethLayout(points, { metric: 'sales', layout: 'us-tilegram' });
    const ca = layout.tiles.find((t) => t.code === 'CA');
    // CA at [row 4, col 0]; step = 34+4 = 38.
    expect(ca).toMatchObject({ row: 4, col: 0, x: 0, y: 152, value: 100, textLight: true });
    expect(ca?.colorVar).toBe('var(--viz-ramp-6)');
  });

  it('tilegram is a geographic LTR island — tiles do not mirror', () => {
    const ltr = choroplethLayout(points, { metric: 'sales', layout: 'us-tilegram', rtl: false });
    const rtl = choroplethLayout(points, { metric: 'sales', layout: 'us-tilegram', rtl: true });
    const caX = (l: typeof ltr) => l.tiles.find((t) => t.code === 'CA')?.x ?? -1;
    expect(caX(rtl)).toBe(caX(ltr));
  });

  it('grid layout mirrors columns in RTL', () => {
    const grid = { metric: 'sales', layout: 'grid' as const, columns: 2 };
    const ltr = choroplethLayout(points, { ...grid, rtl: false });
    const rtl = choroplethLayout(points, { ...grid, rtl: true });
    expect(rtl.tiles[0]?.x).toBeGreaterThan(ltr.tiles[0]?.x ?? 0);
  });
});

describe('sankey geometry', () => {
  it('produces the exact ribbon path in Node (golden string)', () => {
    expect(sankeyRibbonPath(10, 30, 0, 5, 0, 5)).toBe('M10,0C20,0 20,0 30,0L30,5C20,5 20,5 10,5Z');
  });

  const nodes = [
    { id: 'visit', label: 'Visited' },
    { id: 'signup', label: 'Signed up' },
    { id: 'paid', label: 'Paid' },
    { id: 'churn', label: 'Churned' },
  ];
  const links = [
    { from: 'visit', to: 'signup', weight: 60 },
    { from: 'visit', to: 'churn', weight: 40 },
    { from: 'signup', to: 'paid', weight: 45 },
    { from: 'signup', to: 'churn', weight: 15 },
  ];

  it('assigns layers by longest path and stacks nodes left→right', () => {
    const layout = sankeyLayout(nodes, links, { width: 600, height: 300 });
    expect(layout.layers).toBe(3);
    const byId = (id: string) => layout.nodes.find((n) => n.id === id);
    expect(byId('visit')?.layer).toBe(0);
    expect(byId('signup')?.layer).toBe(1);
    expect(byId('paid')?.layer).toBe(2);
    expect(byId('churn')?.layer).toBe(2);
    expect((byId('visit')?.x ?? 0)).toBeLessThan(byId('paid')?.x ?? 0);
    for (const link of layout.links) expect(link.path).toMatch(/^M.*Z$/);
  });

  it('drops zero/self links and is deterministic', () => {
    const dirty = [...links, { from: 'paid', to: 'paid', weight: 5 }, { from: 'visit', to: 'signup', weight: 0 }];
    const a = sankeyLayout(nodes, dirty);
    const b = sankeyLayout(nodes, dirty);
    expect(a.links).toHaveLength(4);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
