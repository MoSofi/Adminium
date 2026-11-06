// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Save as app, one part: `seeds` (starting rows) and `sampleData` (sample
 * rows), with their package files.
 *
 * Per table the person chose nothing, starting rows (written once into an
 * empty table, the owner's afterwards) or sample rows (removable, may carry
 * pictures). The rows are read as the system: who may save rows is the save
 * service's question, asked before this runs.
 *
 *  - Starting rows: at most 200. Over 200, a saved view picks them (its
 *    filters, search and sort); without one, the first 200 in key order, and
 *    Check says so. Sample rows: up to 5,000 a table.
 *  - Ids travel: rows go only into empty tables, so they cannot clash, and the
 *    install moves a counting key past them.
 *  - Parents first. A cycle through nullable links is written in two passes:
 *    the link is filled once its row is in (a starting row names the later row
 *    by its label). A cycle through required links is a choice in Check. A row
 *    whose parent is not carried is named in Check, never dropped in silence.
 *  - Personal columns, and columns whose names look like secrets, travel only
 *    when the person ticked them. A staff member is never an id: a sample
 *    person (`{"@person": …}`) in sample rows, nothing in starting rows. A
 *    picture in a sample row becomes a file of the package (`@asset`).
 */
import { createHash } from 'node:crypto';

import { MAX_SEED_ROWS, SAMPLE_FORMAT, takesPicturesOnly, type RequiredColumn } from '@adminium/manifest';
import { viewsRepo } from '@adminium/meta';
import type { Kysely } from 'kysely';

import type { SourceDatabase } from '../../connections/manager.js';
import type { ResolvedTable, SnapshotView } from '../../crud/identifiers.js';
import { compileFilter, compileQuickSearch, recordFilterSchema, type RecordFilter } from '../../crud/filters.js';
import { loadSnapshotView } from '../../data-io/snapshot-view.js';
import type { ConvertContext, ConvertPart, ManifestPart, RowChoice, SaveSource } from './types.js';
import { planTables, type PlannedTable } from './tables.js';

type Row = Record<string, unknown>;

/** The most sample rows one table carries (the sample format's own cap). */
export const MAX_SAMPLE_ROWS = 5000;

/** Names a secret is usually kept under. */
const SECRET_NAME = /(password|passwd|secret|token|api_?key|private_key|credential|salt|hash(ed)?_)/i;

/** How the rows part reads the source database and its Files library. */
export interface RowAccess {
  db: Kysely<SourceDatabase>;
  /** A file of the Files library by its id, or null when it is not there. Without it, pictures stay behind. */
  readFile?: (fileId: string) => Promise<{ bytes: Uint8Array; filename: string; mime: string } | null>;
}

/** A source that can be read for rows. */
export type RowsSource = SaveSource & { rows?: RowAccess };

interface Picked {
  planned: PlannedTable;
  id: string;
  ref: string;
  name: string;
  mode: 'starting' | 'sample';
  /** The written columns that carry values, by name. */
  columns: RequiredColumn[];
  key: string[];
  rows: Row[];
}

export const convertRows: ConvertPart = async (ctx) => {
  const chosen = Object.entries(ctx.choices.rows ?? {}).filter((entry): entry is [string, RowChoice & { mode: 'starting' | 'sample' }] => entry[1].mode !== 'none');
  if (chosen.length === 0) return {};
  const access = (ctx.source as RowsSource).rows;
  if (access === undefined) throw new Error('save: rows were chosen, and the source gives no way to read them');
  const plan = await planTables(ctx);
  const view = await loadSnapshotView(ctx.source.meta, ctx.source.connectionId);
  const leaveOut = new Set(ctx.choices.leaveOut ?? []);

  const picked: Picked[] = [];
  for (const [tableId, choice] of chosen) {
    if (leaveOut.has(`rows:${tableId}`)) continue;
    const planned = plan.tables.find((table) => table.saved.id === tableId);
    const name = planned?.saved.model.name ?? tableId;
    if (planned === undefined || planned.written === null) {
      info(ctx, 'ROWS_TABLE_LEFT_OUT', name, `The rows of "${name}" stay behind: the table is not in the app.`);
      continue;
    }
    if (choice.mode === 'starting' && planned.written.private === true) {
      info(ctx, 'ROWS_PRIVATE', name, `"${name}" is private: only the people its rows belong to write it, so it starts empty.`);
      continue;
    }
    const columns = planned.columns.flatMap((column) => (column.written === null ? [] : [column.written]));
    const key = planned.saved.model.primaryKey.filter((column) => columns.some((written) => written.ref === column));
    picked.push({ planned, id: tableId, ref: planned.saved.ref, name, mode: choice.mode, columns, key, rows: [] });
  }

  for (const table of picked) table.rows = await readRows(ctx, access, view, table, chosen.find(([id]) => id === table.id)![1]);
  const people = new Map<string, string>();
  const assets: Record<string, { file: string; sha256: string }> = {};
  for (const table of picked) await shapeValues(ctx, access, view, table, people, assets);
  parentsFirst(ctx, picked);

  const out: ManifestPart = {};
  const starting = picked.filter((table) => table.mode === 'starting' && table.rows.length > 0);
  if (starting.length > 0) {
    out.seeds = starting.map((table) => {
      const file = `seeds/start-${table.ref}.json`;
      ctx.files.set(file, Buffer.from(JSON.stringify(table.rows)));
      return { table: table.ref, file };
    });
  }
  const sample = picked.filter((table) => table.mode === 'sample' && table.rows.length > 0);
  if (sample.length > 0) {
    const bundle = { format: SAMPLE_FORMAT, app: ctx.choices.key, assets, tables: sample.map((table) => ({ ref: table.ref, rows: table.rows })) };
    ctx.files.set('seeds/sample.json', Buffer.from(JSON.stringify(bundle)));
    out.sampleData = {
      file: 'seeds/sample.json',
      ...(people.size === 0 ? {} : { people: [...people.values()].map((key, at) => ({ key, name: `Sample person ${String(at + 1)}` })) }),
    } as ManifestPart['sampleData'];
  }
  return out;
};

function info(ctx: ConvertContext, code: string, item: string, message: string, field?: string): void {
  ctx.check.add({ group: 'info', code, kind: 'rows', item, ...(field === undefined ? {} : { field }), message });
}

// ── reading ────────────────────────────────────────────────────────────────

/** A saved view's filters, search and sort, when the person picked rows by one. */
async function viewOf(ctx: ConvertContext, viewId: string | undefined, name: string): Promise<{ filter: RecordFilter | null; search: string | null; sort: { column: string; dir: 'asc' | 'desc' } | null } | null> {
  if (viewId === undefined) return null;
  const saved = await viewsRepo(ctx.source.meta).findById(viewId);
  const config = saved?.config as { filters?: unknown; search?: unknown; sort?: unknown } | undefined;
  if (saved === null || config === undefined || config === null) {
    info(ctx, 'ROWS_VIEW_GONE', name, `The view chosen for "${name}" is not there any more: its rows are picked in key order.`);
    return null;
  }
  const filters = Array.isArray(config.filters) ? config.filters : [];
  const parsed = filters.length === 0 ? null : recordFilterSchema.safeParse({ and: filters });
  if (parsed !== null && !parsed.success) {
    info(ctx, 'ROWS_VIEW_UNREAD', name, `The view chosen for "${name}" filters in a way the save cannot read: its rows are picked in key order.`);
    return null;
  }
  const sort = config.sort as { column?: unknown; dir?: unknown } | null | undefined;
  return {
    filter: parsed === null ? null : parsed.data,
    search: typeof config.search === 'string' && config.search.trim() !== '' ? config.search : null,
    sort: typeof sort?.column === 'string' && (sort.dir === 'asc' || sort.dir === 'desc') ? { column: sort.column, dir: sort.dir } : null,
  };
}

async function readRows(ctx: ConvertContext, access: RowAccess, view: SnapshotView, table: Picked, choice: RowChoice): Promise<Row[]> {
  const cap = table.mode === 'starting' ? MAX_SEED_ROWS : MAX_SAMPLE_ROWS;
  const db = access.db;
  const resolved = resolvedOf(view, table.id);
  const names = table.columns.map((column) => column.ref);
  const counted = await db.selectFrom(table.id).select((eb) => eb.fn.countAll().as('n')).executeTakeFirst();
  const total = Number((counted as { n?: unknown } | undefined)?.n ?? 0);
  const picking = total > cap ? await viewOf(ctx, choice.viewId, table.name) : null;

  let query = db.selectFrom(table.id).select(names.map((name) => db.dynamic.ref(name)));
  const byPage = total > cap && picking === null ? pageOrder(ctx, table.id).filter((key) => resolved.columns.has(key.column)) : [];
  for (const key of byPage) query = query.orderBy(db.dynamic.ref(key.column), key.dir);
  if (picking !== null) {
    const compile = { view, table: resolved, canReadPii: true, dynamic: db.dynamic, dialect: ctx.source.dialect };
    if (picking.filter !== null) query = query.where((eb) => compileFilter(eb as never, compile, picking.filter!));
    if (picking.search !== null) query = query.where((eb) => compileQuickSearch(eb as never, compile, picking.search!) ?? eb(eb.val(1), '=', 1));
    if (picking.sort !== null && resolved.columns.has(picking.sort.column)) query = query.orderBy(db.dynamic.ref(picking.sort.column), picking.sort.dir);
  }
  for (const column of table.key.length > 0 ? table.key : names.slice(0, 1)) query = query.orderBy(db.dynamic.ref(column), 'asc');
  const rows = (await query.limit(cap).execute()) as Row[];
  if (total > cap && picking === null) {
    const what = table.mode === 'starting' ? 'starting rows' : 'sample rows';
    const order = byPage.length > 0 ? "its page's order" : 'key order';
    info(ctx, 'ROWS_FIRST', table.name, `"${table.name}" has ${String(total)} rows: its first ${String(cap)} in ${order} travel as ${what}. Pick a saved view to choose others.`);
  }
  return rows;
}

/** The order the table's own list page shows its rows in: its default sort, else none. */
function pageOrder(ctx: ConvertContext, tableId: string): { column: string; dir: 'asc' | 'desc' }[] {
  for (const { page } of ctx.refs.pages()) {
    const envelope = page.config as { source?: { table?: unknown }; config?: { defaultSort?: unknown } } | null;
    if (envelope?.source?.table !== tableId || !Array.isArray(envelope.config?.defaultSort)) continue;
    return (envelope.config.defaultSort as { column?: unknown; dir?: unknown }[]).flatMap((key) =>
      typeof key.column === 'string' && (key.dir === 'asc' || key.dir === 'desc') ? [{ column: key.column, dir: key.dir }] : [],
    );
  }
  return [];
}

/** A table of the effective model, an excluded one too (its rows still travel). */
function resolvedOf(view: SnapshotView, tableId: string): ResolvedTable {
  const resolved = view.linkTable(tableId);
  if (resolved === null) throw new Error(`save: "${tableId}" is not in the model`);
  return resolved;
}

// ── values ─────────────────────────────────────────────────────────────────

/** A value as JSON carries it, for a column of this type. */
function plainValue(value: unknown, column: RequiredColumn, asText: boolean): unknown {
  if (value === null || value === undefined) return null;
  if (asText) {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }
  if (value instanceof Date) return column.type === 'date' ? value.toISOString().slice(0, 10) : value.toISOString();
  if (typeof value === 'bigint') return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString();
  switch (column.type) {
    case 'bool':
      return typeof value === 'number' ? value !== 0 : typeof value === 'string' ? value === '1' || value.toLowerCase() === 'true' : value;
    case 'int':
    case 'decimal':
    case 'money':
    case 'float':
      if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
      return value;
    case 'json':
      if (typeof value === 'string') {
        try {
          return JSON.parse(value) as unknown;
        } catch {
          return value;
        }
      }
      return value;
    default:
      return value;
  }
}

/** A json value whose object keys start with `@` would read as a directive: such a value cannot travel. */
function holdsDirective(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(holdsDirective);
  if (typeof value !== 'object' || value === null) return false;
  return Object.entries(value).some(([key, inner]) => key.startsWith('@') || holdsDirective(inner));
}

async function shapeValues(ctx: ConvertContext, access: RowAccess, view: SnapshotView, table: Picked, people: Map<string, string>, assets: Record<string, { file: string; sha256: string }>): Promise<void> {
  const resolved = resolvedOf(view, table.id);
  const ticked = new Set(ctx.choices.personalColumns ?? []);
  const keep: RequiredColumn[] = [];
  const nulls = new Set<string>();
  for (const column of table.columns) {
    const name = column.ref;
    const model = table.planned.columns.find((planned) => planned.name === name)!.model;
    const live = resolved.columns.get(name);
    const target = `${table.id}.${name}`;
    const personal = column.rules?.personal ?? live?.masked ?? false;
    const secret = column.rules?.secret ?? (live?.secret === true || model.semantics?.flags.secret === true || SECRET_NAME.test(name));
    if ((personal || secret) && !ticked.has(target)) {
      const kind = secret ? 'looks like a secret' : 'holds personal data';
      if (column.nullable === true) {
        nulls.add(name);
        info(ctx, 'ROWS_PERSONAL_EMPTY', table.name, `"${table.name}.${name}" ${kind}: its values stay behind and the rows carry it empty. Tick it to carry them.`, name);
      } else if (model.default !== null) {
        info(ctx, 'ROWS_PERSONAL_LEFT_OUT', table.name, `"${table.name}.${name}" ${kind}: its values stay behind, and the target fills its default. Tick it to carry them.`, name);
      } else {
        ctx.check.add({
          group: 'choice',
          code: 'ROWS_PERSONAL_REQUIRED',
          kind: 'rows',
          item: table.name,
          field: name,
          message: `"${table.name}.${name}" ${kind}, and every row needs a value in it. Carry its values, or leave the rows of "${table.name}" out.`,
          answer: { choices: ['keep', 'leave-out'], target },
        });
      }
      continue;
    }
    if (column.rules?.staff === true || column.rules?.mentions !== undefined || personStamp(column)) {
      if (table.mode === 'sample' && column.rules?.staff === true) {
        keep.push(column);
        continue;
      }
      if (column.nullable === true) nulls.add(name);
      const why = column.rules?.mentions !== undefined ? 'names staff members in its text' : 'holds a staff member';
      info(ctx, 'ROWS_PEOPLE_LEFT_OUT', table.name, `"${table.name}.${name}" ${why}: people never travel, so the rows carry it empty.`, name);
      continue;
    }
    keep.push(column);
  }

  const asText = new Set(table.planned.columns.filter((planned) => planned.asText).map((planned) => planned.name));
  const gapless = new Set(table.columns.filter((column) => column.rules?.sequence?.gapless === true && column.rules.sequence.sample !== true).map((column) => column.ref));
  let lostFiles = false;
  let lostJson = false;
  let lostBlob = false;
  const out: Row[] = [];
  for (const source of table.rows) {
    const row: Row = {};
    for (const name of nulls) row[name] = null;
    for (const column of keep) {
      const name = column.ref;
      const raw = source[name];
      if (column.type === 'blob') {
        if (raw !== null && raw !== undefined) lostBlob = true;
        if (column.nullable === true) row[name] = null;
        continue;
      }
      if (column.rules?.staff === true) {
        // A sample person in place of the staff member: the same person, the same key, in every row.
        if (raw === null || raw === undefined || raw === '') row[name] = null;
        else {
          let key = people.get(String(raw));
          if (key === undefined) {
            key = `person-${String(people.size + 1)}`;
            people.set(String(raw), key);
          }
          row[name] = { '@person': key };
        }
        continue;
      }
      if (column.rules?.file !== undefined) {
        const picture = table.mode === 'sample' && column.type === 'text' && column.rules.file.maxCount === undefined && takesPicturesOnly(column.rules.file.accept);
        const asset = picture && typeof raw === 'string' && raw !== '' ? await pictureAsset(access, raw, assets) : null;
        if (asset !== null) row[name] = { '@asset': asset };
        else {
          if (raw !== null && raw !== undefined && raw !== '') lostFiles = true;
          row[name] = null;
        }
        continue;
      }
      if (gapless.has(name) && table.mode === 'sample') {
        row[name] = null;
        continue;
      }
      const value = plainValue(raw, column, asText.has(name));
      if (column.type === 'json' && holdsDirective(value)) {
        lostJson = true;
        row[name] = null;
        continue;
      }
      row[name] = value;
    }
    out.push(row);
  }
  table.rows = out;
  if (lostFiles) info(ctx, 'ROWS_FILES_LEFT_OUT', table.name, `Files in the rows of "${table.name}" stay behind${table.mode === 'sample' ? ' (only a picture travels, in sample rows)' : ': starting rows carry no files'}; those cells are empty.`);
  if (lostBlob) info(ctx, 'ROWS_BYTES_LEFT_OUT', table.name, `Raw bytes in the rows of "${table.name}" cannot travel in an app file; those cells are empty.`);
  if (lostJson) info(ctx, 'ROWS_JSON_LEFT_OUT', table.name, `Some json values in the rows of "${table.name}" hold keys starting with "@", which an app file reads as directions; those cells are empty.`);
}

/** A column a rule fills with who made or changed the row. */
function personStamp(column: RequiredColumn): boolean {
  const set = column.rules?.stamp?.set;
  return set === 'user-id' || set === 'user-name' || (typeof set === 'object' && set !== null && 'claim' in set);
}

const PICTURE_EXTENSIONS: Readonly<Record<string, string>> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

/** A picture of the Files library as a file of the package, by its label; null when it cannot be read. */
async function pictureAsset(access: RowAccess, fileId: string, assets: Record<string, { file: string; sha256: string }>): Promise<string | null> {
  if (access.readFile === undefined) return null;
  const file = await access.readFile(fileId).catch(() => null);
  const extension = file === null ? undefined : PICTURE_EXTENSIONS[file.mime];
  if (file === null || extension === undefined) return null;
  const sha256 = createHash('sha256').update(file.bytes).digest('hex');
  const label = `picture-${sha256.slice(0, 16)}`;
  assets[label] ??= { file: `seeds/pictures/${sha256.slice(0, 16)}.${extension}`, sha256 };
  return label;
}

// ── parents first ──────────────────────────────────────────────────────────

interface Link {
  child: Picked;
  column: string;
  parent: Picked | null;
  /** The parent table's ref, also when its rows are not carried. */
  parentRef: string;
  nullable: boolean;
}

const keyOf = (value: unknown): string => (typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value));

/**
 * The tables in an order every row's parent is written before it, and the
 * rows of a table that names itself in the same order. A row whose parent is
 * not carried loses the link (or, when the link is required, the row goes),
 * and Check says how many. A cycle through nullable links is broken at one of
 * them: a starting row names the later row by its label and the install fills
 * the link once that row is in; a sample row carries it empty, and Check says
 * so. A cycle through required links is a choice.
 */
function parentsFirst(ctx: ConvertContext, picked: Picked[]): void {
  const byRef = new Map(picked.map((table) => [table.ref, table]));
  const links: Link[] = [];
  for (const child of picked) {
    for (const column of child.columns) {
      if (column.type !== 'fk' || column.references === undefined || child.rows.every((row) => row[column.ref] === null || row[column.ref] === undefined)) continue;
      const parent = byRef.get(column.references) ?? null;
      links.push({ child, column: column.ref, parent: parent !== null && parent.key.length === 1 ? parent : null, parentRef: column.references, nullable: column.nullable === true });
    }
  }

  // A row may name only a row that is carried, and that is in by then: a starting row only a starting one.
  const reachable = (link: Link): boolean => link.parent !== null && (link.child.mode === 'sample' || link.parent.mode === 'starting');
  const emptied = new Map<Link, number>();
  const gone = new Map<Link, number>();
  for (let changed = true; changed; ) {
    changed = false;
    const keys = new Map(picked.map((table) => [table, new Set(table.rows.map((row) => keyOf(row[table.key[0]!])))]));
    for (const link of links) {
      const have = reachable(link) ? keys.get(link.parent!)! : new Set<string>();
      const before = link.child.rows.length;
      link.child.rows = link.child.rows.filter((row) => {
        const value = row[link.column];
        if (value === null || value === undefined || have.has(keyOf(value))) return true;
        if (!link.nullable) return false;
        row[link.column] = null;
        emptied.set(link, (emptied.get(link) ?? 0) + 1);
        return true;
      });
      const lost = before - link.child.rows.length;
      if (lost === 0) continue;
      changed = true;
      gone.set(link, (gone.get(link) ?? 0) + lost);
    }
  }
  for (const link of links) {
    const parentName = link.parent?.name ?? link.parentRef;
    const why =
      link.parent === null
        ? `the rows of "${parentName}" do not travel`
        : link.child.mode === 'starting' && link.parent.mode === 'sample'
          ? `"${parentName}" travels as sample rows, which a starting row cannot name`
          : `the rows they name in "${parentName}" are not among the carried ones`;
    const empty = emptied.get(link) ?? 0;
    const lost = gone.get(link) ?? 0;
    if (empty > 0) info(ctx, 'ROWS_PARENT_EMPTY', link.child.name, `${String(empty)} rows of "${link.child.name}" carry "${link.column}" empty: ${why}.`, link.column);
    if (lost > 0) info(ctx, 'ROWS_PARENT_LEFT_OUT', link.child.name, `${String(lost)} rows of "${link.child.name}" stay behind: they need "${link.column}", and ${why}.`, link.column);
  }

  const live = links.filter((link) => reachable(link) && link.parent!.mode === link.child.mode);
  const position = new Map<Picked, number>();
  for (const mode of ['starting', 'sample'] as const) {
    const group = picked.filter((table) => table.mode === mode);
    orderTables(ctx, group, live.filter((link) => link.child.mode === mode && link.child !== link.parent), position);
    for (const table of group) orderRows(ctx, table, live.filter((link) => link.child === table && link.parent === table));
  }
  // The tables in the order found: the seeds and the sample bundle are written in it.
  picked.sort((a, b) => position.get(a)! - position.get(b)!);
}

/** A link that is filled once its row is in (`@ref` to a later starting row), or left empty in sample rows. */
function defer(ctx: ConvertContext, link: Link, rows: Row[], labelled: (parent: Picked, value: unknown) => string | null): void {
  let emptied = 0;
  for (const row of rows) {
    const value = row[link.column];
    if (value === null || value === undefined) continue;
    const label = link.child.mode === 'starting' ? labelled(link.parent!, value) : null;
    if (label !== null) row[link.column] = { '@ref': label };
    else {
      row[link.column] = null;
      emptied += 1;
    }
  }
  if (emptied > 0) {
    info(ctx, 'ROWS_CYCLE_EMPTY', link.child.name, `${String(emptied)} sample rows of "${link.child.name}" carry "${link.column}" empty: they and the rows they name point at each other, and sample rows are written in one pass.`, link.column);
  }
}

/** The label a starting row is named by, given to it on first use. */
function labeller(): (parent: Picked, value: unknown) => string | null {
  return (parent, value) => {
    const key = keyOf(value);
    const at = parent.rows.findIndex((row) => keyOf(row[parent.key[0]!]) === key);
    if (at < 0) return null;
    const label = `${parent.ref}.${String(at + 1)}`;
    parent.rows[at]!['@label'] = label;
    return label;
  };
}

function requiredCycle(ctx: ConvertContext, tables: readonly Picked[]): void {
  const names = tables.map((table) => `"${table.name}"`).join(', ');
  for (const table of tables) {
    ctx.check.add({
      group: 'choice',
      code: 'ROWS_REQUIRED_CYCLE',
      kind: 'rows',
      item: table.name,
      message: `The rows of ${names} need each other through links that cannot be empty, so no order writes them. Leave the rows of one of them out.`,
      answer: { choices: ['leave-out'], target: `rows:${table.id}` },
    });
    table.rows = [];
  }
}

function orderTables(ctx: ConvertContext, group: Picked[], links: Link[], position: Map<Picked, number>): void {
  const done = new Set<Picked>();
  const pending = (table: Picked) => links.filter((link) => link.child === table && !done.has(link.parent!));
  const label = labeller();
  while (done.size < group.length) {
    const left = group.filter((table) => !done.has(table));
    let next = left.find((table) => pending(table).length === 0);
    if (next === undefined) {
      // A cycle: break it at a table whose waiting links may all be empty for now.
      next = left.find((table) => pending(table).every((link) => link.nullable));
      if (next === undefined) {
        requiredCycle(ctx, left.filter((table) => pending(table).some((link) => !link.nullable)));
        for (const table of left) {
          position.set(table, position.size);
          done.add(table);
        }
        return;
      }
      for (const link of pending(next)) defer(ctx, link, next.rows, label);
    }
    position.set(next, position.size);
    done.add(next);
  }
}

function orderRows(ctx: ConvertContext, table: Picked, links: Link[]): void {
  if (links.length === 0 || table.key.length !== 1) return;
  const key = table.key[0]!;
  const index = new Map(table.rows.map((row, at) => [keyOf(row[key]), at]));
  const placed = new Set<number>();
  const out: Row[] = [];
  const waiting = (at: number) =>
    links.filter((link) => {
      const value = table.rows[at]![link.column];
      if (value === null || value === undefined || (typeof value === 'object' && '@ref' in value)) return false;
      const parent = index.get(keyOf(value));
      return parent !== undefined && parent !== at && !placed.has(parent);
    });
  const label = labeller();
  while (out.length < table.rows.length) {
    let progressed = false;
    for (let at = 0; at < table.rows.length; at += 1) {
      if (placed.has(at) || waiting(at).length > 0) continue;
      placed.add(at);
      out.push(table.rows[at]!);
      progressed = true;
    }
    if (progressed) continue;
    const at = table.rows.findIndex((_row, i) => !placed.has(i) && waiting(i).every((link) => link.nullable));
    if (at < 0) {
      requiredCycle(ctx, [table]);
      return;
    }
    for (const link of waiting(at)) defer(ctx, link, [table.rows[at]!], label);
  }
  // Labels were given on the rows as they stood; the order changes, the rows are the same objects.
  table.rows = out;
}
