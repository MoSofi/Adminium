// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Pure review-model tests (06-llm-assist.md §8.2, §10.3). Pins the two
 * behaviours acceptance criterion 12 hangs on — "'Accept all ≥ 0.8' never
 * selects rejects-heuristic or user-locked rows" and the §8.2 default checks —
 * plus category grouping, header counts and the apply-write summary.
 */
import { describe, expect, it } from 'vitest';

import type { SuggestionDiff, SuggestionStatus } from '../ai/api.js';
import {
  acceptedCount,
  bulkAcceptSelection,
  countStatuses,
  defaultSelection,
  groupDiffs,
  isDefaultChecked,
  rowIdentifier,
  selectAllState,
  selectableIds,
  summarizeAccepted,
} from './model.js';

function mk(
  id: string,
  category: string,
  status: SuggestionStatus,
  confidence = 0.9,
): SuggestionDiff {
  return { id, category, status, confidence, llmValue: {}, heuristicValue: {} };
}

const CORPUS: SuggestionDiff[] = [
  mk('label:public.orders', 'label', 'conflict', 0.9),
  mk('label:public.orders.total_cents', 'label', 'agree', 0.4),
  mk('key:public.orders', 'key', 'llm-new', 0.6), // below threshold
  mk('enum:public.orders.status', 'enum', 'conflict', 0.95),
  mk('relation:public.orders.product_id->public.products.id', 'relation', 'llm-new', 0.93),
  mk('template:public.orders:page-queue-inbox', 'template', 'llm-new', 0.82),
  mk('pii:public.customers.email', 'pii', 'rejects-heuristic', 0.99),
  mk('pii:public.customers.full_name', 'pii', 'user-locked', 0.96),
  mk('group:sales', 'group', 'heuristic-only', 0.5),
  mk('dashboard:revenue', 'dashboard', 'llm-new', 0.9),
  mk('widget:revenue:chart-line-area:3', 'widget', 'agree', 0.9),
  mk('copy:public.orders', 'copy', 'llm-new', 0.7), // below threshold
];

describe('groupDiffs', () => {
  it('buckets categories into the §10.3 display groups, folding dashboard+widget', () => {
    const groups = groupDiffs(CORPUS);
    const ids = groups.map((group) => group.def.id);
    // §10.3 order, empty groups (icons) dropped.
    expect(ids).toEqual(['labels', 'groups', 'enums', 'relations', 'keys', 'templates', 'dashboards', 'pii', 'microcopy']);
    const dashboards = groups.find((group) => group.def.id === 'dashboards');
    expect(dashboards?.rows.map((row) => row.category).sort()).toEqual(['dashboard', 'widget']);
  });

  it('drops groups with no rows', () => {
    const groups = groupDiffs([mk('label:public.x', 'label', 'agree')]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.def.id).toBe('labels');
  });
});

describe('countStatuses', () => {
  it('counts agree / conflict / new / rejects for the header', () => {
    const counts = countStatuses(CORPUS);
    expect(counts.agree).toBe(2);
    expect(counts.conflict).toBe(2);
    expect(counts.new).toBe(5);
    expect(counts.rejects).toBe(1);
    expect(counts.locked).toBe(1);
    expect(counts.heuristicOnly).toBe(1);
    expect(counts.total).toBe(CORPUS.length);
  });
});

describe('default selection (§8.2 review defaults)', () => {
  it('pre-checks agree always, conflict/llm-new only at/above the threshold', () => {
    expect(isDefaultChecked(mk('a', 'label', 'agree', 0.1))).toBe(true);
    expect(isDefaultChecked(mk('a', 'label', 'conflict', 0.8))).toBe(true);
    expect(isDefaultChecked(mk('a', 'label', 'conflict', 0.79))).toBe(false);
    expect(isDefaultChecked(mk('a', 'label', 'llm-new', 0.9))).toBe(true);
  });

  it('never pre-checks rejects-heuristic, heuristic-only or user-locked', () => {
    expect(isDefaultChecked(mk('a', 'pii', 'rejects-heuristic', 1))).toBe(false);
    expect(isDefaultChecked(mk('a', 'group', 'heuristic-only', 1))).toBe(false);
    expect(isDefaultChecked(mk('a', 'pii', 'user-locked', 1))).toBe(false);
  });

  it('assembles the initial accept set', () => {
    const selected = defaultSelection(CORPUS);
    expect(selected).toContain('label:public.orders'); // conflict 0.9
    expect(selected).toContain('label:public.orders.total_cents'); // agree
    expect(selected).toContain('enum:public.orders.status');
    expect(selected).toContain('relation:public.orders.product_id->public.products.id');
    expect(selected).toContain('template:public.orders:page-queue-inbox'); // 0.82
    expect(selected).not.toContain('key:public.orders'); // llm-new 0.6
    expect(selected).not.toContain('copy:public.orders'); // llm-new 0.7
    expect(selected).not.toContain('pii:public.customers.email'); // rejects
    expect(selected).not.toContain('pii:public.customers.full_name'); // locked
  });
});

describe('bulkAcceptSelection — acceptance criterion 12', () => {
  it('never selects rejects-heuristic or user-locked rows, at any threshold', () => {
    for (const threshold of [0, 0.5, 0.8, 1]) {
      const selected = bulkAcceptSelection(CORPUS, threshold);
      expect(selected.has('pii:public.customers.email')).toBe(false);
      expect(selected.has('pii:public.customers.full_name')).toBe(false);
    }
  });

  it('gates conflict/llm-new on the threshold but always keeps agree', () => {
    const strict = bulkAcceptSelection(CORPUS, 0.95);
    expect(strict.has('enum:public.orders.status')).toBe(true); // 0.95
    expect(strict.has('label:public.orders')).toBe(false); // conflict 0.9 < 0.95
    expect(strict.has('label:public.orders.total_cents')).toBe(true); // agree
    const loose = bulkAcceptSelection(CORPUS, 0.6);
    expect(loose.has('key:public.orders')).toBe(true); // llm-new 0.6
    expect(loose.has('copy:public.orders')).toBe(true); // llm-new 0.7
  });
});

describe('per-category select-all', () => {
  it('selectableIds excludes rejects-heuristic and user-locked', () => {
    const piiRows = CORPUS.filter((row) => row.category === 'pii');
    expect(selectableIds(piiRows)).toEqual([]);
  });

  it('reports the tri-state of a category', () => {
    const rows = [mk('a', 'label', 'agree'), mk('b', 'label', 'conflict', 0.9)];
    expect(selectAllState(rows, new Set())).toBe('none');
    expect(selectAllState(rows, new Set(['a']))).toBe('some');
    expect(selectAllState(rows, new Set(['a', 'b']))).toBe('all');
  });
});

describe('summarizeAccepted', () => {
  it('counts accepted writes per category, folding dashboard+widget in the modal', () => {
    const accepted = new Set([
      'label:public.orders',
      'enum:public.orders.status',
      'dashboard:revenue',
      'widget:revenue:chart-line-area:3',
    ]);
    const summary = summarizeAccepted(CORPUS, accepted);
    expect(summary.labels).toBe(1);
    expect(summary.enums).toBe(1);
    expect(summary.dashboards).toBe(1);
    expect(summary.widgets).toBe(1);
    expect(summary.total).toBe(4);
    expect(acceptedCount(CORPUS, accepted)).toBe(4);
  });
});

describe('rowIdentifier', () => {
  it('drops the id prefix and the public schema qualifier', () => {
    expect(rowIdentifier(mk('label:public.orders.total_cents', 'label', 'agree'))).toBe('orders.total_cents');
    expect(rowIdentifier(mk('relation:public.orders.product_id->public.products.id', 'relation', 'llm-new'))).toBe(
      'orders.product_id->products.id',
    );
    expect(rowIdentifier(mk('group:sales', 'group', 'agree'))).toBe('sales');
  });
});
