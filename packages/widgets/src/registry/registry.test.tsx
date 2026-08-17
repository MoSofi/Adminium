// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { makeTestDefinition } from '../test/fixtures.js';
import {
  DuplicateWidgetIdError,
  WidgetNotFoundError,
  assertWidget,
  buildRegistry,
  getWidget,
  validateInstanceConfig,
  widgetRegistry,
  widgetsByFamily,
} from './index.js';
import { isEmptyData } from './data-empty.js';
import { WIDGET_MISSING_ID, widgetMissingDefinition } from './widget-missing.js';

describe('buildRegistry', () => {
  it('throws DuplicateWidgetIdError at init on duplicate ids (04 §2.2)', () => {
    const a = makeTestDefinition({ id: 'dup-widget' });
    const b = makeTestDefinition({ id: 'dup-widget', family: 'system' });
    expect(() => buildRegistry([a, b])).toThrowError(DuplicateWidgetIdError);
    expect(() => buildRegistry([a, b])).toThrowError(/dup-widget/);
  });

  it('registers each definition exactly once, keyed by id', () => {
    const def = makeTestDefinition();
    const map = buildRegistry([def]);
    expect(map.get('test-stat-card')).toBe(def);
    expect(map.size).toBe(1);
  });
});

describe('widgetRegistry (global)', () => {
  it('always contains the widget-missing fallback definition', () => {
    expect(widgetRegistry.get(WIDGET_MISSING_ID)).toBe(widgetMissingDefinition);
    expect(widgetMissingDefinition.family).toBe('system');
  });

  it('getWidget returns undefined for unknown ids; assertWidget throws', () => {
    expect(getWidget('x-uninstalled-widget')).toBeUndefined();
    expect(() => assertWidget('x-uninstalled-widget')).toThrowError(WidgetNotFoundError);
    expect(assertWidget(WIDGET_MISSING_ID)).toBe(widgetMissingDefinition);
  });

  it('widgetsByFamily filters by family', () => {
    expect(widgetsByFamily('system').map((d) => d.id)).toContain(WIDGET_MISSING_ID);
    // `geo` was this assertion's empty-family case until M7 Wave 4 opened the
    // family (annex §7). It is no longer empty, so the case it stood for — a
    // filter that returns only its own family and nothing else — is asserted
    // directly instead of via emptiness, which would now just be wrong.
    expect(widgetsByFamily('geo').map((d) => d.id)).toEqual(['map-bubble', 'map-choropleth-grid']);
    expect(widgetsByFamily('geo').every((d) => d.family === 'geo')).toBe(true);
  });
});

describe('validateInstanceConfig', () => {
  it('passes a valid config through', () => {
    const parsed = validateInstanceConfig(WIDGET_MISSING_ID, {
      title: 'Orders',
      missingId: 'x-gone',
    });
    expect(parsed.warnings).toEqual([]);
    expect(parsed.config.title).toBe('Orders');
    expect(parsed.config.missingId).toBe('x-gone');
  });

  it('drops invalid fields per-field with structured warnings, never throws (04 §2.2)', () => {
    const parsed = validateInstanceConfig(WIDGET_MISSING_ID, {
      title: 'Kept',
      refreshInterval: 2, // below min(5) → dropped
      tone: 'sparkly', // not in enum → dropped
    });
    expect(parsed.config.title).toBe('Kept');
    expect(parsed.config).not.toHaveProperty('refreshInterval');
    expect(parsed.config).not.toHaveProperty('tone');
    const paths = parsed.warnings.map((w) => w.path);
    expect(paths).toContain('refreshInterval');
    expect(paths).toContain('tone');
    for (const warning of parsed.warnings) {
      expect(warning.widgetId).toBe(WIDGET_MISSING_ID);
      expect(warning.message.length).toBeGreaterThan(0);
    }
  });

  it('falls back to schema defaults on non-object configs', () => {
    const parsed = validateInstanceConfig(WIDGET_MISSING_ID, 'not-an-object');
    expect(parsed.warnings.some((w) => w.code === 'config-not-object')).toBe(true);
    expect(typeof parsed.config).toBe('object');
  });

  it('flags unknown widget ids and validates against the fallback schema', () => {
    const parsed = validateInstanceConfig('x-uninstalled-widget', { title: 'Ghost' });
    expect(parsed.warnings.some((w) => w.code === 'unknown-widget')).toBe(true);
    expect(parsed.config.title).toBe('Ghost');
  });

  it('applies schema field defaults (per-field fallback)', () => {
    const def = makeTestDefinition({ id: 'defaults-widget' });
    const map = buildRegistry([def]);
    const result = def.configSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as { metricLabel: string }).metricLabel).toBe('Total');
    }
    expect(map.size).toBe(1);
  });
});

describe('isEmptyData', () => {
  it('null/undefined is always empty', () => {
    expect(isEmptyData(null, 'timeseries')).toBe(true);
    expect(isEmptyData(undefined, ['record-list', 'record'])).toBe(true);
  });

  it('record-list empty ⇔ total === 0 && no cursor (04 §3)', () => {
    expect(isEmptyData({ rows: [], columns: [], total: 0 }, 'record-list')).toBe(true);
    expect(isEmptyData({ rows: [], columns: [], total: 0, cursor: 'abc' }, 'record-list')).toBe(false);
    expect(isEmptyData({ rows: [{ id: 1 }], columns: [], total: 1 }, 'record-list')).toBe(false);
  });

  it('timeseries empty ⇔ points.length === 0; metrics are never empty', () => {
    expect(isEmptyData({ points: [] }, 'timeseries')).toBe(true);
    expect(isEmptyData({ points: [{ t: '2026-01-01', v: 1 }] }, 'timeseries')).toBe(false);
    expect(isEmptyData({ value: 0 }, 'single-metric')).toBe(false);
    expect(isEmptyData({ value: 0 }, 'metric+delta')).toBe(false);
  });

  it('multi-shape contracts are empty only when every accepted shape reads empty', () => {
    expect(isEmptyData({ points: [] }, ['timeseries', 'single-metric'])).toBe(false);
    expect(isEmptyData({ points: [] }, ['timeseries', 'categorical'])).toBe(true);
  });
});
