/**
 * `composeTemplate` tests — 04-widget-registry.md §10 + acceptance #16:
 * "`composeTemplate('page-dashboard', …)` with zero chart candidates fails only
 * on `required` slots (surfacing a Studio warning), omits optional slots
 * cleanly".
 */
import { describe, expect, it } from 'vitest';

import {
  EMPTY_STATE_WIDGET_ID,
  composeTemplate,
  slotInstanceArea,
  templateKind,
  type ComposeWarningCode,
  type TemplateCandidate,
} from './compose.js';
import { parsePageTemplate } from './template-schema.js';

function candidate(
  widget: string,
  shape: TemplateCandidate['shape'],
  score: number,
  config: Record<string, unknown> = {},
): TemplateCandidate {
  return { widget, shape, score, config };
}

/** A representative `page-dashboard` candidate set, as the Engine's rules emit it. */
function dashboardCandidates(): TemplateCandidate[] {
  return [
    candidate('kpi-stat-card', 'metric+delta', 100, { title: 'Total Orders' }),
    candidate('kpi-stat-card', 'metric+delta', 99, { title: 'Revenue' }),
    candidate('kpi-stat-card', 'single-metric', 98, { title: 'New (30d)' }),
    candidate('kpi-stat-card', 'single-metric', 97, { title: 'Open' }),
    candidate('chart-line-area', 'timeseries', 90, { title: 'Orders over time' }),
    candidate('chart-donut', 'categorical', 80, { title: 'By status' }),
    candidate('chart-bar', 'categorical', 70, { title: 'By region' }),
    candidate('chart-heatmap-calendar', 'matrix', 60, { title: 'Activity' }),
    candidate('mini-table', 'record-list', 50, { title: 'Recent orders' }),
    candidate('activity-feed', 'record-list', 40, { title: 'Activity' }),
  ];
}

function codes(warnings: readonly { code: ComposeWarningCode }[]): ComposeWarningCode[] {
  return warnings.map((w) => w.code);
}

describe('composeTemplate — happy path', () => {
  it('fills every page-dashboard slot and lays it out per the manifest', () => {
    const { page, warnings } = composeTemplate('page-dashboard', dashboardCandidates());

    expect(page).not.toBeNull();
    expect(warnings.filter((w) => w.code === 'required-slot-unfillable')).toEqual([]);
    expect(page?.type).toBe('dashboard');
    expect(page?.template).toBe('page-dashboard');
    expect(page?.templateVersion).toBe(2);
    expect(page?.layout.version).toBe(1);

    expect(page?.layout.items.map((i) => [i.i, i.widget, i.x, i.y, i.w, i.h])).toEqual([
      ['kpi-row-1', 'kpi-stat-card', 0, 0, 3, 3],
      ['kpi-row-2', 'kpi-stat-card', 3, 0, 3, 3],
      ['kpi-row-3', 'kpi-stat-card', 6, 0, 3, 3],
      ['kpi-row-4', 'kpi-stat-card', 9, 0, 3, 3],
      ['hero-chart', 'chart-line-area', 0, 3, 8, 8],
      ['breakdown', 'chart-donut', 8, 3, 4, 8],
      ['grid-secondary-1', 'chart-bar', 0, 11, 6, 8],
      ['grid-secondary-2', 'chart-heatmap-calendar', 6, 11, 6, 8],
      ['recent', 'mini-table', 0, 19, 6, 6],
      ['activity', 'activity-feed', 6, 19, 6, 6],
    ]);
  });

  it('passes candidate config through verbatim into the layout item', () => {
    const { page } = composeTemplate('page-dashboard', dashboardCandidates());
    const hero = page?.layout.items.find((i) => i.i === 'hero-chart');
    expect(hero?.config).toEqual({ title: 'Orders over time' });
  });

  it('honours an explicit candidate instanceId, and ctx.makeInstanceId over it', () => {
    const withIds = dashboardCandidates().map((c, n) => ({ ...c, instanceId: `cand-${n}` }));
    const plain = composeTemplate('page-dashboard', withIds);
    expect(plain.page?.layout.items.map((i) => i.i)).toContain('cand-4');

    const overridden = composeTemplate('page-dashboard', withIds, {
      makeInstanceId: (slot, index) => `${slot}#${index}`,
    });
    expect(overridden.page?.layout.items.map((i) => i.i)).toContain('hero-chart#0');
  });

  it('places each candidate in at most one slot', () => {
    // `chart-donut` is accepted by `breakdown` (id allowlist) and, being
    // `categorical`, would also satisfy `grid-secondary`. Tag every candidate so
    // we can prove each lands exactly once instead of being copied into every
    // slot it happens to fit.
    const tagged = dashboardCandidates().map((c, n) => ({ ...c, config: { ...c.config, tag: n } }));
    const { page } = composeTemplate('page-dashboard', tagged);
    const tags = page?.layout.items.map((i) => i.config['tag']) ?? [];
    expect(tags).toHaveLength(10);
    expect(new Set(tags).size).toBe(tags.length);
  });
});

describe('composeTemplate — required vs optional slots (acceptance #16)', () => {
  it('with zero chart candidates fails only on required slots and omits optional ones', () => {
    const kpiOnly = dashboardCandidates().filter((c) => c.widget === 'kpi-stat-card');
    const { page, warnings } = composeTemplate('page-dashboard', kpiOnly);

    // Fails — but only because of the `required` hero-chart, never the optionals.
    expect(page).toBeNull();
    const failures = warnings.filter((w) => w.code === 'required-slot-unfillable');
    expect(failures.map((w) => w.slot)).toEqual(['hero-chart']);
    expect(failures[0]?.message).toContain('page-dashboard');

    // …and every optional slot degrades cleanly, each surfacing its own warning.
    expect(
      warnings.filter((w) => w.code === 'optional-slot-omitted').map((w) => w.slot),
    ).toEqual(['breakdown', 'grid-secondary', 'recent', 'activity', 'insights']);
  });

  it('with no candidates at all fails on both required slots', () => {
    const { page, warnings } = composeTemplate('page-dashboard', []);
    expect(page).toBeNull();
    expect(warnings.filter((w) => w.code === 'required-slot-unfillable').map((w) => w.slot)).toEqual([
      'kpi-row',
      'hero-chart',
    ]);
  });

  it('succeeds with only the required slots filled, omitting every optional slot', () => {
    const minimal = dashboardCandidates().filter(
      (c) => c.widget === 'kpi-stat-card' || c.widget === 'chart-line-area',
    );
    const { page, warnings } = composeTemplate('page-dashboard', minimal);
    expect(page).not.toBeNull();
    expect(page?.layout.items.map((i) => i.i)).toEqual([
      'kpi-row-1',
      'kpi-row-2',
      'kpi-row-3',
      'kpi-row-4',
      'hero-chart',
    ]);
    expect(codes(warnings)).not.toContain('required-slot-unfillable');
  });

  it('a partially-filled repeating required slot still succeeds', () => {
    const two = dashboardCandidates().filter(
      (c) => c.shape === 'metric+delta' || c.widget === 'chart-line-area',
    );
    const { page } = composeTemplate('page-dashboard', two);
    expect(page?.layout.items.filter((i) => i.i.startsWith('kpi-row')).length).toBe(2);
  });

  it('returns page: null with an unknown-template warning for an unregistered id', () => {
    const { page, warnings } = composeTemplate('page-nope', dashboardCandidates());
    expect(page).toBeNull();
    expect(codes(warnings)).toEqual(['unknown-template']);
  });
});

describe('composeTemplate — repeating slots take the top-N', () => {
  const template = parsePageTemplate({
    id: 'page-repeat',
    version: 3,
    titleKey: 't',
    slots: [
      {
        slot: 'row',
        accepts: { shapes: ['single-metric'] },
        area: { x: 0, y: 0, w: 3, h: 3 },
        repeat: { max: 4, flow: 'row' },
      },
    ],
  });

  it('keeps the four highest scores, in score order, and drops the rest', () => {
    const many = [10, 90, 50, 70, 30, 100].map((score) =>
      candidate(`kpi-stat-card`, 'single-metric', score, { score }),
    );
    const { page } = composeTemplate(template, many);
    expect(page?.layout.items.map((i) => i.config['score'])).toEqual([100, 90, 70, 50]);
    expect(page?.layout.items.map((i) => i.x)).toEqual([0, 3, 6, 9]);
    expect(page?.templateVersion).toBe(3);
  });

  it('breaks score ties on widget id, then on input order', () => {
    const tied: TemplateCandidate[] = [
      candidate('usage-meter', 'single-metric', 50, { n: 'u1' }),
      candidate('kpi-stat-card', 'single-metric', 50, { n: 'k1' }),
      candidate('kpi-stat-card', 'single-metric', 50, { n: 'k2' }),
    ];
    const { page } = composeTemplate(template, tied);
    expect(page?.layout.items.map((i) => i.config['n'])).toEqual(['k1', 'k2', 'u1']);
  });

  it('is deterministic: the same input composes byte-identically', () => {
    const run = (): string => JSON.stringify(composeTemplate('page-dashboard', dashboardCandidates()));
    expect(run()).toBe(run());
  });
});

describe('slotInstanceArea', () => {
  const rowSlot = parsePageTemplate({
    id: 'page-flow',
    version: 1,
    titleKey: 't',
    slots: [
      {
        slot: 'row',
        accepts: { shapes: ['single-metric'] },
        area: { x: 0, y: 0, w: 3, h: 3 },
        repeat: { max: 6, flow: 'row' },
      },
      {
        slot: 'col',
        accepts: { shapes: ['single-metric'] },
        area: { x: 0, y: 12, w: 6, h: 4 },
        repeat: { max: 3, flow: 'column' },
      },
    ],
  });

  it('tiles a row flow along x and wraps to a new band at the 12-column edge', () => {
    const slot = rowSlot.slots[0]!;
    expect([0, 1, 2, 3, 4, 5].map((n) => slotInstanceArea(slot, n))).toEqual([
      { x: 0, y: 0, w: 3, h: 3 },
      { x: 3, y: 0, w: 3, h: 3 },
      { x: 6, y: 0, w: 3, h: 3 },
      { x: 9, y: 0, w: 3, h: 3 },
      { x: 0, y: 3, w: 3, h: 3 }, // wrapped
      { x: 3, y: 3, w: 3, h: 3 },
    ]);
  });

  it('stacks a column flow along y', () => {
    const slot = rowSlot.slots[1]!;
    expect([0, 1, 2].map((n) => slotInstanceArea(slot, n).y)).toEqual([12, 16, 20]);
  });

  it('ignores index for a non-repeating slot', () => {
    const slot = parsePageTemplate({
      id: 'page-single',
      version: 1,
      titleKey: 't',
      slots: [{ slot: 'only', accepts: {}, area: { x: 2, y: 4, w: 6, h: 6 } }],
    }).slots[0]!;
    expect(slotInstanceArea(slot, 3)).toEqual({ x: 2, y: 4, w: 6, h: 6 });
  });
});

describe('composeTemplate — accepts semantics', () => {
  const template = parsePageTemplate({
    id: 'page-accepts',
    version: 1,
    titleKey: 't',
    slots: [
      { slot: 'by-shape', accepts: { shapes: ['timeseries'] }, area: { x: 0, y: 0, w: 6, h: 6 } },
      { slot: 'by-id', accepts: { widgets: ['chart-donut'] }, area: { x: 6, y: 0, w: 6, h: 6 } },
      {
        slot: 'by-either',
        accepts: { shapes: ['record'], widgets: ['org-chart'] },
        area: { x: 0, y: 6, w: 12, h: 6 },
      },
      { slot: 'by-nothing', accepts: {}, area: { x: 0, y: 12, w: 12, h: 2 } },
    ],
  });

  it('matches by data-shape contract regardless of widget id', () => {
    const { page } = composeTemplate(template, [candidate('chart-forecast', 'timeseries', 10)]);
    expect(page?.layout.items.find((i) => i.i === 'by-shape')?.widget).toBe('chart-forecast');
  });

  it('matches by explicit widget-id allowlist regardless of shape', () => {
    const { page } = composeTemplate(template, [candidate('chart-donut', 'categorical', 10)]);
    expect(page?.layout.items.find((i) => i.i === 'by-id')?.widget).toBe('chart-donut');
  });

  it('does not match a shape-compatible widget outside an id-only allowlist', () => {
    // `chart-treemap` is `categorical` like `chart-donut`, but `by-id` allow-lists ids.
    const { page, warnings } = composeTemplate(template, [candidate('chart-treemap', 'categorical', 10)]);
    expect(page?.layout.items.map((i) => i.i)).not.toContain('by-id');
    expect(warnings.filter((w) => w.slot === 'by-id').map((w) => w.code)).toEqual([
      'optional-slot-omitted',
    ]);
  });

  it('accepts on shape OR on id when a slot declares both', () => {
    const byShape = composeTemplate(template, [candidate('detail-key-value', 'record', 10)]);
    expect(byShape.page?.layout.items.find((i) => i.i === 'by-either')?.widget).toBe('detail-key-value');

    const byId = composeTemplate(template, [candidate('org-chart', 'hierarchy/tree', 10)]);
    expect(byId.page?.layout.items.find((i) => i.i === 'by-either')?.widget).toBe('org-chart');
  });

  it('never fills a slot whose accepts is empty', () => {
    const { page } = composeTemplate(template, [candidate('chart-donut', 'categorical', 10)]);
    expect(page?.layout.items.map((i) => i.i)).not.toContain('by-nothing');
  });
});

describe('composeTemplate — registry awareness', () => {
  const registered = (id: string): boolean => id !== 'x-not-installed' && id !== 'date-range-picker';

  it('drops candidates naming an unregistered widget before matching', () => {
    const cands = [
      candidate('x-not-installed', 'timeseries', 200),
      ...dashboardCandidates(),
    ];
    const { page, warnings } = composeTemplate('page-dashboard', cands, { isRegistered: registered });
    expect(page?.layout.items.find((i) => i.i === 'hero-chart')?.widget).toBe('chart-line-area');
    expect(warnings.filter((w) => w.code === 'candidate-unregistered').map((w) => w.widgetId)).toEqual([
      'x-not-installed',
    ]);
  });

  it('filters unregistered chrome ids out of toolbar/overlays', () => {
    const { page, warnings } = composeTemplate('page-dashboard', dashboardCandidates(), {
      isRegistered: registered,
    });
    // `date-range-picker` has not shipped; emitting it would render widget-missing.
    expect(page?.toolbar).toEqual([]);
    expect(page?.overlays).toEqual(['toast-stack']);
    expect(warnings.filter((w) => w.code === 'chrome-widget-unregistered').map((w) => w.widgetId)).toEqual(
      ['date-range-picker'],
    );
  });

  it('passes chrome through untouched when no registry is supplied', () => {
    const { page } = composeTemplate('page-dashboard', dashboardCandidates());
    expect(page?.toolbar).toEqual(['date-range-picker']);
    expect(page?.overlays).toEqual(['toast-stack']);
  });
});

describe('composeTemplate — empty-state fallback', () => {
  const template = parsePageTemplate({
    id: 'page-fallback',
    version: 1,
    titleKey: 't',
    slots: [
      {
        slot: 'holds-space',
        accepts: { widgets: ['mini-table'] },
        area: { x: 0, y: 0, w: 6, h: 6 },
        fallback: 'empty-state',
      },
    ],
  });

  it('places the empty-state widget when the slot cannot fill', () => {
    const { page } = composeTemplate(template, []);
    expect(page?.layout.items).toEqual([
      { i: 'holds-space', widget: EMPTY_STATE_WIDGET_ID, x: 0, y: 0, w: 6, h: 6, config: {} },
    ]);
  });

  it('omits instead — with a warning — while empty-state is unregistered', () => {
    const { page, warnings } = composeTemplate(template, [], { isRegistered: () => false });
    expect(page?.layout.items).toEqual([]);
    expect(codes(warnings)).toContain('empty-state-unavailable');
  });

  it('does not fall back when the slot fills normally', () => {
    const { page } = composeTemplate(template, [candidate('mini-table', 'record-list', 5)]);
    expect(page?.layout.items[0]?.widget).toBe('mini-table');
  });
});

describe('composeTemplate — layout validation', () => {
  it('rejects a manifest whose geometry cannot produce a valid pageLayout', () => {
    const broken = parsePageTemplate({
      id: 'page-broken',
      version: 1,
      titleKey: 't',
      slots: [{ slot: 'wide', accepts: { shapes: ['record-list'] }, area: { x: 0, y: 0, w: 13, h: 6 } }],
    });
    const { page, warnings } = composeTemplate(broken, [candidate('data-grid', 'record-list', 1)]);
    expect(page).toBeNull();
    expect(codes(warnings)).toEqual(['invalid-layout']);
  });
});

describe('templateKind', () => {
  it('maps grid-composed dashboards to kind dashboard, everything else to page (09 §3.2)', () => {
    expect(templateKind('page-dashboard')).toBe('dashboard');
    expect(templateKind('page-hub-home')).toBe('dashboard');
    expect(templateKind('page-crud')).toBe('page');
    expect(templateKind('page-chat')).toBe('page');
  });
});
