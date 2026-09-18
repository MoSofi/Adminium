// SPDX-License-Identifier: AGPL-3.0-only
/**
 * LIVE COLUMN FACTS ON THE PAGE REPLY.
 *
 * A generated page's `config.columns[]` is a SNAPSHOT of the table as it was
 * the day the page was made, and regeneration skips a page anybody has edited
 * (`skippedEdited`) — which includes merely hiding a column. So a create
 * dialog driven only by the stored spec describes a table that may have moved:
 * a column added since is missing from the form, and a NOT NULL column added
 * since makes every create fail with no way for the form to know why.
 *
 * These facts ride the reply instead, resolved per request from the active
 * snapshot and its overrides, beside the `canCreate` / `canUpdate` capabilities
 * that already work this way. **Absent means "not computed"** — the client
 * falls back to the stored spec, exactly as it does for the capabilities.
 *
 * TWO THINGS IT DELIBERATELY DOES NOT DO:
 *
 * - It does not rank or cap. `composeCrudBody` keeps a grid to eight columns,
 *   which is right for a table and wrong for a form: a column that did not
 *   make the grid still has to be settable, and today a table with fifteen
 *   optional columns offers about eight of them at create and no way at all to
 *   set the rest.
 * - It does not carry secret columns. The write path refuses them (422), so
 *   naming one here would only ever produce a field that cannot be saved.
 */

import type { MetaDb } from '@adminium/meta';
import { columnSpecsForTable, humanize, type DatabaseModel } from '@adminium/engine';
import type { GridColumnSpecInput } from '@adminium/engine/config';
import { overridesRepo, snapshotsRepo } from '@adminium/meta';

import {
  applyOverrides,
  type ColumnOptionItem,
  type ColumnValidation,
} from '../../connections/effective-schema.js';
import { tableRulesFor, type ColumnFill } from '../../crud/column-rules.js';
import { childRelations } from '../../crud/child-rows.js';
import { labelColumnFor } from '../../crud/labels.js';
import { linkableRelations } from '../../crud/links.js';
import { SnapshotView, type ResolvedTable } from '../../crud/identifiers.js';

export interface ColumnFact {
  /** The `config.columns[]` entry a regeneration would produce for it. */
  spec: Record<string, unknown>;
  /** The table's own column order (pg attnum-style; 0 when unspecified). */
  ordinal: number;
  /** False for a generated column: it is shown, never sent. */
  writable: boolean;
  /** Who puts a value here when nobody types one. */
  filledBy: 'database' | 'adminium' | null;
  fill?: { kind: string; onUpdate?: boolean; implicit?: boolean };
  /** NOT NULL (or a rule), and nothing fills it — so the dialog must ask. */
  required: boolean;
  /**
   * The answers this column accepts, when an admin fixed them with
   * `column.options` (phase C). A LIST travels as its key, never as a copy of
   * a 249-row list (D16) — the client resolves it once and caches it.
   */
  options?: { list: string } | { values: ColumnOptionItem[] };
  /** The rules an admin typed, so the dialog can check them before sending. */
  validation?: ColumnValidation;
}

/** A relation the form can offer as a field of chips. */
export interface RelationFact {
  relationId: string;
  /** The target table's label, else its humanized name — the field's name. */
  label: string;
  /** The target's snapshot id, for the picker's reads. */
  targetTable: string;
  /** The target's key column: what a chip's value IS. */
  targetKey: string;
  /**
   * The column a chip SHOWS — the same one the search palette labels a record
   * with. Without it the picker falls back to the row's first text column,
   * which for a table keyed by a code is the code itself, twice.
   */
  targetName?: string;
}

/** A table whose rows this one can hold a list of. */
export interface ChildFact {
  relationId: string;
  label: string;
  childTable: string;
  /** The child column pointing back here; the form never writes it. */
  foreignColumn: string;
  columns: ColumnFact[];
}

export interface ColumnFactsBlock {
  table: { labelSingular: string | null };
  columns: ColumnFact[];
  /**
   * The link relations this table can write through.
   *
   * Only the ones `linkableRelations` accepts — a relation whose join table
   * carries a column nobody fills is not a field, and listing it would put a
   * picker on screen that refuses every save.
   */
  relations: RelationFact[];
  /**
   * The tables whose rows this one can hold a list of — one-to-many relations
   * pointing AT this table, with the child's own columns.
   */
  children: ChildFact[];
}

/**
 * The same stamp `routes/data` rebuilds its `SnapshotView` on — the snapshot id
 * and the shape of the active override set — so a rule added in Studio shows up
 * on the very next page read, and an unchanged connection classifies once.
 */
interface CacheEntry {
  stamp: string;
  view: SnapshotView;
  facts: Map<string, ColumnFactsBlock>;
}

const CACHE = new Map<string, CacheEntry>();

function fillFactOf(fill: ColumnFill | undefined): Pick<ColumnFact, 'filledBy' | 'fill'> {
  if (fill === undefined || fill.kind === 'none') return { filledBy: null };
  if (fill.kind === 'database') return { filledBy: 'database', fill: { kind: 'database' } };
  return {
    filledBy: 'adminium',
    fill: { kind: fill.kind, onUpdate: fill.onUpdate, implicit: fill.implicit },
  };
}

/** The writable columns of one table, as the form reads them. */
function columnsOf(view: SnapshotView, table: ResolvedTable): ColumnFact[] {
  return blockFor(view, table, { deep: false }).columns;
}

function blockFor(
  view: SnapshotView,
  table: ResolvedTable,
  options: { deep?: boolean } = {},
): ColumnFactsBlock {
  const specs = columnSpecsForTable(view.model as unknown as DatabaseModel, table.table);
  const specByName = new Map<string, GridColumnSpecInput>(specs.map((spec) => [spec.name, spec]));
  const rules = tableRulesFor({ view, table });
  const fillByColumn = new Map((rules?.fills ?? []).map((fill) => [fill.column, fill]));
  const columns: ColumnFact[] = [];
  for (const column of table.table.columns) {
    const resolved = table.columns.get(column.name);
    if (resolved === undefined || resolved.secret) continue;
    const spec = specByName.get(column.name);
    if (spec === undefined) continue;
    const fill = fillFactOf(fillByColumn.get(column.name));
    // A column the DATABASE fills — a DEFAULT, an identity, a generated
    // expression — is never asked for, and neither is one Adminium fills.
    const filledBy =
      fill.filledBy ?? (column.default !== null || column.isGenerated ? 'database' : null);
    columns.push({
      spec: spec as unknown as Record<string, unknown>,
      ordinal: column.ordinal,
      writable: !column.isGenerated,
      filledBy,
      ...(fill.fill === undefined ? {} : { fill: fill.fill }),
      /*
       * Required to the DIALOG, which is a different question from required to
       * the database: a NOT NULL column something fills is nobody's business,
       * and an admin's `column.required` on a nullable column is still a field
       * the person must answer (D26).
       */
      required:
        filledBy === null &&
        !column.isGenerated &&
        (!column.nullable || column.requiredByRule === true),
      ...(column.options === undefined ? {} : { options: column.options }),
      ...(column.validation === undefined ? {} : { validation: column.validation }),
    });
  }
  columns.sort((a, b) => a.ordinal - b.ordinal);
  const relations = linkableRelations(view, table).map((link) => {
    const name = labelColumnFor(view, link.target);
    return {
      relationId: link.relationId,
      label: link.target.table.label ?? humanize(link.target.name),
      targetTable: link.target.id,
      targetKey: link.targetKeyColumn,
      ...(name === null || name === link.targetKeyColumn ? {} : { targetName: name }),
    };
  });
  /*
   * The tables whose rows this one can hold a LIST of — an invoice's lines.
   * Their columns ride along, because a repeater edits real columns and has to
   * know what they are; reading them from a second page's reply would make a
   * line-items field depend on a page existing for the child table.
   *
   * `deep: false` stops the recursion at one level: a child's own children are
   * not a dialog's business, and a self-referential table would otherwise
   * describe itself forever.
   */
  const children =
    options.deep === false
      ? []
      : childRelations(view, table).map((child) => ({
          relationId: child.relationId,
          label: child.child.table.label ?? humanize(child.child.name),
          childTable: child.child.id,
          foreignColumn: child.foreignColumn,
          columns: columnsOf(view, child.child),
        }));
  return { table: { labelSingular: table.table.label ?? null }, columns, relations, children };
}

/**
 * The facts for one table, or `null` when there is nothing to say — no
 * snapshot yet, or a table the snapshot does not address (a system table, an
 * excluded one, one that has been dropped since the page was generated). Every
 * one of those is a page the client should keep rendering from its stored
 * spec, so the block is simply absent rather than an error.
 */
export async function columnFactsFor(
  meta: MetaDb,
  connectionId: string,
  tableName: string,
): Promise<ColumnFactsBlock | null> {
  const snapshot = await snapshotsRepo(meta).latest(connectionId);
  if (snapshot === null) return null;
  const active = await overridesRepo(meta).listForConnection(connectionId, { status: 'active' });
  const last = active.at(-1);
  const stamp = `${snapshot.id}:${String(active.length)}:${last?.id ?? ''}:${String(last?.updatedAt ?? 0)}`;
  let entry = CACHE.get(connectionId);
  if (entry === undefined || entry.stamp !== stamp) {
    entry = {
      stamp,
      view: new SnapshotView(connectionId, applyOverrides(snapshot.schema as DatabaseModel, active)),
      facts: new Map(),
    };
    CACHE.set(connectionId, entry);
  }
  const cached = entry.facts.get(tableName);
  if (cached !== undefined) return cached;
  let table: ResolvedTable;
  try {
    table = entry.view.table(tableName);
  } catch {
    return null;
  }
  const block = blockFor(entry.view, table);
  entry.facts.set(tableName, block);
  return block;
}
