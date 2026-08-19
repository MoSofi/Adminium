// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `chunker.ts` — huge-schema map-reduce (06-llm-assist.md §4.5, acceptance
 * criterion 7): "A 300-table synthetic schema chunks into ≥ 2 prompts each
 * ≤ 45k estimated tokens; cross-chunk FK targets appear as stubs; deterministic
 * merge + merge-prompt output validate and produce exactly one group per table."
 *
 * The synthetic schema is one connected FK component (a 3-ary tree via
 * `parent_id`), which forces the single cluster to be split across chunks — the
 * case that actually produces cross-chunk stubs.
 */
import { parseDatabaseModel } from '@adminium/engine';
import type { DatabaseModel, StatsResult } from '@adminium/engine';
import { describe, expect, it } from 'vitest';

import { applyGlobalMerge, buildMergePrompt, mergeChunkResponses } from '../response/merge.js';
import { LlmResponseV1 } from '../response/schema.js';

import { buildPrompt } from './builder.js';
import {
  DEFAULT_CHUNK_TOKEN_BUDGET,
  buildChunkedPrompts,
  clusterTables,
  computeStubsForChunk,
  planSchemaChunks,
  subModelForChunk,
} from './chunker.js';
import type { ChunkPromptOptions, SchemaChunk } from './chunker.js';
import { estimateTokens } from './token-estimate.js';
import type { PromptInput } from './types.js';

// ─── Synthetic schema ────────────────────────────────────────────────────────

const FILLER_TYPES = ['text', 'integer', 'boolean', 'timestamptz', 'decimal', 'uuid', 'date', 'varchar'];
const pad = (n: number): string => n.toString().padStart(3, '0');
const tid = (n: number): string => `public.t${pad(n)}`;

/**
 * `count` tables, each `t000…`, wired into a single FK component: table `i`
 * (i > 0) has `parent_id → t{floor((i-1)/3)}.id`, declared both as a column FK
 * mirror and a `declared-fk` relation. 10 filler columns per table + full stats
 * push the assembled prompt well past the 45k budget.
 */
function makeSyntheticSchema(count: number): DatabaseModel {
  const tables: Record<string, unknown>[] = [];
  const relations: Record<string, unknown>[] = [];
  for (let i = 0; i < count; i += 1) {
    const columns: Record<string, unknown>[] = [
      { name: 'id', logicalType: 'uuid', nullable: false, isPrimaryKey: true, isUnique: true },
    ];
    if (i > 0) {
      const parent = Math.floor((i - 1) / 3);
      columns.push({
        name: 'parent_id',
        logicalType: 'uuid',
        nullable: true,
        references: { tableId: tid(parent), column: 'id' },
      });
      relations.push({
        id: `fk_${pad(i)}`,
        kind: 'declared-fk',
        cardinality: 'one-to-many',
        from: { tableId: tid(i), columns: ['parent_id'] },
        to: { tableId: tid(parent), columns: ['id'] },
      });
    }
    for (let c = 0; c < 10; c += 1) {
      columns.push({ name: `field_${c}`, logicalType: FILLER_TYPES[c % FILLER_TYPES.length], nullable: true });
    }
    tables.push({ name: `t${pad(i)}`, primaryKey: ['id'], rowCountEstimate: (i * 6151) % 50_000, columns });
  }
  return parseDatabaseModel({ dialect: 'postgres', name: 'huge', tables, relations });
}

function makeStats(model: DatabaseModel): StatsResult[] {
  return model.tables.map((table) => ({
    table: { schema: 'public', name: table.name },
    rowCountEstimate: table.rowCountEstimate,
    rowCountExact: false,
    sampled: false,
    columns: table.columns.map((column) => ({ column: column.name, nullFraction: 0, distinctCount: 100 })),
  }));
}

const TABLE_COUNT = 300;
const model = makeSyntheticSchema(TABLE_COUNT);
const stats = makeStats(model);
const allTableIds = model.tables.map((table) => table.id);

const options: ChunkPromptOptions = {
  allowed: { templates: ['page-crud', 'page-queue-inbox'], widgets: ['kpi-stat-card', 'chart-bar'] },
};

function makeInput(overrides: Partial<PromptInput> = {}): PromptInput {
  return {
    snapshotId: 'snap_huge',
    schemaIr: model,
    stats,
    locales: ['en_US'],
    sections: [],
    sampling: null,
    runId: '01J9ZK3W8E2Q4R6T8V0X2Y4Z6A',
    ...overrides,
  };
}

// ─── Chunking behavior ───────────────────────────────────────────────────────

describe('buildChunkedPrompts (§4.5, criterion 7)', () => {
  const artifact = buildChunkedPrompts(makeInput(), options);

  it('splits a 300-table schema into ≥ 2 chunks', () => {
    expect(artifact.chunked).toBe(true);
    expect(artifact.chunks.length).toBeGreaterThanOrEqual(2);
    expect(artifact.plan).toHaveLength(artifact.chunks.length);
  });

  it('keeps every chunk within the 45k token budget', () => {
    for (const chunk of artifact.chunks) {
      expect(chunk.tokenEstimate).toBeGreaterThan(0);
      expect(chunk.tokenEstimate).toBeLessThanOrEqual(DEFAULT_CHUNK_TOKEN_BUDGET);
    }
    // The whole schema really was over budget (otherwise chunking is untested).
    const total = artifact.chunks.reduce((sum, chunk) => sum + chunk.tokenEstimate, 0);
    expect(total).toBeGreaterThan(DEFAULT_CHUNK_TOKEN_BUDGET);
  });

  it('partitions the full-table set disjointly and exhaustively', () => {
    const seen = new Set<string>();
    for (const chunk of artifact.plan) {
      for (const id of chunk.tableIds) {
        expect(seen.has(id)).toBe(false); // disjoint
        seen.add(id);
      }
    }
    expect(seen).toEqual(new Set(allTableIds)); // exhaustive
  });

  it('renders each chunk self-contained: chunk-info sentence + stub markers', () => {
    let chunksWithStubs = 0;
    for (const chunk of artifact.chunks) {
      expect(chunk.byo).toContain(`This is chunk ${chunk.index} of ${chunk.total}`);
      const planEntry = artifact.plan[chunk.index - 1];
      expect(planEntry).toBeDefined();
      if (planEntry !== undefined && planEntry.stubTables.length > 0) {
        chunksWithStubs += 1;
        expect(chunk.byo).toContain('"stub":true');
      }
    }
    // Splitting one FK component across chunks must produce stubs somewhere.
    expect(chunksWithStubs).toBeGreaterThan(0);
  });

  it('emits a stub for every cross-chunk FK target — and only those', () => {
    for (const chunk of artifact.plan) {
      const full = new Set(chunk.tableIds);
      const stubs = new Set(chunk.stubTables);

      // No id is both full and stub in the same chunk.
      for (const id of stubs) expect(full.has(id)).toBe(false);

      // Completeness: every out-of-chunk relation/column-FK target is stubbed.
      const expected = new Set<string>();
      for (const relation of model.relations) {
        if (full.has(relation.from.tableId) && !full.has(relation.to.tableId)) {
          expected.add(relation.to.tableId);
        }
      }
      for (const table of model.tables) {
        if (!full.has(table.id)) continue;
        for (const column of table.columns) {
          if (column.references !== null && !full.has(column.references.tableId)) {
            expected.add(column.references.tableId);
          }
        }
      }
      expect(stubs).toEqual(expected);
    }
  });

  it('is deterministic — same input yields byte-identical plan and prompts', () => {
    const again = buildChunkedPrompts(makeInput(), options);
    expect(again.plan).toEqual(artifact.plan);
    expect(again.chunks.map((chunk) => chunk.byo)).toEqual(artifact.chunks.map((chunk) => chunk.byo));
  });
});

describe('split threshold is the tokenBudget, not the per-chunk ceiling (finding 6)', () => {
  const input = makeInput();
  const userTokens = estimateTokens(buildPrompt(input, options).user);

  it('does NOT chunk a schema that fits the 60k tokenBudget even if it exceeds the 45k chunk ceiling', () => {
    const artifact = buildChunkedPrompts(input, {
      ...options,
      tokenBudget: userTokens + 1000, // assembled user section fits the budget…
      chunkTokenBudget: Math.max(1, userTokens - 1000), // …though it exceeds the packing ceiling.
    });
    expect(artifact.chunked).toBe(false);
    expect(artifact.chunks).toHaveLength(1);
    expect(artifact.plan).toHaveLength(1);
    expect(artifact.plan[0]?.stubTables).toEqual([]);
  });

  it('still chunks once the assembled user section exceeds the tokenBudget', () => {
    const artifact = buildChunkedPrompts(input, {
      ...options,
      tokenBudget: Math.max(1, userTokens - 1000),
    });
    expect(artifact.chunked).toBe(true);
  });
});

describe('clusterTables', () => {
  it('groups the whole 3-ary FK tree into one connected component', () => {
    const clusters = clusterTables(model);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toHaveLength(TABLE_COUNT);
  });

  it('leaves relation-free tables as singleton clusters', () => {
    const island = parseDatabaseModel({
      dialect: 'postgres',
      name: 'islands',
      tables: [
        { name: 'a', primaryKey: ['id'], columns: [{ name: 'id', logicalType: 'uuid', isPrimaryKey: true }] },
        { name: 'b', primaryKey: ['id'], columns: [{ name: 'id', logicalType: 'uuid', isPrimaryKey: true }] },
      ],
    });
    expect(clusterTables(island)).toEqual([['public.a'], ['public.b']]);
  });

  it('pulls an m2m join table into the component it joins', () => {
    // A `through` relation names three tables and only two endpoints. Linking
    // just `from`/`to` would leave the join table a singleton cluster, free to
    // be packed into a different chunk from the rows it joins — and the chunk
    // that owned the relation would render a join against a table that is not
    // there.
    const m2m = parseDatabaseModel({
      dialect: 'postgres',
      name: 'm2m',
      tables: [
        { name: 'posts', primaryKey: ['id'], columns: [{ name: 'id', logicalType: 'uuid', isPrimaryKey: true }] },
        { name: 'tags', primaryKey: ['id'], columns: [{ name: 'id', logicalType: 'uuid', isPrimaryKey: true }] },
        {
          name: 'post_tags',
          primaryKey: ['post_id', 'tag_id'],
          columns: [
            { name: 'post_id', logicalType: 'uuid', isPrimaryKey: true },
            { name: 'tag_id', logicalType: 'uuid', isPrimaryKey: true },
          ],
        },
        { name: 'unrelated', primaryKey: ['id'], columns: [{ name: 'id', logicalType: 'uuid', isPrimaryKey: true }] },
      ],
      relations: [
        {
          id: 'rel_posts_tags',
          kind: 'declared-fk',
          cardinality: 'many-to-many',
          from: { tableId: 'public.posts', columns: ['id'] },
          to: { tableId: 'public.tags', columns: ['id'] },
          through: {
            tableId: 'public.post_tags',
            fromColumns: ['post_id'],
            toColumns: ['tag_id'],
          },
        },
      ],
    });

    expect(clusterTables(m2m)).toEqual([
      ['public.post_tags', 'public.posts', 'public.tags'],
      ['public.unrelated'],
    ]);

    // And when only the two endpoints make it into a chunk, the join table is
    // stubbed rather than dropped.
    const stubs = computeStubsForChunk(m2m, new Set(['public.posts', 'public.tags']));
    expect([...stubs]).toEqual(['public.post_tags']);

    // A chunk holding all three needs no stub at all.
    expect([
      ...computeStubsForChunk(m2m, new Set(['public.posts', 'public.tags', 'public.post_tags'])),
    ]).toEqual([]);
  });
});

// ─── Packing paths the one-big-component fixture never reaches ───────────────

describe('planSchemaChunks over many independent clusters', () => {
  /** `count` relation-free tables, each heavy enough that a chunk holds few. */
  function makeIslands(count: number): DatabaseModel {
    const tables = Array.from({ length: count }, (_, i) => ({
      name: `t${pad(i)}`,
      primaryKey: ['id'],
      rowCountEstimate: 1_000 + i,
      columns: [
        { name: 'id', logicalType: 'uuid', nullable: false, isPrimaryKey: true },
        ...Array.from({ length: 10 }, (_, c) => ({
          name: `field_${c}`,
          logicalType: FILLER_TYPES[c % FILLER_TYPES.length],
          nullable: true,
        })),
      ],
    }));
    return parseDatabaseModel({ dialect: 'postgres', name: 'islands', tables });
  }

  const islandModel = makeIslands(300);
  const islandInput: PromptInput = {
    snapshotId: 'snap_islands',
    schemaIr: islandModel,
    stats: makeStats(islandModel),
    locales: ['en_US'],
    sections: [],
    sampling: null,
    runId: '01J9ZK3W8E2Q4R6T8V0X2Y4Z6A',
  };

  const plan = planSchemaChunks(islandInput, options);

  it('first-fit-packs whole clusters across several chunks', () => {
    expect(plan.length).toBeGreaterThan(1);
    // Every chunk carries tables and states the same total, so the chunk-info
    // sentence ("chunk i of n") the model reads is consistent across prompts.
    for (const [i, chunk] of plan.entries()) {
      expect(chunk.tableIds.length).toBeGreaterThan(0);
      expect(chunk.index).toBe(i + 1);
      expect(chunk.total).toBe(plan.length);
    }
    // Exhaustive and disjoint, exactly as for the connected case.
    const seen = plan.flatMap((chunk) => chunk.tableIds);
    expect(new Set(seen).size).toBe(seen.length);
    expect([...seen].sort()).toEqual(islandModel.tables.map((t) => t.id).sort());
  });

  it('emits no stubs at all, because no relation can cross a chunk boundary', () => {
    // The reason whole clusters are packed rather than tables: a chunk boundary
    // that never cuts an FK needs no stub context, so every token in the chunk
    // is spent on real schema.
    expect(plan.flatMap((chunk) => chunk.stubTables)).toEqual([]);
  });

  it('keeps every chunk inside the per-chunk budget', () => {
    for (const chunk of plan) {
      const artifact = buildPrompt(
        {
          ...islandInput,
          schemaIr: subModelForChunk(islandModel, new Set(chunk.tableIds), new Set()),
          stats: islandInput.stats.filter((s) =>
            chunk.tableIds.includes(`public.${s.table.name}`),
          ),
          chunk: { index: chunk.index, total: chunk.total, stubTables: [] },
        },
        options,
      );
      expect(estimateTokens(artifact.chunks[0]?.user ?? '')).toBeLessThanOrEqual(
        DEFAULT_CHUNK_TOKEN_BUDGET,
      );
    }
  });

  it('refuses a budget the fixed prompt overhead alone would exhaust', () => {
    // The instruction template, allow-lists and locales are on EVERY chunk, so
    // below a certain budget no table fits in any chunk. Failing with the two
    // numbers is the only outcome an operator can act on — the alternative is a
    // plan of empty chunks, or a loop that never places a table.
    expect(() => planSchemaChunks(islandInput, { ...options, chunkTokenBudget: 200 })).toThrow(
      /token budget 200 too small for the fixed prompt overhead/,
    );
  });
});

// ─── Deterministic merge over the chunk plan (criterion 7) ───────────────────

/** Script a per-chunk partial: one nav group covering the chunk's full tables. */
function scriptChunkResponse(chunk: SchemaChunk): LlmResponseV1 {
  return {
    schema_version: 'adminium.llm/v1',
    tables: chunk.tableIds.map((id) => ({
      table: id,
      confidence: 0.9,
      label: { en_US: id },
      description: { en_US: `The ${id} table.` },
      icon: 'table',
      displayColumn: null,
      naturalKey: null,
      pageTemplates: [],
      columns: [],
    })),
    enums: [],
    relations: { confirmed: [], inferred: [] },
    navGroups: [
      {
        id: `group-${chunk.index}`,
        label: { en_US: `Group ${chunk.index}` },
        icon: 'folder',
        order: chunk.index - 1,
        tables: [...chunk.tableIds],
        confidence: 0.8,
      },
    ],
    dashboards: [],
  };
}

describe('mergeChunkResponses over the plan (criterion 7)', () => {
  const plan = planSchemaChunks(makeInput(), options);
  const responses = plan.map(scriptChunkResponse);

  it('yields exactly one nav group per table, covering every table', () => {
    const merged = mergeChunkResponses(responses);
    const owner = new Map<string, string>();
    for (const group of merged.navGroups) {
      for (const table of group.tables) {
        expect(owner.has(table)).toBe(false); // no table in two groups
        owner.set(table, group.id);
      }
    }
    expect(owner.size).toBe(TABLE_COUNT);
    expect(new Set(owner.keys())).toEqual(new Set(allTableIds));
    expect(merged.tables).toHaveLength(TABLE_COUNT);
  });

  it('is order-independent (shuffled chunk responses merge identically)', () => {
    const merged = mergeChunkResponses(responses);
    const reversed = mergeChunkResponses([...responses].reverse());
    expect(reversed).toEqual(merged);
  });

  it('produces a validatable merged response', () => {
    expect(() => LlmResponseV1.parse(mergeChunkResponses(responses))).not.toThrow();
  });

  it('builds a PROMPT_MERGE_V1 reduce prompt embedding the chunk count + table list', () => {
    const prompt = buildMergePrompt(responses, { allTableNames: allTableIds });
    expect(prompt.total).toBe(responses.length);
    expect(prompt.user).toContain(`for ${responses.length} chunks`);
    expect(prompt.user).toContain(tid(0));
    expect(prompt.byo.startsWith('=== SYSTEM ===')).toBe(true);
    expect(prompt.tokenEstimate).toBeGreaterThan(0);
  });

  it('applyGlobalMerge re-consolidates an LLM merge result to one group per table', () => {
    const merged = mergeChunkResponses(responses);
    const half = Math.floor(TABLE_COUNT / 2);
    const globalMerge = LlmResponseV1.parse({
      schema_version: 'adminium.llm/v1',
      navGroups: [
        { id: 'left', label: { en_US: 'Left' }, icon: 'folder', order: 0, tables: allTableIds.slice(0, half), confidence: 0.9 },
        { id: 'right', label: { en_US: 'Right' }, icon: 'folder', order: 1, tables: allTableIds.slice(half), confidence: 0.9 },
      ],
    });
    const folded = applyGlobalMerge(merged, globalMerge);
    const owner = new Map<string, string>();
    for (const group of folded.navGroups) {
      for (const table of group.tables) {
        expect(owner.has(table)).toBe(false);
        owner.set(table, group.id);
      }
    }
    expect(owner.size).toBe(TABLE_COUNT);
    // Per-table sections from the deterministic reduce are preserved.
    expect(folded.tables).toEqual(merged.tables);
  });
});
