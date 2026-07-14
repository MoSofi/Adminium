/**
 * Override document model + dirty-state buffer for the schema remap editor
 * (05-introspection-engine.md overrides, 07-meta-store.md §3.15).
 *
 * The op/value vocabulary below MIRRORS the server contract — the Zod shapes
 * in `apps/server/src/routes/schema/schema.ts` (`overridesPutBody`) and
 * `@adminium/meta` `overridePatchSchema` are not importable from the
 * dashboard (dep-cruiser: apps/dashboard must not depend on apps/server or
 * @adminium/meta). The contract is pinned twice: `overrides.test.ts` asserts
 * the exact document this module emits, and
 * `apps/server/test/remap-payload-contract.test.ts` re-validates the same
 * literals against the real server schemas.
 *
 * Buffer model: `baseline` (rows currently persisted, from
 * `GET /connections/:id/overrides`) + `overlay` (local edits). An overlay
 * entry of `null` deletes the baseline op; an entry deep-equal to its
 * baseline row is not a change. Save = `PUT /connections/:id/overrides` with
 * the FULL document (the route replaces the connection's override set).
 */

// --- op vocabulary (§3.15 mirror) -------------------------------------------

export const RELATION_OP_CARDINALITIES = [
  'many-to-one',
  'one-to-one',
  'one-to-many',
  'many-to-many',
] as const;
export type RelationOpCardinality = (typeof RELATION_OP_CARDINALITIES)[number];

export type RemapOverride =
  | { op: 'table.label'; tableName: string; value: { label: string; labelPlural?: string; icon?: string } }
  | { op: 'table.exclude'; tableName: string; value: { excluded: boolean } }
  | { op: 'table.keyField'; tableName: string; value: { column: string } }
  | { op: 'column.label'; tableName: string; columnName: string; value: { label: string } }
  | {
      op: 'column.semanticType';
      tableName: string;
      columnName: string;
      value: { semanticType: string; currency?: string };
    }
  | {
      op: 'column.enumLabels';
      tableName: string;
      columnName: string;
      value: { labels: Record<string, string>; tones?: Record<string, string> };
    }
  | { op: 'column.pii'; tableName: string; columnName: string; value: { masked: boolean; kind?: string } }
  | { op: 'column.hidden'; tableName: string; columnName: string; value: { hidden: boolean } }
  | {
      op: 'relation.add';
      tableName: string;
      value: { fromColumn: string; toTable: string; toColumn: string; cardinality: RelationOpCardinality };
    }
  | { op: 'relation.remove'; tableName: string; value: { fromColumn: string; toTable: string } }
  | { op: 'relation.label'; tableName: string; value: { fromColumn: string; label: string } };

export type RemapOverrideOp = RemapOverride['op'];

/** Ops that carry `columnName` in the PUT item (all others send none). */
export const COLUMN_OPS: ReadonlySet<string> = new Set([
  'column.label',
  'column.semanticType',
  'column.enumLabels',
  'column.pii',
  'column.hidden',
]);

/** One staged op + its persistence status (`disabled` rows survive a PUT). */
export interface BufferEntry {
  item: RemapOverride;
  status?: 'active' | 'disabled';
}

/** Row shape of `GET /connections/:id/overrides` (server `overrideDto`). */
export interface OverrideDto {
  id: string;
  op: string;
  tableName: string;
  columnName: string | null;
  value: Record<string, unknown>;
  origin: string;
  status: string;
  createdAt: number;
  updatedAt: number;
}

/** Item shape of the PUT document (server `overridePutItem`). */
export interface OverridePutItem {
  op: string;
  tableName: string;
  columnName?: string;
  value: Record<string, unknown>;
  status?: 'active' | 'disabled';
}

export interface OverridesPutDocument {
  overrides: OverridePutItem[];
}

// --- keying ------------------------------------------------------------------

function columnKeyPart(item: RemapOverride): string {
  if (COLUMN_OPS.has(item.op)) return (item as { columnName: string }).columnName;
  // Relation ops target a (fromColumn[, toTable]) pair on the table; several
  // may coexist per table, so the value participates in the key.
  if (item.op === 'relation.add' || item.op === 'relation.remove') {
    return `${item.value.fromColumn}->${item.value.toTable}`;
  }
  if (item.op === 'relation.label') return `${item.value.fromColumn}->`;
  return '';
}

/** Stable identity of an op target — later edits to the same target replace. */
export function overrideKey(item: RemapOverride): string {
  return `${item.op}::${item.tableName}::${columnKeyPart(item)}`;
}

// --- deep equality (small JSON payloads) --------------------------------------

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}

export function entriesEqual(a: BufferEntry | null, b: BufferEntry | null): boolean {
  if (a === null || b === null) return a === b;
  return stableStringify({ ...a.item, status: a.status ?? 'active' }) ===
    stableStringify({ ...b.item, status: b.status ?? 'active' });
}

// --- baseline / overlay -------------------------------------------------------

export type Baseline = ReadonlyMap<string, BufferEntry>;
/** `null` = delete the baseline op on save. */
export type Overlay = ReadonlyMap<string, BufferEntry | null>;

export function baselineFromRows(rows: readonly OverrideDto[]): Map<string, BufferEntry> {
  const map = new Map<string, BufferEntry>();
  for (const row of rows) {
    const item = {
      op: row.op,
      tableName: row.tableName,
      ...(row.columnName === null ? {} : { columnName: row.columnName }),
      value: row.value,
    } as RemapOverride;
    map.set(overrideKey(item), {
      item,
      ...(row.status === 'disabled' ? { status: 'disabled' as const } : {}),
    });
  }
  return map;
}

/** Stage an edit; entries equal to their baseline collapse back out. */
export function stageEntry(baseline: Baseline, overlay: Overlay, entry: BufferEntry): Map<string, BufferEntry | null> {
  const key = overrideKey(entry.item);
  const next = new Map(overlay);
  if (entriesEqual(baseline.get(key) ?? null, entry)) next.delete(key);
  else next.set(key, entry);
  return next;
}

/** Remove the op for `key` entirely (deletes a baseline row on save). */
export function dropEntry(baseline: Baseline, overlay: Overlay, key: string): Map<string, BufferEntry | null> {
  const next = new Map(overlay);
  if (baseline.has(key)) next.set(key, null);
  else next.delete(key);
  return next;
}

/** Undo the local edit for `key` (baseline row, if any, is kept). */
export function revertEntry(overlay: Overlay, key: string): Map<string, BufferEntry | null> {
  const next = new Map(overlay);
  next.delete(key);
  return next;
}

/** Effective entry for a target: overlay wins, `null` means removed. */
export function effectiveEntry(baseline: Baseline, overlay: Overlay, key: string): BufferEntry | null {
  if (overlay.has(key)) return overlay.get(key) ?? null;
  return baseline.get(key) ?? null;
}

export interface RemapChange {
  key: string;
  kind: 'add' | 'edit' | 'remove';
  next: BufferEntry | null;
  previous: BufferEntry | null;
}

/** The diff the diff-bar renders; stale overlay entries are filtered out. */
export function bufferChanges(baseline: Baseline, overlay: Overlay): RemapChange[] {
  const changes: RemapChange[] = [];
  for (const [key, next] of overlay) {
    const previous = baseline.get(key) ?? null;
    if (entriesEqual(previous, next)) continue;
    if (previous === null && next === null) continue;
    changes.push({
      key,
      kind: previous === null ? 'add' : next === null ? 'remove' : 'edit',
      next,
      previous,
    });
  }
  return changes.sort((a, b) => (a.key < b.key ? -1 : 1));
}

/**
 * The FULL document for `PUT /connections/:id/overrides` — baseline with the
 * overlay applied, deterministically ordered. `columnName` is present only
 * for column-level ops (table-level ops with a column are a server 422).
 */
export function buildPutDocument(baseline: Baseline, overlay: Overlay): OverridesPutDocument {
  const effective = new Map(baseline);
  for (const [key, entry] of overlay) {
    if (entry === null) effective.delete(key);
    else effective.set(key, entry);
  }
  const keys = [...effective.keys()].sort();
  return {
    overrides: keys.map((key) => {
      const { item, status } = effective.get(key) as BufferEntry;
      return {
        op: item.op,
        tableName: item.tableName,
        ...(COLUMN_OPS.has(item.op) ? { columnName: (item as { columnName: string }).columnName } : {}),
        value: item.value as Record<string, unknown>,
        ...(status === 'disabled' ? { status } : {}),
      };
    }),
  };
}
