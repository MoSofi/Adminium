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

import { readerWords } from '../../i18n/bcp47.js';
import type { MetaDb } from '@adminium/meta';
import type { TablePrivilegeMap } from '@adminium/engine/adapter';
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
import { columnGranted, privilegesOf } from '../../connections/privileges.js';
import { readViewOf } from '../../crud/read-view.js';
import { loadSnapshotView } from '../../data-io/snapshot-view.js';
import type { ReadLimits } from '../../rbac/read-limits.js';

export interface ColumnFact {
  /** The `config.columns[]` entry a regeneration would produce for it. */
  spec: Record<string, unknown>;
  /** The table's own column order (pg attnum-style; 0 when unspecified). */
  ordinal: number;
  /** False for a generated column: it is shown, never sent. */
  writable: boolean;
  /**
   * Whether a new record may set it, and an edit change it, as the
   * connection's role is GRANTED (`GRANT UPDATE (body) ON …`). Absent when the
   * grants are not known: `writable` alone answers.
   */
  insertable?: boolean;
  updatable?: boolean;
  /** Who puts a value here when nobody types one. */
  filledBy: 'database' | 'adminium' | null;
  fill?: { kind: string; onUpdate?: boolean; implicit?: boolean };
  /** NOT NULL (or a rule), and nothing fills it — so the dialog must ask. */
  required: boolean;
  /**
   * Asked for only while another column of the row holds one of `in`
   * (`column.requiredWhen`): the dialog marks the field required as the
   * person picks that value, and the server refuses the write otherwise.
   */
  requiredWhen?: { column: string; in: (string | number | boolean)[] };
  /**
   * The answers this column accepts, when an admin fixed them with
   * `column.options` (phase C). A LIST travels as its key, never as a copy of
   * a 249-row list (D16) — the client resolves it once and caches it. Inline
   * values carry their words in the reader's language.
   */
  options?: { list: string } | { values: ColumnOptionItem[] };
  /** The rules an admin typed, so the dialog can check them before sending. */
  validation?: ColumnValidation;
  /** What a person calls each of an enum's values ("Pick one" for `radio`), in the reader's language. */
  enumLabels?: Record<string, string>;
  /**
   * Each value's badge tone, as the app or the operator set it. With the
   * labels, what a list draws a status in when the page stores none of its own.
   */
  enumTones?: Record<string, string>;
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
  /** What the linked table is called, in the reader's language ("Visit types"), for the picker. */
  targetLabel?: string;
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
  table: { labelSingular: string | null; labelPlural: string | null };
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
    // The column's own name for a person — the operator's rename, or the one
    // its app installed in the reader's language — over the humanized one.
    const label = (column as { label?: string }).label;
    // A reference names its table as a person does ("Categories"), where it has a name.
    const target = spec.fk === undefined ? undefined : view.model.tables.find((t) => t.id === spec.fk?.table);
    const targetName = target === undefined ? undefined : (target.labelPlural ?? target.label);
    const named = {
      ...spec,
      ...(label === undefined ? {} : { label }),
      ...(spec.fk === undefined || targetName === undefined ? {} : { fk: { ...spec.fk, label: targetName } }),
    };
    columns.push({
      spec: named as unknown as Record<string, unknown>,
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
      ...(column.requiredWhen === undefined || filledBy !== null || column.isGenerated
        ? {}
        : { requiredWhen: { column: column.requiredWhen.column, in: [...column.requiredWhen.in] } }),
      ...(column.options === undefined ? {} : { options: column.options }),
      ...(column.validation === undefined ? {} : { validation: column.validation }),
      ...(column.enumLabels === undefined ? {} : { enumLabels: column.enumLabels }),
      ...(column.enumTones === undefined ? {} : { enumTones: column.enumTones }),
    });
  }
  columns.sort((a, b) => a.ordinal - b.ordinal);
  const relations = linkableRelations(view, table).map((link) => {
    const name = labelColumnFor(view, link.target);
    // A field of links holds several: it is called by the linked table's plural.
    const called = link.target.table.labelPlural ?? link.target.table.label;
    return {
      relationId: link.relationId,
      label: called ?? humanize(link.target.name),
      targetTable: link.target.id,
      targetKey: link.targetKeyColumn,
      ...(name === null || name === link.targetKeyColumn ? {} : { targetName: name }),
      ...(called === undefined ? {} : { targetLabel: called }),
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
  return {
    table: { labelSingular: table.table.label ?? null, labelPlural: table.table.labelPlural ?? table.table.label ?? null },
    columns,
    relations,
    children,
  };
}

/** The connection's tables as they stand now, labels in one reader's language; kept until a snapshot or a rule moves. */
async function entryFor(meta: MetaDb, connectionId: string, locale: string | undefined): Promise<CacheEntry | null> {
  const snapshot = await snapshotsRepo(meta).latest(connectionId);
  if (snapshot === null) return null;
  const active = await overridesRepo(meta).listForConnection(connectionId, { status: 'active' });
  const last = active.at(-1);
  const stamp = `${snapshot.id}:${String(active.length)}:${last?.id ?? ''}:${String(last?.updatedAt ?? 0)}`;
  // One view per locale: the labels in it are resolved for that reader.
  const cacheKey = `${connectionId}\u0000${locale ?? ''}`;
  let entry = CACHE.get(cacheKey);
  if (entry === undefined || entry.stamp !== stamp) {
    entry = {
      stamp,
      view: new SnapshotView(
        connectionId,
        applyOverrides(snapshot.schema as DatabaseModel, active, locale === undefined ? {} : { defaultLocale: locale }),
      ),
      facts: new Map(),
    };
    CACHE.set(cacheKey, entry);
  }
  return entry;
}

/**
 * The same tables for another reader of the page's facts (the record page's
 * buttons): one view per connection and language, never built twice.
 */
export async function factsViewFor(meta: MetaDb, connectionId: string, locale?: string): Promise<SnapshotView | null> {
  return (await entryFor(meta, connectionId, locale))?.view ?? null;
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
  /**
   * The reader's locale (`de_DE`): a label an app ships in every language it
   * speaks is read in theirs. Absent, labels resolve to en_US.
   */
  locale?: string,
  /**
   * What the connection's role may write (`ConnectionManager.tablePrivileges`).
   * Applied to a copy on every read, never cached with the block: a GRANT is
   * not a schema change.
   */
  rights?: TablePrivilegeMap | null,
  /**
   * The reader's limited reads (their role reads a table only in part): the
   * columns it does not show are left out of the facts, a list's too — a form
   * never shows, nor asks for, a column the person may not read.
   */
  read?: { superAdmin?: boolean; readLimits?: ReadLimits | undefined } | undefined,
): Promise<ColumnFactsBlock | null> {
  const entry = await entryFor(meta, connectionId, locale);
  if (entry === null) return null;
  const cached = entry.facts.get(tableName);
  if (cached !== undefined) return readable(granted(cached, entry.view.table(tableName).id, rights ?? null), entry.view, entry.view.table(tableName).id, read);
  let table: ResolvedTable;
  try {
    table = entry.view.table(tableName);
  } catch {
    return null;
  }
  const block = blockFor(entry.view, table);
  entry.facts.set(tableName, block);
  return readable(granted(block, table.id, rights ?? null), entry.view, table.id, read);
}

/** The block without the columns the reader's role does not read (a copy; the cached block is everyone's). */
function readable(block: ColumnFactsBlock, view: SnapshotView, tableId: string, read: Parameters<typeof readViewOf>[1] | undefined): ColumnFactsBlock {
  if (read === undefined) return block;
  const limited = readViewOf(view, read);
  if (!limited.readLimited) return block;
  const shown = (id: string, columns: ColumnFact[]): ColumnFact[] => {
    const table = limited.linkTable(id);
    return table === null ? columns : columns.filter((column) => table.columns.get(String(column.spec['name']))?.unreadable !== true);
  };
  return {
    ...block,
    columns: shown(tableId, block.columns),
    children: block.children.map((child) => ({ ...child, columns: shown(child.childTable, child.columns) })),
  };
}

/** Each column's grants, on a copy of the block (its children too). */
function granted(block: ColumnFactsBlock, tableId: string, rights: TablePrivilegeMap | null): ColumnFactsBlock {
  if (rights === null) return block;
  const withGrants = (id: string, columns: ColumnFact[]): ColumnFact[] => {
    const table = privilegesOf(rights, id);
    if (table === null) return columns;
    return columns.map((column) => {
      const name = String(column.spec['name']);
      return {
        ...column,
        insertable: column.writable && columnGranted(table, name, 'create'),
        updatable: column.writable && columnGranted(table, name, 'update'),
      };
    });
  };
  return {
    ...block,
    columns: withGrants(tableId, block.columns),
    children: block.children.map((child) => ({ ...child, columns: withGrants(child.childTable, child.columns) })),
  };
}

/**
 * The columns of a table the reader's role does not read (their read of it
 * is limited to others): none for nearly everyone.
 */
export async function hiddenColumnsOf(
  meta: MetaDb,
  connectionId: string,
  table: string,
  read: { superAdmin?: boolean; readLimits?: ReadLimits | undefined },
): Promise<string[]> {
  if (read.superAdmin === true || read.readLimits === undefined) return [];
  let view: SnapshotView;
  try {
    view = readViewOf(await loadSnapshotView(meta, connectionId), read);
  } catch {
    return [];
  }
  if (!view.readLimited) return [];
  const resolved = view.linkTable(table) ?? (() => {
    try {
      return view.table(table);
    } catch {
      return null;
    }
  })();
  return resolved === null ? [] : [...resolved.columns.values()].filter((column) => column.unreadable === true).map((column) => column.name);
}

/**
 * A page's stored envelope without the columns named: the grid's columns
 * (`config.config.columns`, and `config.columns` on an older one), a default
 * sort by one, and a record's name read from one (`keyField` — the key names
 * it instead).
 */
export function withoutColumns(config: unknown, hidden: readonly string[]): unknown {
  if (typeof config !== 'object' || config === null) return config;
  const drop = new Set(hidden);
  const named = (item: unknown, key: string) => typeof item === 'object' && item !== null && drop.has(String((item as Record<string, unknown>)[key]));
  const strip = (block: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = { ...block };
    if (Array.isArray(block['columns'])) out['columns'] = (block['columns'] as unknown[]).filter((column) => !named(column, 'name'));
    if (Array.isArray(block['defaultSort'])) out['defaultSort'] = (block['defaultSort'] as unknown[]).filter((sort) => !named(sort, 'column'));
    if (typeof block['keyField'] === 'string' && drop.has(block['keyField'])) delete out['keyField'];
    return out;
  };
  const envelope = strip(config as Record<string, unknown>);
  const inner = envelope['config'];
  return typeof inner === 'object' && inner !== null ? { ...envelope, config: strip(inner as Record<string, unknown>) } : envelope;
}

const WHOLE_NUMBERS = new Set(['integer', 'bigint']);
/** What a spec says of a column because of its TYPE: taken whole from the live one. */
const TYPE_KEYS = ['logicalType', 'semantic', 'format', 'align'] as const;

/**
 * A stored column's heading, in the reader's language — while it is still the
 * word its app (or add-on) gave the column.
 *
 * A page stores each column's label the day it is made, in one language. The
 * manifest that made the table names the column in every language it speaks,
 * and a form already reads those names for the reader; a list read the stored
 * one, so a German reader had German fields over English headings. Followed
 * here: a stored label that IS one of the column's own names (in any
 * language) is shown as the reader's. A label somebody typed on the page is
 * none of them, and stays — it is the page's own.
 *
 * `said` is every name the table's columns were given: column → the words in
 * each language (`labelWordsOf`).
 */
export function withReaderLabels(config: unknown, facts: ColumnFactsBlock | null, said: ReadonlyMap<string, ReadonlySet<string>>): unknown {
  if (facts === null || said.size === 0 || typeof config !== 'object' || config === null) return config;
  const now = new Map<string, string>();
  for (const fact of facts.columns) {
    const label = fact.spec['label'];
    if (typeof label === 'string') now.set(String(fact.spec['name']), label);
  }
  let changed = false;
  const refresh = (block: Record<string, unknown>): Record<string, unknown> => {
    if (!Array.isArray(block['columns'])) return block;
    const columns = (block['columns'] as unknown[]).map((column) => {
      if (typeof column !== 'object' || column === null) return column;
      const stored = column as Record<string, unknown>;
      const name = String(stored['name']);
      const reader = now.get(name);
      if (reader === undefined || stored['label'] === reader || typeof stored['label'] !== 'string' || said.get(name)?.has(stored['label']) !== true) return column;
      changed = true;
      return { ...stored, label: reader };
    });
    return { ...block, columns };
  };
  const envelope = refresh(config as Record<string, unknown>);
  const inner = envelope['config'];
  const out = typeof inner === 'object' && inner !== null ? { ...envelope, config: refresh(inner as Record<string, unknown>) } : envelope;
  return changed ? out : config;
}

/**
 * A page's own title in the reader's language, while it is still the title
 * its manifest gave it (`title.from`): the sidebar already reads the
 * manifest's `titles` so, and the heading inside the page read the English.
 * A title somebody renamed stays.
 */
export function withReaderTitle(config: unknown, locale: string | undefined): unknown {
  if (locale === undefined || typeof config !== 'object' || config === null) return config;
  const title = (config as { title?: unknown }).title;
  if (typeof title !== 'object' || title === null) return config;
  const { fallback, from, titles } = title as { fallback?: unknown; from?: unknown; titles?: unknown };
  if (typeof fallback !== 'string' || fallback !== from || typeof titles !== 'object' || titles === null) return config;
  const reader = readerWords(titles as Record<string, string>, locale);
  return reader === undefined || reader === fallback ? config : { ...(config as Record<string, unknown>), title: { ...(title as Record<string, unknown>), fallback: reader } };
}

/** Every name a table's columns were given by the manifest that made them: column → its words in each language. */
export function labelWordsOf(rows: readonly { op: string; tableName: string; columnName: string | null; value: unknown }[], tableId: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.op !== 'column.label' || row.tableName !== tableId || row.columnName === null) continue;
    const label = (row.value as { label?: unknown } | null)?.label;
    const words = typeof label === 'string' ? [label] : typeof label === 'object' && label !== null ? Object.values(label as Record<string, unknown>).filter((word): word is string => typeof word === 'string') : [];
    if (words.length > 0) out.set(row.columnName, new Set([...(out.get(row.columnName) ?? []), ...words]));
  }
  return out;
}

/**
 * A page's stored envelope with the columns that have since become a yes/no
 * read as one.
 *
 * A stored column keeps the type of the day the page was made, and the form
 * lets the stored spec win. A column marked a yes/no afterwards (`column.yesNo`
 * — an app's update writes it long after its pages exist) stayed a number box
 * on that page for ever. Only that one move is followed: a whole number the
 * table now reads as a yes/no. Everything else an admin set on the column — its
 * label, its width, whether it is hidden — is the page's own and stays.
 */
export function withYesNoColumns(config: unknown, facts: ColumnFactsBlock | null): unknown {
  if (facts === null || typeof config !== 'object' || config === null) return config;
  const live = new Map<string, Record<string, unknown>>();
  for (const fact of facts.columns) {
    if (fact.spec['logicalType'] === 'boolean') live.set(String(fact.spec['name']), fact.spec);
  }
  if (live.size === 0) return config;
  let changed = false;
  const refresh = (block: Record<string, unknown>): Record<string, unknown> => {
    if (!Array.isArray(block['columns'])) return block;
    const columns = (block['columns'] as unknown[]).map((column) => {
      if (typeof column !== 'object' || column === null) return column;
      const stored = column as Record<string, unknown>;
      const now = live.get(String(stored['name']));
      if (now === undefined || !WHOLE_NUMBERS.has(String(stored['logicalType']))) return column;
      changed = true;
      const out: Record<string, unknown> = { ...stored };
      for (const key of TYPE_KEYS) {
        if (now[key] === undefined) delete out[key];
        else out[key] = now[key];
      }
      return out;
    });
    return { ...block, columns };
  };
  const envelope = refresh(config as Record<string, unknown>);
  const inner = envelope['config'];
  const out = typeof inner === 'object' && inner !== null ? { ...envelope, config: refresh(inner as Record<string, unknown>) } : envelope;
  return changed ? out : config;
}
