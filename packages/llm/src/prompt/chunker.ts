/**
 * `chunker.ts` — token-budget map-phase chunking for huge schemas
 * (06-llm-assist.md §4.5, acceptance criterion 7).
 *
 * When the assembled prompt for a whole schema would exceed the per-prompt token
 * budget, the schema is split **by domain**: a connected-component clustering
 * over the FK graph (declared + inferred relations + column FK mirrors) keeps
 * related tables together, clusters are greedily packed into chunks of
 * ≤ `chunkTokenBudget` estimated tokens, and any single cluster too large for one
 * chunk is split by table row-count descending as a last resort.
 *
 * Each chunk is SELF-CONTAINED: it carries its own tables in full plus **stub
 * entries** for every out-of-chunk FK target its tables reference, so
 * cross-chunk relations stay inferable and every prompt validates on its own.
 * The map phase produces one prompt per chunk; `response/merge.ts` performs the
 * deterministic reduce.
 *
 * Determinism (a hard requirement — the diff UI and golden tests depend on it):
 * every ordering here is content-derived (cluster weight, table id, row count),
 * never insertion order or `Math.random`/`Date.now`. The same model + stats
 * always chunk identically.
 *
 * Browser-safe: `parseDatabaseModel` is pure Zod (no DB driver), and only
 * pure-TS engine TYPES are imported. This never creates an engine→llm edge.
 */
import { parseDatabaseModel } from '@adminium/engine';
import type { DatabaseModel, StatsResult } from '@adminium/engine';

import { buildPrompt, normalizeSections } from './builder.js';
import {
  qualifyTableRef,
  serializeSamplingPayload,
  serializeSchemaIr,
  serializeStats,
} from './serializer.js';
import { estimateTokens } from './token-estimate.js';
import type {
  BuildPromptOptions,
  PromptChunk,
  PromptInput,
  RequestedSection,
} from './types.js';

/** Per-chunk token ceiling (§4.5: "chunks of ≤ 45,000 tokens"). */
export const DEFAULT_CHUNK_TOKEN_BUDGET = 45_000;

/**
 * Slack subtracted from the per-chunk table capacity to absorb the small
 * discrepancy between summed per-fragment token estimates (each `ceil`-ed
 * independently) and the single `ceil` over the assembled prompt. Purely a
 * safety cushion — the built prompt always lands under budget.
 */
const SAFETY_TOKENS = 512;

/**
 * Fraction of a split cluster's per-chunk table capacity reserved for stub
 * entries. Stubs are column-NAME lists only (no types/flags/stats), empirically
 * a tiny fraction of a full table's serialized size, so 20 % is very
 * conservative and guarantees a split chunk stays under budget once its stubs
 * are added. Whole-cluster packing needs no reserve: clusters are FK-connected
 * components, so packing distinct clusters together never creates a cross-chunk
 * FK (and thus no stubs).
 */
const SPLIT_STUB_RESERVE_RATIO = 0.2;

export interface ChunkPromptOptions extends BuildPromptOptions {
  /** Per-chunk estimated-token ceiling (§4.5). Default {@link DEFAULT_CHUNK_TOKEN_BUDGET}. */
  chunkTokenBudget?: number;
}

/** One planned chunk: which tables it owns in full and which it stubs (§4.5). */
export interface SchemaChunk {
  /** 1-based position. */
  index: number;
  /** Total chunk count for this plan. */
  total: number;
  /** Qualified ids of the tables this chunk owns in full, in model order. */
  tableIds: string[];
  /** Qualified ids of out-of-chunk FK targets rendered as `"stub": true`, sorted. */
  stubTables: string[];
}

/**
 * Result of {@link buildChunkedPrompts}: one {@link PromptChunk} per chunk plus
 * the parallel {@link SchemaChunk} plan. `chunked` is `false` when the whole
 * schema fit in a single prompt (one chunk, no stubs, no chunk-info sentence).
 */
export interface ChunkedPromptArtifact {
  chunked: boolean;
  chunks: PromptChunk[];
  plan: SchemaChunk[];
  sections: readonly RequestedSection[];
}

// ─── FK-connectivity clustering (§4.5 "split by domain") ─────────────────────

function ensureSet(map: Map<string, Set<string>>, id: string): Set<string> {
  let set = map.get(id);
  if (set === undefined) {
    set = new Set<string>();
    map.set(id, set);
  }
  return set;
}

/**
 * Partition the model's tables into FK-connected components. The graph is
 * undirected over declared + inferred relations (both endpoints, and the join
 * table for m2m) and column FK mirrors. Tables touched by no relation are
 * singleton components. Each component is returned id-sorted, and the outer list
 * is sorted by smallest member id — fully deterministic.
 */
export function clusterTables(model: DatabaseModel): string[][] {
  const adjacency = new Map<string, Set<string>>();
  for (const table of model.tables) ensureSet(adjacency, table.id);

  const link = (a: string, b: string): void => {
    if (a === b) return;
    ensureSet(adjacency, a).add(b);
    ensureSet(adjacency, b).add(a);
  };

  for (const relation of model.relations) {
    link(relation.from.tableId, relation.to.tableId);
    if (relation.through !== null) {
      link(relation.from.tableId, relation.through.tableId);
      link(relation.to.tableId, relation.through.tableId);
    }
  }
  for (const table of model.tables) {
    for (const column of table.columns) {
      if (column.references !== null) link(table.id, column.references.tableId);
    }
  }

  const seen = new Set<string>();
  const clusters: string[][] = [];
  for (const table of model.tables) {
    if (seen.has(table.id)) continue;
    const component: string[] = [table.id];
    seen.add(table.id);
    const stack: string[] = [table.id];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) break;
      for (const neighbor of adjacency.get(current) ?? new Set<string>()) {
        if (seen.has(neighbor)) continue;
        seen.add(neighbor);
        component.push(neighbor);
        stack.push(neighbor);
      }
    }
    component.sort((a, b) => a.localeCompare(b));
    clusters.push(component);
  }

  clusters.sort((a, b) => (a[0] ?? '').localeCompare(b[0] ?? ''));
  return clusters;
}

// ─── Per-table weights + fixed overhead ──────────────────────────────────────

/**
 * Estimated token contribution of each full table to a prompt: its serialized
 * schema-IR entry + any enum-column entries + declared relations it owns + its
 * statistics entry + (opt-in) its sampling entry. Measured off the real
 * serializers so it tracks the actual prompt bytes; a couple of tokens per
 * fragment cover the surrounding commas.
 */
export function computeTableWeights(input: PromptInput): Map<string, number> {
  const model = input.schemaIr;
  const stats = input.stats;
  const weights = new Map<string, number>();
  const bump = (id: string, tokens: number): void => {
    weights.set(id, (weights.get(id) ?? 0) + tokens);
  };

  const ir = serializeSchemaIr(model, { stats });
  for (const table of ir.tables) bump(table.table, estimateTokens(JSON.stringify(table)) + 2);
  for (const enumColumn of ir.enumColumns) bump(enumColumn.table, estimateTokens(JSON.stringify(enumColumn)) + 1);
  for (const relation of ir.declaredRelations) {
    bump(relation.fromTable, estimateTokens(JSON.stringify(relation)) + 1);
  }

  const statsBlock = serializeStats(stats, { defaultSchema: model.defaultSchema });
  for (const table of statsBlock.tables) bump(table.table, estimateTokens(JSON.stringify(table)) + 1);

  if (input.sampling !== null) {
    const sampling = serializeSamplingPayload(model, stats, input.sampling.maxValuesPerColumn);
    for (const table of sampling.tables) bump(table.table, estimateTokens(JSON.stringify(table)) + 1);
  }

  for (const table of model.tables) if (!weights.has(table.id)) bump(table.id, 0);
  return weights;
}

/** Estimated token cost of rendering a table as a names-only stub (§4.5). */
export function computeStubWeights(model: DatabaseModel): Map<string, number> {
  const weights = new Map<string, number>();
  for (const table of model.tables) {
    const stub = { table: table.id, stub: true, columns: table.columns.map((column) => column.name) };
    weights.set(table.id, estimateTokens(JSON.stringify(stub)) + 1);
  }
  return weights;
}

/**
 * The fixed per-chunk overhead (system section + full instruction template +
 * allow-lists + locales + the chunk-info sentence + the empty structural JSON
 * wrappers), measured by rendering a prompt for a table-less model. Every chunk
 * repeats this cost regardless of how many tables it carries.
 */
export function computeOverheadTokens(input: PromptInput, options: ChunkPromptOptions): number {
  const model = input.schemaIr;
  const emptyModel = parseDatabaseModel({
    dialect: model.dialect,
    name: model.name,
    defaultSchema: model.defaultSchema,
    schemas: model.schemas,
    tables: [],
  });
  const overhead = buildPrompt(
    { ...input, schemaIr: emptyModel, stats: [], chunk: { index: 1, total: 2, stubTables: [] } },
    options,
  );
  return overhead.tokenEstimate;
}

// ─── Stub computation ────────────────────────────────────────────────────────

/**
 * The out-of-chunk FK targets a chunk's full tables reference: the `to` (and
 * join `through`) tables of every relation the chunk owns (relation `from` side
 * is in the chunk), plus every column FK-mirror target — restricted to tables
 * not in the chunk. These become the chunk's stub entries so no rendered
 * relation or `references` points at a missing table.
 */
export function computeStubsForChunk(model: DatabaseModel, fullTables: ReadonlySet<string>): Set<string> {
  const stubs = new Set<string>();
  for (const relation of model.relations) {
    if (!fullTables.has(relation.from.tableId)) continue;
    if (!fullTables.has(relation.to.tableId)) stubs.add(relation.to.tableId);
    if (relation.through !== null && !fullTables.has(relation.through.tableId)) {
      stubs.add(relation.through.tableId);
    }
  }
  for (const table of model.tables) {
    if (!fullTables.has(table.id)) continue;
    for (const column of table.columns) {
      if (column.references !== null && !fullTables.has(column.references.tableId)) {
        stubs.add(column.references.tableId);
      }
    }
  }
  return stubs;
}

// ─── Planning: cluster → chunk partition (§4.5) ──────────────────────────────

/**
 * Partition a schema into map-phase chunks. FFD-packs whole FK clusters into
 * chunks of ≤ `chunkTokenBudget`; any cluster too big for one chunk is split by
 * table row-count descending. Every chunk records the out-of-chunk FK targets it
 * must stub. Deterministic for a given (model, stats, options).
 */
export function planSchemaChunks(input: PromptInput, options: ChunkPromptOptions): SchemaChunk[] {
  const model = input.schemaIr;
  const budget = options.chunkTokenBudget ?? DEFAULT_CHUNK_TOKEN_BUDGET;
  const overhead = computeOverheadTokens(input, options);
  const tableCapacity = budget - overhead - SAFETY_TOKENS;
  if (tableCapacity <= 0) {
    throw new Error(
      `chunker: token budget ${budget} too small for the fixed prompt overhead ${overhead} (06-llm-assist.md §4.5).`,
    );
  }
  const splitCapacity = Math.max(1, Math.floor(tableCapacity * (1 - SPLIT_STUB_RESERVE_RATIO)));

  const tableWeight = computeTableWeights(input);
  const weightOf = (id: string): number => tableWeight.get(id) ?? 0;
  const clusterWeight = (cluster: readonly string[]): number =>
    cluster.reduce((sum, id) => sum + weightOf(id), 0);

  const modelOrder = new Map(model.tables.map((table, index) => [table.id, index] as const));
  const orderOf = (id: string): number => modelOrder.get(id) ?? Number.MAX_SAFE_INTEGER;
  const rowCount = rowCountLookup(model, input.stats);

  const clusters = clusterTables(model);
  const normal: string[][] = [];
  const oversized: string[][] = [];
  for (const cluster of clusters) {
    if (clusterWeight(cluster) <= tableCapacity) normal.push(cluster);
    else oversized.push(cluster);
  }

  // First-fit-decreasing over whole clusters (no cross-chunk FKs possible).
  normal.sort(
    (a, b) => clusterWeight(b) - clusterWeight(a) || (a[0] ?? '').localeCompare(b[0] ?? ''),
  );
  const ffdBins: string[][] = [];
  const ffdLoads: number[] = [];
  for (const cluster of normal) {
    const weight = clusterWeight(cluster);
    let placed = false;
    for (let i = 0; i < ffdBins.length; i += 1) {
      if ((ffdLoads[i] ?? 0) + weight <= tableCapacity) {
        ffdBins[i]?.push(...cluster);
        ffdLoads[i] = (ffdLoads[i] ?? 0) + weight;
        placed = true;
        break;
      }
    }
    if (!placed) {
      ffdBins.push([...cluster]);
      ffdLoads.push(weight);
    }
  }

  // Split each oversized cluster by row-count descending (last resort, §4.5).
  const splitBins: string[][] = [];
  oversized.sort((a, b) => (a[0] ?? '').localeCompare(b[0] ?? ''));
  for (const cluster of oversized) {
    const ordered = [...cluster].sort(
      (a, b) => rowCount(b) - rowCount(a) || a.localeCompare(b),
    );
    let current: string[] = [];
    let load = 0;
    for (const id of ordered) {
      const weight = weightOf(id);
      if (current.length > 0 && load + weight > splitCapacity) {
        splitBins.push(current);
        current = [];
        load = 0;
      }
      current.push(id);
      load += weight;
    }
    if (current.length > 0) splitBins.push(current);
  }

  const bins = [...ffdBins, ...splitBins];
  const total = bins.length;
  return bins.map((bin, index) => {
    const fullSet = new Set(bin);
    const stubs = computeStubsForChunk(model, fullSet);
    return {
      index: index + 1,
      total,
      tableIds: [...bin].sort((a, b) => orderOf(a) - orderOf(b)),
      stubTables: [...stubs].sort((a, b) => a.localeCompare(b)),
    };
  });
}

function rowCountLookup(
  model: DatabaseModel,
  stats: readonly StatsResult[],
): (id: string) => number {
  const counts = new Map<string, number>();
  for (const table of model.tables) {
    if (table.rowCountEstimate !== null) counts.set(table.id, table.rowCountEstimate);
  }
  for (const result of stats) {
    if (result.rowCountEstimate !== null) {
      counts.set(qualifyTableRef(result.table, model.defaultSchema), result.rowCountEstimate);
    }
  }
  return (id) => counts.get(id) ?? 0;
}

// ─── Building the map-phase prompts ──────────────────────────────────────────

/**
 * Build a self-contained sub-model for one chunk: its full tables plus its stub
 * tables (rendered names-only by the serializer via the chunk's `stubTables`
 * set), with enums narrowed to those the full tables reference and relations
 * narrowed to those the chunk owns (`from` in the chunk, `to`/`through` present
 * as full or stub).
 */
export function subModelForChunk(
  model: DatabaseModel,
  fullTables: ReadonlySet<string>,
  stubTables: ReadonlySet<string>,
): DatabaseModel {
  const keptTables = model.tables.filter(
    (table) => fullTables.has(table.id) || stubTables.has(table.id),
  );

  const referencedEnums = new Set<string>();
  for (const table of model.tables) {
    if (!fullTables.has(table.id)) continue;
    for (const column of table.columns) {
      if (column.enumRef !== null) referencedEnums.add(column.enumRef);
    }
  }
  const keptEnums = model.enums.filter((def) => referencedEnums.has(def.id));

  const present = (id: string): boolean => fullTables.has(id) || stubTables.has(id);
  const keptRelations = model.relations.filter(
    (relation) =>
      fullTables.has(relation.from.tableId) &&
      present(relation.to.tableId) &&
      (relation.through === null || present(relation.through.tableId)),
  );

  return { ...model, tables: keptTables, enums: keptEnums, relations: keptRelations };
}

function statsForChunk(
  stats: readonly StatsResult[],
  fullTables: ReadonlySet<string>,
  defaultSchema: string,
): StatsResult[] {
  return stats.filter((result) => fullTables.has(qualifyTableRef(result.table, defaultSchema)));
}

/**
 * Build the map-phase prompt(s) for a schema. Split ONLY when the assembled user
 * section exceeds the per-prompt `tokenBudget` (default 60,000 — §4.5); a schema
 * that fits in one prompt is returned unchunked (no stubs, no chunk-info
 * sentence) even when it is larger than the 45,000-token per-chunk packing
 * ceiling. When it does not fit, it is chunked per {@link planSchemaChunks}, each
 * chunk a self-contained prompt with correct FK stubs and each within
 * `chunkTokenBudget`.
 */
export function buildChunkedPrompts(
  input: PromptInput,
  options: ChunkPromptOptions,
): ChunkedPromptArtifact {
  const model = input.schemaIr;
  const sections = normalizeSections(input.sections);

  // Split decision: the 60k tokenBudget (§4.5), NOT the 45k per-chunk ceiling.
  // `buildPrompt.overBudget` measures the assembled user section against
  // `options.tokenBudget` (default DEFAULT_TOKEN_BUDGET = 60k) — exactly the
  // "assembled user section exceeds budget" test §4.5 specifies.
  const whole = buildPrompt(input, options);
  if (!whole.overBudget) {
    return {
      chunked: false,
      chunks: whole.chunks,
      plan: [
        {
          index: 1,
          total: 1,
          tableIds: model.tables.map((table) => table.id),
          stubTables: [],
        },
      ],
      sections,
    };
  }

  const plan = planSchemaChunks(input, options);
  const chunks: PromptChunk[] = plan.map((chunk) => {
    const fullSet = new Set(chunk.tableIds);
    const stubSet = new Set(chunk.stubTables);
    const artifact = buildPrompt(
      {
        ...input,
        schemaIr: subModelForChunk(model, fullSet, stubSet),
        stats: statsForChunk(input.stats, fullSet, model.defaultSchema),
        chunk: { index: chunk.index, total: chunk.total, stubTables: chunk.stubTables },
      },
      options,
    );
    const built = artifact.chunks[0];
    if (built === undefined) {
      throw new Error('chunker: buildPrompt produced no chunk artifact.');
    }
    return built;
  });

  return { chunked: true, chunks, plan, sections };
}
