// SPDX-License-Identifier: AGPL-3.0-only
/**
 * planningData unit tests — the pure extraction/normalization layer the
 * planning archetype bindings run before their widget-data batch:
 * kind-'page' envelopes extract, unsupported shapes rewrite to record-list,
 * invalid bindings surface per-instance, and the dateRange window filters
 * land only on the targeted primary item.
 */
import { describe, expect, it } from 'vitest';
import type { PageEnvelope } from '@adminium/engine/config';

import {
  extractPlanningBindings,
  normalizeDescriptorShape,
  planningWindowTargetOf,
  withDateWindow,
} from './planningData.js';

const CONN = 'conn_1';

function descriptor(shape: string, extra: Record<string, unknown> = {}) {
  return {
    kind: 'table-query',
    connectionId: CONN,
    source: { schema: 'public', name: 'releases', type: 'table' },
    shape,
    limit: 500,
    ...extra,
  };
}

function envelope(items: Record<string, unknown>[]): PageEnvelope {
  return {
    v: 1,
    kind: 'page',
    id: 'page_test',
    template: 'page-calendar',
    title: 'Releases',
    source: { connectionId: CONN, table: 'public.releases' },
    nav: { slug: 'releases', group: 'planning', order: 10 },
    access: {},
    config: {
      templateVersion: 1,
      toolbar: [],
      overlays: [],
      layout: { version: 1, items },
    },
  } as unknown as PageEnvelope;
}

describe('extractPlanningBindings', () => {
  it('extracts descriptors from a kind-page envelope, rewriting calendar-events to record-list', () => {
    const page = envelope([
      {
        i: 'cal-1',
        widget: 'calendar-month',
        x: 0,
        y: 0,
        w: 8,
        h: 12,
        config: { startColumn: 'released_at', binding: descriptor('calendar-events') },
      },
      {
        i: 'kpi-1',
        widget: 'kpi-stat-card',
        x: 0,
        y: 0,
        w: 3,
        h: 3,
        config: { binding: descriptor('metric+delta', { aggregations: [{ fn: 'count', alias: 'n' }] }) },
      },
      { i: 'unbound', widget: 'day-agenda', x: 8, y: 0, w: 4, h: 12, config: {} },
    ]);
    const { requests, invalid } = extractPlanningBindings(page);
    expect(invalid.size).toBe(0);
    expect(requests.map((request) => request.instanceId)).toEqual(['cal-1', 'kpi-1']);
    expect(requests[0]?.descriptor.shape).toBe('record-list'); // rewritten
    expect(requests[1]?.descriptor.shape).toBe('metric+delta'); // supported, untouched
  });

  it('collects invalid bindings per instance instead of throwing', () => {
    const page = envelope([
      { i: 'bad-1', widget: 'calendar-month', x: 0, y: 0, w: 8, h: 12, config: { binding: { nope: true } } },
    ]);
    const { requests, invalid } = extractPlanningBindings(page);
    expect(requests).toHaveLength(0);
    expect(invalid.has('bad-1')).toBe(true);
  });

  it('returns nothing for a corrupt layout (the template shows its invalid card)', () => {
    const page = { ...envelope([]), config: { layout: 'nope' } } as unknown as PageEnvelope;
    const { requests, invalid } = extractPlanningBindings(page);
    expect(requests).toHaveLength(0);
    expect(invalid.size).toBe(0);
  });
});

describe('normalizeDescriptorShape', () => {
  it('leaves compiler-supported shapes untouched', () => {
    const d = descriptor('record-list') as Parameters<typeof normalizeDescriptorShape>[0];
    expect(normalizeDescriptorShape(d)).toBe(d);
  });
});

describe('date windowing', () => {
  const page = envelope([
    {
      i: 'sched-1',
      widget: 'schedule-matrix',
      x: 0,
      y: 0,
      w: 12,
      h: 14,
      config: {
        personColumn: 'employee_id',
        dateColumn: 'shift_date',
        typeColumn: 'shift_type',
        binding: descriptor('record-list'),
      },
    },
    {
      i: 'kpi-1',
      widget: 'kpi-stat-card',
      x: 0,
      y: 0,
      w: 3,
      h: 3,
      config: { binding: descriptor('metric+delta', { aggregations: [{ fn: 'count', alias: 'n' }] }) },
    },
  ]);

  it('finds the primary item and its stored date column', () => {
    expect(planningWindowTargetOf(page, ['schedule-matrix'], ['dateColumn'])).toEqual({
      instanceId: 'sched-1',
      column: 'shift_date',
    });
    expect(planningWindowTargetOf(page, ['calendar-month'])).toBeNull();
  });

  it('appends late-bound dateRange filters to the target only, idempotently', () => {
    const { requests } = extractPlanningBindings(page);
    const target = { instanceId: 'sched-1', column: 'shift_date' };
    const windowed = withDateWindow(requests, target);
    const scheduled = windowed.find((request) => request.instanceId === 'sched-1');
    expect(scheduled?.descriptor.filters).toEqual([
      { column: 'shift_date', op: 'gte', param: 'dateRange.start' },
      { column: 'shift_date', op: 'lte', param: 'dateRange.end' },
    ]);
    // KPI aggregate untouched.
    expect(windowed.find((request) => request.instanceId === 'kpi-1')?.descriptor.filters).toBeUndefined();
    // Idempotent on a second pass.
    expect(withDateWindow(windowed, target).find((r) => r.instanceId === 'sched-1')?.descriptor.filters).toHaveLength(2);
  });
});
