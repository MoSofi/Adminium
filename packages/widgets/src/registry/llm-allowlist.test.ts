// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import {
  LLM_ALLOWED_PAGE_TEMPLATES,
  LLM_ALLOWED_SEMANTICS,
  LLM_ALLOWED_TEMPLATES,
  LLM_ALLOWED_WIDGETS,
} from './llm-allowlist.js';
import { isCompilableShape } from '../page-config/index.js';
import { ARCHETYPE_TEMPLATE_IDS } from './archetypes.js';
import { widgetRegistry, widgetsByFamily } from './index.js';
import { pageTemplateRegistry } from './page-templates.js';
import { widgetSharedConfigSchema } from './shared-config.js';
import { WIDGET_MISSING_ID } from './widget-missing.js';

const isSortedUnique = (ids: readonly string[]): boolean =>
  ids.every((id, i) => i === 0 || ids[i - 1]!.localeCompare(id, 'en') < 0);

describe('LLM_ALLOWED_PAGE_TEMPLATES', () => {
  it('is exactly the recommendable templates the runtime ships today', () => {
    expect(LLM_ALLOWED_PAGE_TEMPLATES).toEqual([
      'page-board',
      'page-calendar',
      'page-chat',
      'page-dashboard',
      'page-directory',
      'page-files',
      'page-log-viewer',
      'page-master-detail',
      'page-queue-inbox',
      'page-scheduler',
    ]);
  });

  it('never lists a template the registry cannot render (regression guard)', () => {
    for (const id of LLM_ALLOWED_PAGE_TEMPLATES) {
      expect(pageTemplateRegistry.has(id)).toBe(true);
    }
  });

  it('is exactly the recommendable subset of the registry — the set grows with it', () => {
    const recommendable = [...pageTemplateRegistry.values()]
      .filter((t) => t.recommendable)
      .map((t) => t.id);
    expect([...LLM_ALLOWED_PAGE_TEMPLATES].sort()).toEqual(recommendable.sort());
  });

  it('never lists a non-recommendable template (06 §5 decision 6 + the tool surfaces)', () => {
    for (const id of ['page-crud', 'page-builder', 'page-wizard', 'page-settings']) {
      expect(pageTemplateRegistry.has(id), `${id} must stay renderable`).toBe(true);
      expect(LLM_ALLOWED_PAGE_TEMPLATES).not.toContain(id);
    }
  });

  it('admits every template a §14 archetype rule can emit (emitter ⊆ vocabulary)', () => {
    for (const id of ARCHETYPE_TEMPLATE_IDS) {
      expect(LLM_ALLOWED_PAGE_TEMPLATES).toContain(id);
    }
  });

  it('LLM_ALLOWED_TEMPLATES aliases the same list (06 §5 builder-note spelling)', () => {
    expect(LLM_ALLOWED_TEMPLATES).toEqual(LLM_ALLOWED_PAGE_TEMPLATES);
  });

  it('is sorted and duplicate-free', () => {
    expect(isSortedUnique(LLM_ALLOWED_PAGE_TEMPLATES)).toBe(true);
  });
});

describe('LLM_ALLOWED_WIDGETS', () => {
  it('never lists a widget the registry cannot render (regression guard)', () => {
    for (const id of LLM_ALLOWED_WIDGETS) {
      expect(widgetRegistry.has(id)).toBe(true);
    }
  });

  it('is the curated dashboard subset shipping today (06 §5 builder notes)', () => {
    // Derived, not hand-maintained: whole kpi/charts/feeds families (minus the
    // data-editing notification-feed and toast-stack) plus the read-only
    // record-list table tiles.
    // Grows as M7 registers widgets — see the ratchet at `includes every widget…`.
    // M7 Wave 4 completed kpi (§1) and feeds (§4): the eight new kpi ids and
    // load-older-paginator qualify; `toast-stack` does not — its Undo emits a
    // mutate intent (`editsData`), and a generated dashboard is read-only
    // analytics.
    // Wave 4's tables TAIL adds four read-only record-list summary tiles
    // (sparkline-table, top-movers-list, ranked-entity-list, accordion-list).
    // Its other two ids stay out by derivation, not by exclusion:
    // `comparison-matrix` and `chip-cloud` declare non-`record-list` contracts,
    // so `isLlmDashboardWidget`'s tables clause never admits them.
    // The `geo` family Wave 4 opened is not an allow-listed dashboard family
    // either — maps are not in LLM_DASHBOARD_WIDGET_FAMILIES.
    //
    // 43 → 55: teaching the widget-data compiler `multi-timeseries`, `matrix`,
    // `distribution` and `calendar-events` admitted TWELVE charts that were
    // registered-but-unsuggestable, because `isBindable` reads the same
    // `COMPILABLE_DATA_SHAPES` the compiler validates against. They are listed
    // here by shape so the next compiler change lands in the obvious place:
    //   multi-timeseries → chart-multiline, chart-stream, chart-bump
    //   matrix           → chart-marimekko, chart-radar, chart-hexbin,
    //                      chart-correlation-matrix, chart-cohort-matrix
    //   distribution     → chart-boxplot, chart-violin, chart-ridgeline
    //   calendar-events  → chart-timeline-lanes
    // This is a real widening of what the model may PROPOSE, not a fixture
    // refresh: each of the four shapes now has a descriptor form the compiler
    // accepts and a shaper that emits the payload (bucket + one groupBy; two
    // groupBy + an aggregation; `select: [valueColumn]` with compiler-derived
    // quantiles; positional `select: [date, title, category?, end?]`).
    //
    // 55 → 60: the last five compiler gaps closed the same way.
    //   hierarchy/tree  → chart-sunburst
    //   flows           → chart-sankey, chart-chord
    //   geo-points      → chart-choropleth-grid
    //   ohlc            → chart-candlestick
    // `boolean-map` compiled too but strands nothing here — its two widgets
    // (toggle-switch-list, typing-indicator) are in families the dashboard
    // vocabulary does not draw from. Likewise `map-bubble` and
    // `map-choropleth-grid`: bindable now, but `geo` is not an LLM dashboard
    // family, and `schema-tree`/`org-chart` fail the tables/domain clauses.
    expect(LLM_ALLOWED_WIDGETS).toEqual([
      'accordion-list',
      'activity-feed',
      'auto-insights',
      'card-gallery',
      'chart-anomaly',
      'chart-bar',
      'chart-boxplot',
      'chart-bullet',
      'chart-bump',
      'chart-candlestick',
      'chart-chord',
      'chart-choropleth-grid',
      'chart-cohort-matrix',
      'chart-correlation-matrix',
      'chart-donut',
      'chart-forecast',
      'chart-funnel',
      'chart-heat-month',
      'chart-heatmap-calendar',
      'chart-hexbin',
      'chart-line-area',
      'chart-marimekko',
      'chart-multiline',
      'chart-parallel-coordinates',
      'chart-pareto',
      'chart-radar',
      'chart-radial-bar',
      'chart-ranking-bars',
      'chart-ridgeline',
      'chart-sankey',
      'chart-scatter-bubble',
      'chart-slope',
      'chart-sparkline',
      'chart-stacked-bar-100',
      'chart-stream',
      'chart-sunburst',
      'chart-timeline-lanes',
      'chart-treemap',
      'chart-violin',
      'chart-waterfall',
      'chart-wordcloud',
      'gauge-arc',
      'gauge-ring',
      'grouped-summary-table',
      'kpi-stat-card',
      'kpi-stat-tile-compact',
      'load-older-paginator',
      'log-table',
      'metric-hero',
      'micro-kpi-subtitle',
      'mini-table',
      'period-comparison',
      'ranked-entity-list',
      'realtime-feed',
      'sparkline-table',
      'stat-pair-card',
      'timeline-vertical',
      'top-movers-list',
      'unread-badge',
      'usage-meter',
    ]);
  });

  it('includes every BINDABLE widget in the KPI and charts families (derivation, not a hand list)', () => {
    for (const family of ['kpi', 'charts'] as const) {
      for (const definition of widgetsByFamily(family)) {
        const shapes = Array.isArray(definition.dataContract)
          ? definition.dataContract
          : [definition.dataContract];
        // Family membership is necessary but no longer sufficient: a widget the
        // widget-data compiler cannot feed is not suggestable, or the model
        // would place a tile guaranteed to fail at render time.
        expect(LLM_ALLOWED_WIDGETS.includes(definition.id)).toBe(shapes.some(isCompilableShape));
      }
    }
  });

  it('offers only widgets some query descriptor can actually satisfy', () => {
    // The regression this encodes: charts were suggestable while the compiler
    // could produce none of their shapes, so the model could place a tile
    // GUARANTEED to render "Unexpected data shape" or 422 (04 §5.2).
    for (const id of LLM_ALLOWED_WIDGETS) {
      const contract = widgetRegistry.get(id)?.dataContract;
      const shapes = Array.isArray(contract) ? contract : [contract];
      expect(shapes.some((s) => s !== undefined && isCompilableShape(s))).toBe(true);
    }
    // The shapes still outside the compiler, named so the boundary is
    // auditable rather than implied. Both are now `static` and `form-state`,
    // and NEITHER is a compiler gap to close later: `static` is config-only
    // with no server round trip, and `form-state` is fed by the CRUD form path
    // (04 §3). This list reaching zero would mean the boundary moved somewhere
    // it cannot go.
    for (const shape of ['static', 'form-state'] as const) {
      expect(isCompilableShape(shape), `${shape} became compilable — revisit this guard`).toBe(false);
    }
    // The five widgets the last compiler gap stranded. They are ALLOW-LISTED
    // now — this loop is the mirror image of the one that used to assert they
    // were not, kept so a regression in either direction is loud. Ports of the
    // same move: `chart-multiline`, `chart-cohort-matrix` and `chart-violin`
    // crossed over when multi-timeseries/matrix/distribution landed.
    for (const [id, shape] of [
      ['chart-sankey', 'flows'],
      ['chart-chord', 'flows'],
      ['chart-sunburst', 'hierarchy/tree'],
      ['chart-choropleth-grid', 'geo-points'],
      ['chart-candlestick', 'ohlc'],
    ] as const) {
      expect(widgetRegistry.has(id), `${id} must stay renderable`).toBe(true);
      expect(isCompilableShape(shape), `${shape} must stay compilable`).toBe(true);
      expect(LLM_ALLOWED_WIDGETS).toContain(id);
    }
  });

  it('excludes the page-CRUD building blocks, inline chrome and the system fallback', () => {
    for (const id of [
      'data-grid', // interactive CRUD grid (editsData)
      'pagination-footer', // inline chrome
      'bulk-action-toolbar', // inline chrome (editsData)
      'detail-key-value', // single-record detail, not a dashboard tile
      WIDGET_MISSING_ID, // unknown-widget fallback
    ]) {
      expect(LLM_ALLOWED_WIDGETS).not.toContain(id);
    }
  });

  it('never lists a data-editing widget', () => {
    for (const id of LLM_ALLOWED_WIDGETS) {
      expect(widgetRegistry.get(id)?.capabilities?.editsData).not.toBe(true);
    }
  });

  it('is sorted and duplicate-free', () => {
    expect(isSortedUnique(LLM_ALLOWED_WIDGETS)).toBe(true);
  });
});

describe('LLM_ALLOWED_SEMANTICS', () => {
  const runtimeTones = widgetSharedConfigSchema.shape.tone.unwrap().options;

  it('is the enum-tone vocabulary of the response contract (06 §5 decision 3 / §6 Tone)', () => {
    expect([...LLM_ALLOWED_SEMANTICS].sort()).toEqual(['accent', 'danger', 'muted', 'pos', 'warn']);
  });

  it('only allows tones the widgets runtime can render (regression guard)', () => {
    for (const tone of LLM_ALLOWED_SEMANTICS) {
      expect(runtimeTones).toContain(tone);
    }
  });

  it('is duplicate-free', () => {
    expect(new Set(LLM_ALLOWED_SEMANTICS).size).toBe(LLM_ALLOWED_SEMANTICS.length);
  });
});
