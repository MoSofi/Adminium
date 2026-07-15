/**
 * Builder placement helpers (04-T14): first-fit placement, insert/duplicate/
 * remove with top-gravity compaction, config edit, and locked-path extraction.
 */
import { describe, expect, it } from 'vitest';
import { getWidget } from '@adminium/widgets';
import type { LayoutItem, PageLayout } from '@adminium/widgets/page-config';

import {
  duplicateItem,
  insertWidget,
  lockedPathsOf,
  removeItem,
  updateItemConfig,
} from './placement.js';

const item = (i: string, x: number, y: number, w: number, h: number): LayoutItem => ({
  i,
  widget: 'kpi-stat-card',
  x,
  y,
  w,
  h,
  config: {},
});

const layout = (items: LayoutItem[]): PageLayout => ({ version: 1, items });

describe('insertWidget', () => {
  it('adds the widget at first-fit with schema-default config and a fresh id', () => {
    const definition = getWidget('kpi-stat-card');
    expect(definition).toBeDefined();
    const start = layout([item('a', 0, 0, 3, 3)]);
    const { layout: next, itemId } = insertWidget(start, definition!);
    expect(next.items).toHaveLength(2);
    const created = next.items.find((entry) => entry.i === itemId);
    expect(created).toBeDefined();
    expect(created?.widget).toBe('kpi-stat-card');
    expect(created?.x).toBe(3);
    expect(created?.y).toBe(0);
    // schema defaults populated (kpi-stat-card has defaulted enums/booleans).
    expect(created?.config['showSparkline']).toBe(true);
  });
});

describe('duplicateItem', () => {
  it('clones config under a new id at first-fit', () => {
    const start = layout([item('a', 0, 0, 3, 3)]);
    start.items[0]!.config = { metricLabel: 'Revenue' };
    const { layout: next, itemId } = duplicateItem(start, 'a');
    expect(next.items).toHaveLength(2);
    expect(itemId).not.toBe('a');
    const clone = next.items.find((entry) => entry.i === itemId);
    expect(clone?.config).toEqual({ metricLabel: 'Revenue' });
    // A distinct object, not a shared reference.
    expect(clone?.config).not.toBe(start.items[0]!.config);
  });

  it('is a no-op for an unknown id', () => {
    const start = layout([item('a', 0, 0, 3, 3)]);
    expect(duplicateItem(start, 'missing').layout).toBe(start);
  });
});

describe('removeItem', () => {
  it('drops the item and compacts the gap', () => {
    const start = layout([item('a', 0, 0, 3, 3), item('b', 0, 3, 3, 3)]);
    const next = removeItem(start, 'a');
    expect(next.items).toHaveLength(1);
    expect(next.items[0]?.i).toBe('b');
    expect(next.items[0]?.y).toBe(0); // compacted up
  });
});

describe('updateItemConfig', () => {
  it('replaces only the target item config', () => {
    const start = layout([item('a', 0, 0, 3, 3), item('b', 3, 0, 3, 3)]);
    const next = updateItemConfig(start, 'a', { metricLabel: 'X' });
    expect(next.items[0]?.config).toEqual({ metricLabel: 'X' });
    expect(next.items[1]?.config).toEqual({});
  });
});

describe('lockedPathsOf', () => {
  it('reads the reserved __locked array', () => {
    expect(lockedPathsOf({ __locked: ['metricFormat', 'binding'] })).toEqual(['metricFormat', 'binding']);
  });

  it('returns an empty array when absent or malformed', () => {
    expect(lockedPathsOf({})).toEqual([]);
    expect(lockedPathsOf(undefined)).toEqual([]);
    expect(lockedPathsOf({ __locked: 'nope' })).toEqual([]);
  });
});
