// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Design buffer — the desired-state document the user is editing.
 *
 * ─── Why this is a SEPARATE buffer from the remap one ──────────────────────
 *
 * `useRemapBuffer` holds override rows: reversible annotations, saved by a
 * full-document `PUT` that replaces them all. This holds a desired SCHEMA:
 * irreversible structure, applied through plan → review → confirm.
 *
 * The first trap is exactly the failure of merging them — one Save button
 * that silently mixes "call this Customers" with "drop this column". Two
 * buffers, two verbs, two confirmations. They share a page and nothing else.
 */
import { useCallback, useMemo, useState } from 'react';

import type { DesiredColumn, DesiredForeignKey, DesiredTable, SchemaEdit } from './types.js';

export interface DesignBuffer {
  /** Tables being created or altered, by their id (or name, when new). */
  upserts: Map<string, DesiredTable>;
  /** Table ids to drop. */
  drops: Set<string>;
  renames: { tables: { from: string; to: string }[]; columns: { table: string; from: string; to: string }[] };
  dirty: boolean;
  changeCount: number;
  upsert(key: string, table: DesiredTable): void;
  discard(key: string): void;
  drop(tableId: string, drop: boolean): void;
  renameTable(from: string, to: string | null): void;
  clear(): void;
  /** The document the plan and apply routes take. */
  buildEdit(baseSnapshotId: string): SchemaEdit;
}

/**
 * The buffer's key for a table.
 *
 * An EXISTING table is keyed by its id, which never changes. A NEW one cannot
 * be — it has no id — and it must not be keyed by its NAME: the name is the
 * thing being typed. Keying on it meant every keystroke staged another table,
 * so typing "notes" left `new:n`, `new:no`, `new:not`, `new:note` and
 * `new:notes` in the buffer and Apply would have created all five.
 *
 * So a new table gets a stable local key at the moment it is created
 * ({@link newTableKey}) and keeps it for as long as it is staged. The key is
 * UI state and never reaches the wire.
 */
export const keyOfExisting = (tableId: string): string => tableId;

let localCounter = 0;
/** A stable key for a table that does not exist yet. */
export function newTableKey(): string {
  localCounter += 1;
  return `new:${localCounter}`;
}

export function useDesignBuffer(): DesignBuffer {
  const [upserts, setUpserts] = useState<Map<string, DesiredTable>>(new Map());
  const [drops, setDrops] = useState<Set<string>>(new Set());
  const [tableRenames, setTableRenames] = useState<Map<string, string>>(new Map());

  const upsert = useCallback((key: string, table: DesiredTable) => {
    setUpserts((prev) => new Map(prev).set(key, table));
  }, []);

  const discard = useCallback((key: string) => {
    setUpserts((prev) => {
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const drop = useCallback((tableId: string, shouldDrop: boolean) => {
    setDrops((prev) => {
      const next = new Set(prev);
      if (shouldDrop) next.add(tableId);
      else next.delete(tableId);
      return next;
    });
  }, []);

  const renameTable = useCallback((from: string, to: string | null) => {
    setTableRenames((prev) => {
      const next = new Map(prev);
      if (to === null || to === '') next.delete(from);
      else next.set(from, to);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setUpserts(new Map());
    setDrops(new Set());
    setTableRenames(new Map());
  }, []);

  const renames = useMemo(
    () => ({
      tables: [...tableRenames.entries()].map(([from, to]) => ({ from, to })),
      // Column renames are authored inside the table designer and travel as
      // part of the desired columns; an explicit column-rename intent is a
      // later refinement (the planner already accepts them).
      columns: [] as { table: string; from: string; to: string }[],
    }),
    [tableRenames],
  );

  const changeCount = upserts.size + drops.size + renames.tables.length;

  const buildEdit = useCallback(
    (baseSnapshotId: string): SchemaEdit => ({
      baseSnapshotId,
      renames,
      /*
       * An EMPTIED value list means "stop constraining this column", and the
       * wire says that by not carrying the column at all — the planner then
       * sees a check in the database and none in the desired table, and plans
       * the drop. Sending `[]` instead is refused by the gate (`min(1)`), so
       * the one way to remove a constraint would have been a 422.
       */
      upsertTables: [...upserts.values()].map((table) => ({
        ...table,
        enumValues: Object.fromEntries(
          Object.entries(table.enumValues).filter(([, values]) => values.length > 0),
        ),
      })),
      dropTables: [...drops],
    }),
    [renames, upserts, drops],
  );

  return {
    upserts,
    drops,
    renames,
    dirty: changeCount > 0,
    changeCount,
    upsert,
    discard,
    drop,
    renameTable,
    clear,
    buildEdit,
  };
}

/** A blank table, ready for the designer. */
/**
 * A brand-new table, UNNAMED.
 *
 * It used to arrive pre-filled with `new_table`, and a real value in a field a
 * person is about to type into is a trap: clicking it puts the caret where you
 * clicked, so typing "reservations" produces `new_tablereservations`. Verified
 * in a browser — the plan offered to create exactly that. The prompt belongs in
 * a `placeholder`, which cannot be submitted by accident.
 */
export function blankTable(name = ''): DesiredTable {
  return {
    id: null,
    schema: null,
    name,
    comment: null,
    // Every new table starts with a generated integer key: D31's default, and
    // the only shape the CRUD insert path can read back on all three dialects.
    columns: [
      {
        name: 'id',
        logicalType: 'integer',
        nullable: false,
        default: { kind: 'autoincrement' },
        maxLength: null,
        numericPrecision: null,
        numericScale: null,
        comment: null,
      },
    ],
    primaryKey: ['id'],
    uniques: [],
    indexes: [],
    foreignKeys: [],
    enumValues: {},
  };
}

/** A blank column, for the designer's "Add column". */
/** A new column, unnamed for the same reason as {@link blankTable}. */
export function blankColumn(name = ''): DesiredColumn {
  return {
    name,
    logicalType: 'text',
    nullable: true,
    default: null,
    maxLength: null,
    numericPrecision: null,
    numericScale: null,
    comment: null,
  };
}

/**
 * An existing table, as the designer needs it.
 *
 * ─── The bug this replaces ─────────────────────────────────────────────────
 *
 * Clicking an existing table used to stage `blankTable(name)` with the real
 * table's id attached. A blank table has ONE column, so the planner diffed a
 * one-column table against the real one and proposed dropping **every other
 * column**. On `clients` that was a plan to destroy the whole table's contents,
 * offered to somebody who had clicked its name to add a field.
 *
 * The guards behaved correctly around it — each drop was marked "Discards
 * data", gated on Super Admin, and listed the pages it would break — but a
 * correct confirmation of an insane plan is still an insane plan. The fix is to
 * load what is actually there.
 *
 * ─── What does not round-trip, and why that is stated rather than hidden ────
 *
 * A default the designer's closed vocabulary cannot express (D30 admits five
 * kinds; a database `expression` default is not one) is dropped from the staged
 * copy and reported by {@link unsupportedColumnNotes}, because leaving it in
 * would send the client a value it cannot author and the gate would refuse.
 * Saying so beats a form that silently forgets a default.
 */
export interface ModelColumn {
  name: string;
  logicalType: string;
  nullable: boolean;
  default: { kind: string; text?: string } | null;
  maxLength: number | null;
  numericPrecision: number | null;
  numericScale: number | null;
  comment: string | null;
}

export interface ModelTable {
  id: string;
  schema: string;
  name: string;
  comment: string | null;
  columns: ModelColumn[];
  primaryKey: string[];
  uniques: { name: string | null; columns: string[] }[];
  indexes: { name: string; columns: string[]; unique: boolean; primary: boolean }[];
}

export interface ModelRelation {
  kind: string;
  from: { tableId: string; columns: string[] };
  to: { tableId: string; columns: string[] };
  onDelete: string | null;
  onUpdate: string | null;
  constraintName: string | null;
}

/** The five default kinds the designer can author (D30). */
const AUTHORABLE_DEFAULT_KINDS = new Set(['literal', 'now', 'uuid', 'autoincrement']);

/** Convert a snapshot table into an editable `DesiredTable`. */
export function modelTableToDesired(
  table: ModelTable,
  relations: readonly ModelRelation[] = [],
  enumValues: Readonly<Record<string, string[]>> = {},
): DesiredTable {
  return {
    id: table.id,
    schema: table.schema,
    name: table.name,
    comment: table.comment,
    columns: table.columns.map((column) => ({
      name: column.name,
      logicalType: column.logicalType as DesiredTable['columns'][number]['logicalType'],
      nullable: column.nullable,
      default:
        column.default !== null && AUTHORABLE_DEFAULT_KINDS.has(column.default.kind)
          ? (column.default as DesiredTable['columns'][number]['default'])
          : null,
      maxLength: column.maxLength,
      numericPrecision: column.numericPrecision,
      numericScale: column.numericScale,
      comment: column.comment,
    })),
    primaryKey: [...table.primaryKey],
    uniques: table.uniques.map((u) => ({ name: u.name, columns: [...u.columns] })),
    // The primary key's own index is the key's business, not the index list's —
    // including it would make the designer propose dropping and re-adding it.
    indexes: table.indexes
      .filter((i) => !i.primary)
      .map((i) => ({ name: i.name, columns: [...i.columns], unique: i.unique })),
    foreignKeys: relations
      .filter((r) => r.kind === 'declared-fk' && r.from.tableId === table.id)
      .map((r) => ({
        name: r.constraintName,
        columns: [...r.from.columns],
        toTable: r.to.tableId,
        toColumns: [...r.to.columns],
        onDelete: (r.onDelete ?? null) as DesiredForeignKey['onDelete'],
        onUpdate: (r.onUpdate ?? null) as DesiredForeignKey['onUpdate'],
      })),
    enumValues: { ...enumValues },
  };
}

/** What could not be represented, so the UI can say so instead of losing it. */
export function unsupportedColumnNotes(table: ModelTable): string[] {
  return table.columns
    .filter((c) => c.default !== null && !AUTHORABLE_DEFAULT_KINDS.has(c.default.kind))
    .map((c) => c.name);
}
