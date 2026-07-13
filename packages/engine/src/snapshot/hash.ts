/**
 * Canonical model JSON + sha256 — 05-introspection-engine.md §9.
 *
 * `model_hash` in `adminium_schema_snapshots` is "sha256 over canonical
 * JSON: sorted keys, stripped volatile fields
 * introspectedAt/stats/warnings/rowCountEstimate/activity/sizeBytes".
 * Identical hash to the latest snapshot → the meta-store writes no new row.
 *
 * Beyond the doc's letter we also sort the model's collection arrays by
 * their stable keys (tables/relations/enums by id, columns/indexes by name)
 * so two introspections that enumerate the catalog in a different order
 * still hash identically.
 */
import type { DatabaseModel } from '../schema-model.js';
import { sha256Hex } from './sha256.js';

/** Top-level fields stripped before hashing (§9). */
const VOLATILE_MODEL_FIELDS = ['introspectedAt', 'stats', 'warnings'] as const;
/** Per-table fields stripped before hashing (§9). */
const VOLATILE_TABLE_FIELDS = ['rowCountEstimate', 'activity', 'sizeBytes'] as const;

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortKeysDeep(record[key]);
    }
    return sorted;
  }
  return value;
}

const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

/**
 * The canonical (hash-input) JSON string for a model: volatile fields
 * stripped, keys sorted, collections sorted by stable key. Pure — the input
 * model is never mutated (operates on a deep clone).
 */
export function canonicalModelJson(model: DatabaseModel): string {
  const plain = JSON.parse(JSON.stringify(model)) as Record<string, unknown>;
  for (const field of VOLATILE_MODEL_FIELDS) delete plain[field];

  const tables = (plain['tables'] ?? []) as (Record<string, unknown> & { id: string })[];
  for (const table of tables) {
    for (const field of VOLATILE_TABLE_FIELDS) delete table[field];
    (table['columns'] as { name: string }[] | undefined)?.sort(byName);
    (table['indexes'] as { name: string }[] | undefined)?.sort(byName);
  }
  tables.sort(byId);
  (plain['relations'] as { id: string }[] | undefined)?.sort(byId);
  (plain['enums'] as { id: string }[] | undefined)?.sort(byId);
  (plain['schemas'] as string[] | undefined)?.sort();

  return JSON.stringify(sortKeysDeep(plain));
}

/** sha256 hex digest of {@link canonicalModelJson}. */
export function hashModel(model: DatabaseModel): string {
  return sha256Hex(canonicalModelJson(model));
}
