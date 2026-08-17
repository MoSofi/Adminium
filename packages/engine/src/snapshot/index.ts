// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Snapshot module — 05-introspection-engine.md §9 (M3-T02 diff half /
 * 05-T09 engine side).
 *
 * The engine computes checksums and diffs; PERSISTENCE is owned by
 * `@adminium/meta` (`adminium_schema_snapshots` — 07-meta-store.md). The
 * store's dedupe rule uses `Snapshot.checksum`: identical checksum to the
 * latest snapshot → no new row, just touch `checked_at`.
 */
import type { DatabaseModel } from '../schema-model.js';
import { hashModel } from './hash.js';
import { diffModels, type DiffOptions, type SchemaDiff } from './diff.js';

export { canonicalModelJson, hashModel } from './hash.js';
export { sha256Hex } from './sha256.js';
export {
  changedTableSchema,
  diffModels,
  isEmptyDiff,
  schemaDiffSchema,
  type ChangedTable,
  type DiffOptions,
  type SchemaDiff,
} from './diff.js';

/** An in-memory snapshot: the model plus its canonical sha256 checksum. */
export interface Snapshot {
  /** sha256 hex over canonical JSON (volatile fields stripped — hash.ts). */
  checksum: string;
  model: DatabaseModel;
}

/** Build a snapshot for a model. Pure; the model is not copied or mutated. */
export function snapshotFromModel(model: DatabaseModel): Snapshot {
  return { checksum: hashModel(model), model };
}

/**
 * Diff two snapshots (FROM `a` TO `b`). Equal checksums short-circuit to an
 * empty diff without walking the models.
 */
export function diffSnapshots(a: Snapshot, b: Snapshot, options?: DiffOptions): SchemaDiff {
  if (a.checksum === b.checksum) {
    return {
      addedTables: [],
      removedTables: [],
      changedTables: {},
      relationChanges: { added: [], removed: [] },
      breaking: false,
    };
  }
  return diffModels(a.model, b.model, options);
}
