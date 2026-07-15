import { describe, expect, it } from 'vitest';

import {
  LLM_ALLOWED_PAGE_TEMPLATES,
  LLM_ALLOWED_SEMANTICS,
  LLM_ALLOWED_TEMPLATES,
  LLM_ALLOWED_WIDGETS,
} from './llm-allowlist.js';
import { widgetRegistry, widgetsByFamily } from './index.js';
import { pageTemplateRegistry } from './page-templates.js';
import { widgetSharedConfigSchema } from './shared-config.js';
import { WIDGET_MISSING_ID } from './widget-missing.js';

const isSortedUnique = (ids: readonly string[]): boolean =>
  ids.every((id, i) => i === 0 || ids[i - 1]!.localeCompare(id, 'en') < 0);

describe('LLM_ALLOWED_PAGE_TEMPLATES', () => {
  it('is exactly the templates the runtime ships today', () => {
    expect(LLM_ALLOWED_PAGE_TEMPLATES).toEqual(['page-crud', 'page-dashboard']);
  });

  it('never lists a template the registry cannot render (regression guard)', () => {
    for (const id of LLM_ALLOWED_PAGE_TEMPLATES) {
      expect(pageTemplateRegistry.has(id)).toBe(true);
    }
  });

  it('covers every registered page template — the set grows with the registry', () => {
    expect([...LLM_ALLOWED_PAGE_TEMPLATES].sort()).toEqual([...pageTemplateRegistry.keys()].sort());
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
    // data-editing notification-feed) plus the read-only record-list table tiles.
    // Grows as M7 registers widgets — see the ratchet at `includes every widget…`.
    expect(LLM_ALLOWED_WIDGETS).toEqual([
      'activity-feed',
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
      'grouped-summary-table',
      'kpi-stat-card',
      'log-table',
      'mini-table',
      'realtime-feed',
      'timeline-vertical',
      'unread-badge',
      'usage-meter',
    ]);
  });

  it('includes every widget in the KPI and charts families (derivation, not a hand list)', () => {
    for (const family of ['kpi', 'charts'] as const) {
      for (const definition of widgetsByFamily(family)) {
        expect(LLM_ALLOWED_WIDGETS).toContain(definition.id);
      }
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
