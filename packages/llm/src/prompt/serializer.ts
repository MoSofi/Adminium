// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Schema IR + statistics serialization for the prompt (06-llm-assist.md §4.1,
 * §4.2, §5.2).
 *
 * Three producers, mapping onto the three `=== INPUT: … ===` blocks of the user
 * section:
 *   - {@link serializeSchemaIr}  → `{{SCHEMA_IR_JSON}}`  (structure only)
 *   - {@link serializeStats}     → `{{STATS_JSON}}`      (aggregates only)
 *   - {@link serializeSampling}  → `{{SAMPLING_BLOCK}}`  (opt-in cell values)
 *
 * SAMPLE-FREE BY DEFAULT (§1 invariant 5, acceptance criterion 8): with sampling
 * off, NO cell value from any table can appear. The schema IR carries only
 * structure (types, flags, DECLARED enum values — which are schema, not data);
 * the stats block carries only row counts, null fractions and distinct counts —
 * it NEVER copies `min`/`max`/`sampleValues` off a `StatsResult`. Cell values
 * live exclusively in the sampling block, which is empty unless the caller opts
 * in, and even then excludes PII-suspected and secret columns.
 *
 * Deterministic: objects are built in a fixed key order and arrays follow input
 * order, so `JSON.stringify` output is stable (no sorting, no timestamps).
 */
import type {
  Cardinality,
  ColumnModel,
  DatabaseModel,
  Dialect,
  LogicalType,
  StatsResult,
  StatsScalar,
  TableRef,
  TableRole,
} from '@adminium/engine';

import type { Sampling } from './types.js';

/** Text columns with `distinctCount` at or below this are pseudo-enum candidates (§4.2). */
export const PSEUDO_ENUM_MAX_DISTINCT = 24;

/** Header line the opt-in sampling block leads with (§5.2 builder note). */
export const SAMPLING_BLOCK_HEADER =
  '=== INPUT: SAMPLE VALUES (user opted in; PII columns excluded) ===';

// ─── Serialized shapes ───────────────────────────────────────────────────────

export interface SerializedColumn {
  column: string;
  type: LogicalType;
  nullable: boolean;
  primaryKey?: true;
  unique?: true;
  /** `EnumDef.id` when the column is enum-typed (values listed under `enumColumns`). */
  enum?: string;
  /** Declared FK target as `"schema.table.column"`. */
  references?: string;
  /** Heuristic PII suspicion — the model confirms/rejects (§4.2, decision 8). */
  piiSuspected?: true;
  /** Secret column — never contributes any value-touching statistic. */
  secret?: true;
  /** Low-cardinality non-PII text: values sent only under sampling opt-in (§4.2). */
  pseudoEnumCandidate?: true;
}

export interface SerializedFullTable {
  table: string;
  role?: TableRole;
  columns: SerializedColumn[];
}

/** Out-of-chunk FK target: names only, no suggestions requested (§4.5). */
export interface SerializedStubTable {
  table: string;
  stub: true;
  columns: string[];
}

export type SerializedTable = SerializedFullTable | SerializedStubTable;

export interface SerializedEnumColumn {
  table: string;
  column: string;
  values: string[];
}

export interface SerializedDeclaredRelation {
  fromTable: string;
  fromColumns: string[];
  toTable: string;
  toColumns: string[];
  cardinality: Cardinality;
}

export interface SerializedSchemaIr {
  database: { name: string; dialect: Dialect; defaultSchema: string };
  tables: SerializedTable[];
  enumColumns: SerializedEnumColumn[];
  declaredRelations: SerializedDeclaredRelation[];
}

export interface SerializedColumnStats {
  column: string;
  nullFraction: number | null;
  distinctCount: number | null;
}

export interface SerializedTableStats {
  table: string;
  rowCountEstimate: number | null;
  rowCountExact: boolean;
  columns: SerializedColumnStats[];
}

export interface SerializedStats {
  tables: SerializedTableStats[];
}

export interface SerializedSampleColumn {
  column: string;
  min?: StatsScalar;
  max?: StatsScalar;
  sampleValues?: StatsScalar[];
}

export interface SerializedSampleTable {
  table: string;
  columns: SerializedSampleColumn[];
}

export interface SerializedSampling {
  tables: SerializedSampleTable[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Compact, deterministic JSON for injection into the prompt. */
export function toPromptJson(value: unknown): string {
  return JSON.stringify(value);
}

/** `TableRef` → the model's qualified `"schema.table"` id (mysql/sqlite have a null schema). */
export function qualifyTableRef(ref: TableRef, defaultSchema: string): string {
  return `${ref.schema ?? defaultSchema}.${ref.name}`;
}

function statsKey(tableId: string, column: string): string {
  return `${tableId}\x00${column}`;
}

/** `(tableId, column) → distinctCount | null`, built from the stats. */
function distinctCountLookup(
  stats: readonly StatsResult[],
  defaultSchema: string,
): (tableId: string, column: string) => number | null {
  const map = new Map<string, number | null>();
  for (const result of stats) {
    const tableId = qualifyTableRef(result.table, defaultSchema);
    for (const column of result.columns) {
      map.set(statsKey(tableId, column.column), column.distinctCount);
    }
  }
  return (tableId, column) => map.get(statsKey(tableId, column)) ?? null;
}

/** `(tableId, column) → true` for PII-suspected or secret columns (never sampled). */
function sensitiveColumnLookup(
  model: DatabaseModel,
): (tableId: string, column: string) => boolean {
  const set = new Set<string>();
  for (const table of model.tables) {
    for (const column of table.columns) {
      if (isPiiSuspected(column) || isSecret(column)) {
        set.add(statsKey(table.id, column.name));
      }
    }
  }
  return (tableId, column) => set.has(statsKey(tableId, column));
}

function isPiiSuspected(column: ColumnModel): boolean {
  return (column.semantics?.flags.pii ?? null) !== null;
}

function isSecret(column: ColumnModel): boolean {
  return column.semantics?.flags.secret ?? false;
}

// ─── Schema IR (structure only — never cell values) ─────────────────────────

export interface SerializeSchemaIrOptions {
  /** Qualified ids to render as `"stub": true` context (§4.5). */
  stubTables?: ReadonlySet<string>;
  /** Stats used solely to compute `pseudoEnumCandidate` (distinct-count driven). */
  stats?: readonly StatsResult[];
}

export function serializeSchemaIr(
  model: DatabaseModel,
  options: SerializeSchemaIrOptions = {},
): SerializedSchemaIr {
  const stubs = options.stubTables ?? new Set<string>();
  const distinctCount = distinctCountLookup(options.stats ?? [], model.defaultSchema);
  const enumValues = new Map(model.enums.map((def) => [def.id, def.values]));

  const tables: SerializedTable[] = model.tables.map((table) => {
    if (stubs.has(table.id)) {
      return { table: table.id, stub: true, columns: table.columns.map((c) => c.name) };
    }
    const role = table.semantics?.role;
    return {
      table: table.id,
      ...(role !== undefined ? { role } : {}),
      columns: table.columns.map((column) =>
        serializeColumn(column, distinctCount(table.id, column.name)),
      ),
    };
  });

  const enumColumns: SerializedEnumColumn[] = [];
  for (const table of model.tables) {
    if (stubs.has(table.id)) continue;
    for (const column of table.columns) {
      if (column.enumRef === null) continue;
      const values = enumValues.get(column.enumRef);
      if (values === undefined) continue;
      enumColumns.push({ table: table.id, column: column.name, values: [...values] });
    }
  }

  const declaredRelations: SerializedDeclaredRelation[] = model.relations
    .filter((relation) => relation.kind === 'declared-fk')
    .map((relation) => ({
      fromTable: relation.from.tableId,
      fromColumns: [...relation.from.columns],
      toTable: relation.to.tableId,
      toColumns: [...relation.to.columns],
      cardinality: relation.cardinality,
    }));

  return {
    database: { name: model.name, dialect: model.dialect, defaultSchema: model.defaultSchema },
    tables,
    enumColumns,
    declaredRelations,
  };
}

function serializeColumn(column: ColumnModel, distinctCount: number | null): SerializedColumn {
  const pii = isPiiSuspected(column);
  const secret = isSecret(column);
  const isText = column.logicalType === 'text' || column.logicalType === 'varchar';
  const pseudoEnum =
    isText &&
    !pii &&
    !secret &&
    column.enumRef === null &&
    distinctCount !== null &&
    distinctCount <= PSEUDO_ENUM_MAX_DISTINCT;

  return {
    column: column.name,
    type: column.logicalType,
    nullable: column.nullable,
    ...(column.isPrimaryKey ? { primaryKey: true } : {}),
    ...(column.isUnique ? { unique: true } : {}),
    ...(column.enumRef !== null ? { enum: column.enumRef } : {}),
    ...(column.references !== null
      ? { references: `${column.references.tableId}.${column.references.column}` }
      : {}),
    ...(pii ? { piiSuspected: true } : {}),
    ...(secret ? { secret: true } : {}),
    ...(pseudoEnum ? { pseudoEnumCandidate: true } : {}),
  };
}

// ─── Statistics (aggregates only) ────────────────────────────────────────────

export interface SerializeStatsOptions {
  /** Qualified-id fallback schema for null-schema dialects. Defaults to `"public"`. */
  defaultSchema?: string;
}

/**
 * Format `StatsResult[]` into the aggregates-only stats block. Deliberately
 * copies ONLY row counts, null fractions and distinct counts — never `min`,
 * `max` or `sampleValues`, which are cell values and belong to the opt-in
 * sampling block. This is what guarantees the sample-free default at the stats
 * layer regardless of what the adapter happened to collect.
 */
export function serializeStats(
  stats: readonly StatsResult[],
  options: SerializeStatsOptions = {},
): SerializedStats {
  const defaultSchema = options.defaultSchema ?? 'public';
  return {
    tables: stats.map((result) => ({
      table: qualifyTableRef(result.table, defaultSchema),
      rowCountEstimate: result.rowCountEstimate,
      rowCountExact: result.rowCountExact,
      columns: result.columns.map((column) => ({
        column: column.column,
        nullFraction: column.nullFraction,
        distinctCount: column.distinctCount,
      })),
    })),
  };
}

// ─── Sampling block (opt-in; the ONLY place cell values appear) ──────────────

/**
 * Build the `{{SAMPLING_BLOCK}}` text. Returns `''` when `sampling` is null
 * (sample-free default). When opted in, renders the header plus a JSON object of
 * per-column `min`/`max`/`sampleValues` — EXCLUDING every PII-suspected or
 * secret column (looked up from the model), and truncating each column's value
 * list to `sampling.maxValuesPerColumn`.
 */
export function serializeSampling(
  model: DatabaseModel,
  stats: readonly StatsResult[],
  sampling: Sampling,
): string {
  if (sampling === null) return '';
  const payload = serializeSamplingPayload(model, stats, sampling.maxValuesPerColumn);
  return `${SAMPLING_BLOCK_HEADER}\n${toPromptJson(payload)}`;
}

export function serializeSamplingPayload(
  model: DatabaseModel,
  stats: readonly StatsResult[],
  maxValuesPerColumn: number,
): SerializedSampling {
  const isSensitive = sensitiveColumnLookup(model);
  const tables: SerializedSampleTable[] = [];

  for (const result of stats) {
    const tableId = qualifyTableRef(result.table, model.defaultSchema);
    const columns: SerializedSampleColumn[] = [];
    for (const column of result.columns) {
      if (isSensitive(tableId, column.column)) continue;
      const hasMin = column.min !== undefined;
      const hasMax = column.max !== undefined;
      const values = column.sampleValues;
      const hasValues = values !== undefined && values.length > 0;
      if (!hasMin && !hasMax && !hasValues) continue;
      columns.push({
        column: column.column,
        ...(hasMin ? { min: column.min } : {}),
        ...(hasMax ? { max: column.max } : {}),
        ...(hasValues ? { sampleValues: values.slice(0, maxValuesPerColumn) } : {}),
      });
    }
    if (columns.length > 0) tables.push({ table: tableId, columns });
  }

  return { tables };
}
