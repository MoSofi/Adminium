// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `merge.ts` — deterministic chunk reduce + PROMPT_MERGE_V1 orchestration
 * (06-llm-assist.md §4.5). These focus on the reduce SEMANTICS with small
 * hand-built partials; `prompt/chunker.test.ts` exercises the criterion-7
 * end-to-end path over the 300-table schema.
 *
 * Inputs are built through `LlmResponseV1.parse` so defaults (relations, empty
 * arrays) are present exactly as a validated per-chunk response would carry them.
 */
import { describe, expect, it } from 'vitest';

import { LlmResponseV1 } from './schema.js';

import { applyGlobalMerge, buildMergePrompt, consolidateNavGroups, mergeChunkResponses } from './merge.js';

function resp(input: Record<string, unknown>): LlmResponseV1 {
  return LlmResponseV1.parse({ schema_version: 'adminium.llm/v1', ...input });
}

function tbl(table: string, confidence: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    table,
    confidence,
    label: { en_US: table },
    description: { en_US: `The ${table} table.` },
    icon: 'table',
    displayColumn: null,
    naturalKey: null,
    ...extra,
  };
}

function grp(id: string, tables: string[], confidence: number): Record<string, unknown> {
  return { id, label: { en_US: id }, icon: 'folder', order: 0, tables, confidence };
}

function enumSug(table: string, column: string, confidence: number): Record<string, unknown> {
  return { table, column, kind: 'category', order: null, tones: { open: 'muted' }, reason: 'r', confidence };
}

function widget(widget: string, table: string, confidence: number): Record<string, unknown> {
  return { widget, rank: 1, span: 3, table, agg: 'count', titleEn: `${widget} on ${table}`, reason: 'r', confidence };
}

// ─── Per-table sections dedupe by key, keeping highest confidence ────────────

describe('mergeChunkResponses — per-table sections', () => {
  it('dedupes tables by id, keeping the higher-confidence entry, sorted', () => {
    const merged = mergeChunkResponses([
      resp({ tables: [tbl('public.a', 0.6)] }),
      resp({ tables: [tbl('public.b', 0.5), tbl('public.a', 0.9)] }),
    ]);
    expect(merged.tables.map((t) => t.table)).toEqual(['public.a', 'public.b']);
    expect(merged.tables.find((t) => t.table === 'public.a')?.confidence).toBe(0.9);
  });

  it('dedupes enums by (table, column), keeping the higher-confidence entry', () => {
    const merged = mergeChunkResponses([
      resp({ enums: [enumSug('public.orders', 'status', 0.4)] }),
      resp({ enums: [enumSug('public.orders', 'status', 0.95)] }),
    ]);
    expect(merged.enums).toHaveLength(1);
    expect(merged.enums[0]?.confidence).toBe(0.95);
  });

  it('dedupes inferred relations by endpoints, keeping highest confidence (§4.5)', () => {
    const rel = (confidence: number): Record<string, unknown> => ({
      fromTable: 'public.orders',
      fromColumns: ['product_id'],
      toTable: 'public.products',
      toColumns: ['id'],
      kind: 'many-to-one',
      evidence: 'name + type match',
      confidence,
    });
    const merged = mergeChunkResponses([
      resp({ relations: { confirmed: [], inferred: [rel(0.7)] } }),
      resp({ relations: { confirmed: [], inferred: [rel(0.93)] } }),
    ]);
    expect(merged.relations.inferred).toHaveLength(1);
    expect(merged.relations.inferred[0]?.confidence).toBe(0.93);
  });

  it('dedupes confirmed relations by endpoints', () => {
    const rel = (confidence: number): Record<string, unknown> => ({
      fromTable: 'public.orders',
      fromColumns: ['customer_id'],
      toTable: 'public.customers',
      toColumns: ['id'],
      semantics: 'orders belong to customers',
      correct: true,
      confidence,
    });
    const merged = mergeChunkResponses([
      resp({ relations: { confirmed: [rel(0.8)], inferred: [] } }),
      resp({ relations: { confirmed: [rel(0.99)], inferred: [] } }),
    ]);
    expect(merged.relations.confirmed).toHaveLength(1);
    expect(merged.relations.confirmed[0]?.confidence).toBe(0.99);
  });

  it('dedupes and caps notes at 5, sorted', () => {
    const merged = mergeChunkResponses([
      resp({ notes: ['b', 'a', 'a'] }),
      resp({ notes: ['c', 'd', 'e', 'f'] }),
    ]);
    expect(merged.notes).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

// ─── Global sections: one group per table ────────────────────────────────────

describe('mergeChunkResponses — nav groups (one group per table)', () => {
  it('unions same-id groups from different chunks', () => {
    const merged = mergeChunkResponses([
      resp({ navGroups: [grp('sales', ['public.orders'], 0.9)] }),
      resp({ navGroups: [grp('sales', ['public.invoices'], 0.9)] }),
    ]);
    expect(merged.navGroups).toHaveLength(1);
    expect(merged.navGroups[0]?.tables).toEqual(['public.invoices', 'public.orders']);
  });

  it('assigns a table proposed under two groups to the higher-confidence group', () => {
    const merged = mergeChunkResponses([
      resp({ navGroups: [grp('x', ['public.a', 'public.b'], 0.7)] }),
      resp({ navGroups: [grp('y', ['public.b', 'public.c'], 0.9)] }),
    ]);
    const owner = new Map<string, string>();
    for (const group of merged.navGroups) for (const table of group.tables) owner.set(table, group.id);
    expect(owner.get('public.b')).toBe('y'); // higher confidence wins
    expect(merged.navGroups.find((g) => g.id === 'x')?.tables).toEqual(['public.a']);
    expect(merged.navGroups.find((g) => g.id === 'y')?.tables).toEqual(['public.b', 'public.c']);
  });

  it('order-independent: reversing the input changes nothing', () => {
    const inputs = [
      resp({ navGroups: [grp('x', ['public.a', 'public.b'], 0.7)], tables: [tbl('public.a', 0.5)] }),
      resp({ navGroups: [grp('y', ['public.b', 'public.c'], 0.9)], tables: [tbl('public.c', 0.6)] }),
    ];
    expect(mergeChunkResponses([...inputs].reverse())).toEqual(mergeChunkResponses(inputs));
  });
});

describe('consolidateNavGroups — cap of 7', () => {
  it('folds surplus groups into the last kept one, keeping every table once', () => {
    const groups = Array.from({ length: 9 }, (_, i) =>
      LlmResponseV1.parse({
        schema_version: 'adminium.llm/v1',
        navGroups: [grp(`g${i}`, [`public.t${i}`], 0.5 + i * 0.01)],
      }).navGroups[0],
    ).filter((g): g is NonNullable<typeof g> => g !== undefined);

    const consolidated = consolidateNavGroups(groups);
    expect(consolidated.length).toBeLessThanOrEqual(7);
    const owner = new Map<string, string>();
    for (const group of consolidated) for (const table of group.tables) {
      expect(owner.has(table)).toBe(false);
      owner.set(table, group.id);
    }
    expect(owner.size).toBe(9); // all 9 tables covered exactly once
  });
});

// ─── Dashboards ──────────────────────────────────────────────────────────────

describe('mergeChunkResponses — dashboards', () => {
  it('merges same-id dashboards, dedupes widgets by binding, re-ranks', () => {
    const merged = mergeChunkResponses([
      resp({
        dashboards: [
          { id: 'rev', domain: 'Revenue', label: { en_US: 'Revenue' }, order: 0, tables: ['public.orders'], widgets: [widget('kpi-stat-card', 'public.orders', 0.6)] },
        ],
      }),
      resp({
        dashboards: [
          { id: 'rev', domain: 'Revenue', label: { en_US: 'Revenue' }, order: 0, tables: ['public.orders'], widgets: [widget('kpi-stat-card', 'public.orders', 0.95), widget('chart-bar', 'public.orders', 0.8)] },
        ],
      }),
    ]);
    expect(merged.dashboards).toHaveLength(1);
    const dash = merged.dashboards[0];
    expect(dash?.widgets).toHaveLength(2); // kpi deduped
    expect(dash?.widgets.map((w) => w.rank)).toEqual([1, 2]);
    expect(dash?.widgets[0]?.confidence).toBe(0.95); // higher-confidence kpi kept, ranked first
  });

  it('caps merged dashboards at 6', () => {
    const responses = Array.from({ length: 8 }, (_, i) =>
      resp({
        dashboards: [
          { id: `d${i}`, domain: `D${i}`, label: { en_US: `D${i}` }, order: 0, tables: [`public.t${i}`], widgets: [widget('kpi-stat-card', `public.t${i}`, 0.5)] },
        ],
      }),
    );
    expect(mergeChunkResponses(responses).dashboards.length).toBeLessThanOrEqual(6);
  });
});

// ─── Declined chunks + merge prompt ──────────────────────────────────────────

describe('mergeChunkResponses — declined responses', () => {
  it('ignores responses that declared an error', () => {
    const merged = mergeChunkResponses([
      resp({ error: 'no basis for suggestions' }),
      resp({ tables: [tbl('public.a', 0.9)] }),
    ]);
    expect(merged.error).toBeUndefined();
    expect(merged.tables.map((t) => t.table)).toEqual(['public.a']);
  });

  it('propagates the error when every response declined', () => {
    const merged = mergeChunkResponses([resp({ error: 'first' }), resp({ error: 'second' })]);
    expect(merged.error).toBe('first');
    expect(merged.tables).toEqual([]);
  });
});

describe('buildMergePrompt (§4.5)', () => {
  const responses = [
    resp({ navGroups: [grp('sales', ['public.orders'], 0.9)], dashboards: [] }),
    resp({ navGroups: [grp('catalog', ['public.products'], 0.9)], dashboards: [] }),
  ];

  it('fills TOTAL, the sorted table list, and the partial proposals', () => {
    const prompt = buildMergePrompt(responses, { allTableNames: ['public.products', 'public.orders'] });
    expect(prompt.total).toBe(2);
    expect(prompt.user).toContain('for 2 chunks');
    expect(prompt.user).toContain('["public.orders","public.products"]'); // sorted + deduped
    expect(prompt.user).toContain('"sales"');
    expect(prompt.user).toContain('"catalog"');
    expect(prompt.user).not.toContain('{{'); // every token filled
  });

  it('reuses the v1 system section and flattens BYO-style', () => {
    const prompt = buildMergePrompt(responses, { allTableNames: [] });
    expect(prompt.system).toContain('senior data architect');
    expect(prompt.byo).toBe(`=== SYSTEM ===\n${prompt.system}\n\n=== USER ===\n${prompt.user}`);
  });
});

describe('applyGlobalMerge', () => {
  it('swaps in re-consolidated globals while keeping per-table sections', () => {
    const merged = mergeChunkResponses([resp({ tables: [tbl('public.a', 0.9)], navGroups: [grp('old', ['public.a'], 0.5)] })]);
    const globalMerge = resp({ navGroups: [grp('new', ['public.a'], 0.9)] });
    const folded = applyGlobalMerge(merged, globalMerge);
    expect(folded.navGroups.map((g) => g.id)).toEqual(['new']);
    expect(folded.tables).toEqual(merged.tables);
  });
});
