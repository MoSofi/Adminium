// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Save as app, one part: `requiredSchema` (tables, columns, types, keys,
 * uniques, indexes, foreign keys and links without a constraint, table
 * `name`/`schema`) and `optionLists`, from the model and the connection's
 * overrides.
 *
 * The installer is the inverse of everything here: `install-ddl.ts` makes the
 * tables, and `writeManifestRules` turns the manifest's words back into
 * override rows. So each field is written the way that code reads it:
 *  - every nullable column says `nullable: true` (absent means NOT NULL);
 *  - a native enum is written as an enum, which installs as varchar + CHECK
 *    and reuses the source's own enum type unchanged;
 *  - a real foreign key is `type: 'fk'`; a link a person added in Adminium is
 *    `type: 'fk'` with `relation.constraint: false`; an inferred link does not
 *    travel (the target infers it again);
 *  - overrides are read RAW (the newest active row per op, table and column),
 *    never from the effective view, which resolves a label map to one
 *    language; every real table id inside a rule goes back to its ref.
 *
 * A column the manifest cannot express is never decided in silence: it is a
 * `choice` in Check (carry it as text, or leave it out) until the person
 * answers. A rule that names something that does not travel is left out and
 * named in Check.
 */
import { parseEnumCheck, type ColumnModel, type DatabaseModel, type TableModel } from '@adminium/engine';
import {
  MAX_TEXT_LENGTH,
  appManifestSchema,
  columnRulesSchema,
  isRef,
  requiredColumnSchema,
  requiredTableSchema,
  validateManifest,
  type ColumnRules,
  type RequiredColumn,
  type RequiredTable,
} from '@adminium/manifest';
import { optionListsRepo, overridesRepo, rolesRepo, type SchemaOverride } from '@adminium/meta';

import { mapTableRefs } from '../real-refs.js';
import type { SavedTable } from './refs.js';
import type { ConvertContext, ConvertPart, ManifestPart } from './types.js';

type Row = Record<string, unknown>;
type Column = RequiredColumn;
type Writable<T> = { -readonly [K in keyof T]: T[K] };

const isRecord = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A column name the manifest can carry as a ref. */
/** A label map's key in the file (`en-US`), from the store's (`en_US`). */
const BCP47 = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

/** Unbounded text that must be unique is kept to this width, the most MySQL indexes comfortably. */
const UNIQUE_TEXT_WIDTH = 255;

/** One column of a saved table: what the file says of it, or why it is left out. */
export interface PlannedColumn {
  /** The column's real name (also its ref when written). */
  name: string;
  model: ColumnModel;
  /** The column as the file writes it; null when it is left out. */
  written: Column | null;
  /** Written as text by the person's choice: rows carry its values as text. */
  asText: boolean;
}

export interface PlannedTable {
  saved: SavedTable;
  /** The table as the file writes it; null when it is left out. */
  written: RequiredTable | null;
  columns: PlannedColumn[];
}

export interface TablesPlan {
  tables: PlannedTable[];
  optionLists: Record<string, unknown>;
}

const plans = new WeakMap<ConvertContext, Promise<TablesPlan>>();

/** The tables part's work, done once per save: the rows part reads the same columns. */
export function planTables(ctx: ConvertContext): Promise<TablesPlan> {
  let plan = plans.get(ctx);
  if (plan === undefined) {
    plan = buildPlan(ctx);
    plans.set(ctx, plan);
  }
  return plan;
}

export const convertTables: ConvertPart = async (ctx) => {
  const plan = await planTables(ctx);
  const tables = plan.tables.flatMap((table) => (table.written === null ? [] : [table.written]));
  const out: ManifestPart = {};
  if (tables.length > 0) out.requiredSchema = { tables } as NonNullable<ManifestPart['requiredSchema']>;
  if (Object.keys(plan.optionLists).length > 0) out.optionLists = plan.optionLists as NonNullable<ManifestPart['optionLists']>;
  return out;
};

// ── labels ─────────────────────────────────────────────────────────────────

/**
 * A stored label as the file writes it: one string as it is, or a map with
 * BCP 47 keys (`en_US` → `en-US`) that holds `en-US` (the nearest English
 * text, else the first one, when the store has none).
 */
export function fileLabel(stored: unknown, max = 120): string | Record<string, string> | null {
  if (typeof stored === 'string') {
    const text = stored.trim();
    return text === '' ? null : text.slice(0, 256);
  }
  if (!isRecord(stored)) return null;
  const out: Record<string, string> = {};
  for (const [key, text] of Object.entries(stored)) {
    if (typeof text !== 'string' || text.trim() === '') continue;
    const tag = key.replace(/_/g, '-');
    if (!BCP47.test(tag)) continue;
    out[tag] = text.trim().slice(0, max);
  }
  const tags = Object.keys(out);
  if (tags.length === 0) return null;
  if (out['en-US'] === undefined) {
    out['en-US'] = out['en'] ?? tags.filter((tag) => tag.startsWith('en-')).map((tag) => out[tag]!)[0] ?? out[tags[0]!]!;
  }
  return out;
}

// ── the raw overrides ──────────────────────────────────────────────────────

/** The column an override is about: a link's rule by the column in its value, every other by its own. */
function targetColumn(row: SchemaOverride): string {
  if (row.op.startsWith('relation.')) return typeof row.value['fromColumn'] === 'string' ? row.value['fromColumn'] : '';
  return row.columnName ?? '';
}

/**
 * The newest active row per op, table and column. An automatic row travels
 * only when it marks a column personal (a guess the person never undid is
 * still what the dashboard does with the column).
 */
async function rawOverrides(ctx: ConvertContext): Promise<Map<string, SchemaOverride>> {
  const rows = await overridesRepo(ctx.source.meta).listForConnection(ctx.source.connectionId, { status: 'active' });
  const out = new Map<string, SchemaOverride>();
  // Oldest first, so the newest row of a target is the one kept.
  for (const row of rows) {
    if (row.origin === 'auto' && row.op !== 'column.pii') continue;
    out.set(`${row.op}|${row.tableName}|${targetColumn(row)}`, row);
  }
  return out;
}

// ── the plan ───────────────────────────────────────────────────────────────

interface Context {
  ctx: ConvertContext;
  model: DatabaseModel;
  overrides: Map<string, SchemaOverride>;
  /** The source's option lists by key. */
  lists: Map<string, { name: string; items: { value: string; label?: string | undefined; tone?: string | undefined; description?: string | undefined }[] }>;
  /** Role slug → its key in the file, for the roles that travel. */
  roleKeys: Map<string, string>;
  optionLists: Record<string, unknown>;
}

async function buildPlan(ctx: ConvertContext): Promise<TablesPlan> {
  const { meta } = ctx.source;
  const roleKeys = new Map<string, string>();
  for (const role of await rolesRepo(meta).list()) {
    const key = ctx.refs.role(role.id);
    if (key !== null) roleKeys.set(role.slug, key);
  }
  const lists = new Map((await optionListsRepo(meta).list()).map((list) => [list.key, { name: list.name, items: list.items }]));
  const c: Context = { ctx, model: ctx.source.model, overrides: await rawOverrides(ctx), lists, roleKeys, optionLists: {} };

  const tables: PlannedTable[] = [];
  for (const saved of ctx.refs.tables()) tables.push(planTable(c, saved));
  selfCheck(c, tables);
  return { tables, optionLists: c.optionLists };
}

/** A `<tableId>.<column>` answer, in either spelling the wizard records a leave-out by. */
function leftOutByAnswer(ctx: ConvertContext, target: string): boolean {
  const leaveOut = ctx.choices.leaveOut ?? [];
  return leaveOut.includes(target) || leaveOut.includes(`column:${target}`);
}

function tableLeftOut(ctx: ConvertContext, tableId: string): boolean {
  return (ctx.choices.leaveOut ?? []).includes(`table:${tableId}`);
}

/**
 * A column or table with no form in the manifest: carried as text when the
 * person chose so, else left out, and asked about until they answer.
 * `true` when it is carried as text.
 */
function noForm(c: Context, saved: SavedTable, column: string, why: string, code = 'TYPE_NO_FORM'): boolean {
  const target = `${saved.id}.${column}`;
  if ((c.ctx.choices.carryAsText ?? []).includes(target)) return true;
  if (leftOutByAnswer(c.ctx, target)) return false;
  c.ctx.check.add({
    group: 'choice',
    code,
    kind: 'column',
    item: saved.model.name,
    field: column,
    message: `"${saved.model.name}.${column}" is ${why}, which an app file cannot hold as it is. Carry it as text, or leave it out.`,
    answer: { choices: ['carry-as-text', 'leave-out'], target },
  });
  return false;
}

function info(c: Context, code: string, kind: string, item: string, message: string, field?: string): void {
  c.ctx.check.add({ group: 'info', code, kind, item, ...(field === undefined ? {} : { field }), message });
}

function planTable(c: Context, saved: SavedTable): PlannedTable {
  const table = saved.model;
  const columns: PlannedColumn[] = table.columns
    .slice()
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((model) => ({ name: model.name, model, written: null, asText: false }));
  if (table.kind !== 'table') {
    info(c, 'VIEW_NOT_CARRIED', 'table', table.name, `"${table.name}" is a view of the database, not a table: an app makes tables only, so it is left out.`);
    return { saved, written: null, columns };
  }
  if (tableLeftOut(c.ctx, saved.id)) return { saved, written: null, columns };

  const ov = (op: string, column = ''): Row | undefined => c.overrides.get(`${op}|${saved.id}|${column}`)?.value;
  const composite = table.primaryKey.length > 1;
  let compositeAsColumns = false;
  if (composite) {
    const target = saved.id;
    compositeAsColumns = (c.ctx.choices.carryAsText ?? []).includes(target);
    if (!compositeAsColumns) {
      c.ctx.check.add({
        group: 'choice',
        code: 'COMPOSITE_KEY',
        kind: 'table',
        item: table.name,
        field: table.primaryKey.join(', '),
        message: `"${table.name}" is keyed by ${String(table.primaryKey.length)} columns together, which an app file cannot hold. Carry it with those columns kept unique together and no key, or leave the table out.`,
        answer: { choices: ['carry-as-text', 'leave-out'], target },
      });
    }
  }
  // Composite links: their columns are carried without the link only by the person's word.
  const compositeLinks = new Set(
    c.model.relations.filter((rel) => rel.kind === 'declared-fk' && rel.from.tableId === saved.id && rel.from.columns.length > 1).flatMap((rel) => rel.from.columns),
  );

  for (const planned of columns) {
    const col = planned.model;
    if (!isRef(col.name)) {
      if (!leftOutByAnswer(c.ctx, `${saved.id}.${col.name}`)) {
        c.ctx.check.add({
          group: 'choice',
          code: 'COLUMN_NAME_NO_FORM',
          kind: 'column',
          item: table.name,
          field: col.name,
          message: `"${table.name}.${col.name}" has a name an app file cannot give a column (a letter or _ first, then letters, digits, _, $, - and spaces; no dot). Leave it out, or rename it first.`,
          answer: { choices: ['leave-out'], target: `${saved.id}.${col.name}` },
        });
      }
      continue;
    }
    if (compositeLinks.has(col.name)) {
      const kept = noForm(c, saved, col.name, 'part of a link made of several columns', 'COMPOSITE_LINK');
      if (!kept) continue;
      const shape = typeShape(c, saved, col);
      planned.written = finishColumn(c, saved, col, shape.kind === 'ok' ? shape.column : { type: 'text' }, ov, composite, true);
      planned.asText = shape.kind !== 'ok';
      continue;
    }
    const shape = typeShape(c, saved, col);
    if (shape.kind === 'no-form') {
      if (!noForm(c, saved, col.name, shape.why)) continue;
      planned.asText = true;
      planned.written = finishColumn(c, saved, col, { type: 'text' }, ov, composite, true);
      continue;
    }
    planned.written = finishColumn(c, saved, col, shape.column, ov, composite);
  }

  const written = columns.flatMap((planned) => (planned.written === null ? [] : [planned.written]));
  if (written.length === 0) {
    info(c, 'TABLE_NO_COLUMNS', 'table', table.name, `"${table.name}" has no column an app file can hold, so it is left out.`);
    return { saved, written: null, columns };
  }

  const out: Writable<RequiredTable> = { ref: saved.ref, columns: written } as Writable<RequiredTable>;
  if (saved.needsName) out.name = table.name;
  if (saved.needsSchema) out.schema = table.schema;

  // Labels.
  const label = ov('table.label');
  if (label !== undefined) {
    const one = fileLabel(label['label']);
    if (one !== null) {
      out.label = one;
      const plural = fileLabel(label['labelPlural']);
      if (plural !== null) out.labelPlural = plural;
    }
  }
  const keyField = ov('table.keyField')?.['column'];
  if (typeof keyField === 'string') {
    if (written.some((column) => column.ref === keyField)) out.keyField = keyField;
    else info(c, 'KEY_FIELD_NOT_CARRIED', 'table', table.name, `"${table.name}" names rows by "${keyField}", which is left out, so the target names them its own way.`, 'keyField');
  }
  if (ov('table.exclude')?.['excluded'] === true) out.exclude = true;
  const off = ov('table.switchedOff');
  if (off !== undefined) {
    const postings = Array.isArray(off['postings']) ? (off['postings'] as unknown[]).filter((id): id is string => typeof id === 'string') : [];
    if (postings.length > 0 || off['adjust'] === true) out.switchedOff = { ...(postings.length > 0 ? { postings } : {}), ...(off['adjust'] === true ? { adjust: true as const } : {}) };
  }
  if (ov('table.existingCustomers')?.['on'] === true) {
    info(
      c,
      'EXISTING_CUSTOMERS_NOT_CARRIED',
      'table',
      table.name,
      `"${table.name}" lets existing customers get marketing mail. An install never switches that on: whoever sends campaigns there decides it, with their own tick.`,
      'existingCustomers',
    );
  }

  // A composite key carried as columns keeps its columns unique together.
  const uniqueSets: string[][] = [];
  if (composite && compositeAsColumns) {
    if (table.primaryKey.length <= 4 && table.primaryKey.every((name) => indexable(written.find((column) => column.ref === name)))) uniqueSets.push([...table.primaryKey]);
    else info(c, 'KEY_NOT_UNIQUE', 'table', table.name, `"${table.name}" is carried without its key, and its key columns cannot be kept unique together.`);
  }
  keysAndIndexes(c, saved, out, written, uniqueSets);
  tableRules(c, saved, out, ov);
  return { saved, written: out as RequiredTable, columns };
}

// ── types ──────────────────────────────────────────────────────────────────

type Shape = { kind: 'ok'; column: Partial<Column> & { type: Column['type'] } } | { kind: 'no-form'; why: string };

/** The values of a column's enum: its native or column-type enum, or a CHECK that lists them. */
function enumValues(model: DatabaseModel, table: TableModel, col: ColumnModel): string[] | null {
  if (col.enumRef !== null) {
    const def = model.enums.find((one) => one.id === col.enumRef);
    if (def !== undefined) return [...def.values];
  }
  const names = table.columns.map((column) => column.name);
  for (const check of table.checks) {
    const parsed = parseEnumCheck(check.expression, names);
    if (parsed?.column === col.name && parsed.values.length > 0) return parsed.values;
  }
  return null;
}

function typeShape(c: Context, saved: SavedTable, col: ColumnModel): Shape {
  if (col.isGenerated) return { kind: 'no-form', why: 'a value the database works out itself' };
  if (col.isArray) return { kind: 'no-form', why: 'a list of values' };
  const values = col.logicalType === 'enum' || col.logicalType === 'text' || col.logicalType === 'varchar' ? enumValues(c.model, saved.model, col) : null;
  if (values !== null) {
    const kept = values.filter((value) => value !== '');
    if (kept.length < values.length) info(c, 'ENUM_EMPTY_VALUE', 'column', saved.model.name, `"${saved.model.name}.${col.name}" allows an empty answer, which an app file's choices cannot hold; it is left off the list.`, col.name);
    if (kept.length > 0) return { kind: 'ok', column: { type: 'enum', enum: kept } };
  }
  switch (col.logicalType) {
    case 'text':
      return { kind: 'ok', column: { type: 'text' } };
    case 'varchar':
      if (col.maxLength !== null && col.maxLength <= MAX_TEXT_LENGTH) return { kind: 'ok', column: { type: 'text', maxLength: col.maxLength } };
      if (col.maxLength !== null) {
        info(c, 'LONG_TEXT', 'column', saved.model.name, `"${saved.model.name}.${col.name}" holds up to ${String(col.maxLength)} characters; an app file keeps it as text of any length.`, col.name);
      }
      return { kind: 'ok', column: { type: 'text' } };
    case 'integer':
      return { kind: 'ok', column: { type: 'int' } };
    case 'bigint':
      return { kind: 'ok', column: { type: 'bigint' } };
    case 'decimal': {
      const scale = col.numericScale;
      if (scale !== null && scale > 4) return { kind: 'no-form', why: `a decimal with ${String(scale)} places after the point` };
      const shaped: Partial<Column> & { type: Column['type'] } = { type: 'decimal' };
      if (scale !== null) shaped.scale = scale;
      const precision = col.numericPrecision;
      if (precision !== null && precision >= 1 && precision <= 65 && precision >= (scale ?? 4)) shaped.precision = precision;
      return { kind: 'ok', column: shaped };
    }
    case 'float':
      return { kind: 'ok', column: { type: 'float' } };
    case 'boolean':
      return { kind: 'ok', column: { type: 'bool' } };
    case 'date':
      return { kind: 'ok', column: { type: 'date' } };
    case 'time':
      return { kind: 'ok', column: { type: 'time' } };
    case 'timestamptz':
      return { kind: 'ok', column: { type: 'timestamptz' } };
    case 'timestamp':
      if (c.ctx.source.dialect === 'postgres') {
        info(c, 'TIMESTAMP_ZONE', 'column', saved.model.name, `"${saved.model.name}.${col.name}" keeps a time without a zone; an app file makes it a time with a zone.`, col.name);
      }
      return { kind: 'ok', column: { type: 'timestamptz' } };
    case 'uuid':
      return { kind: 'ok', column: { type: 'uuid' } };
    case 'json':
      return { kind: 'ok', column: { type: 'json' } };
    case 'binary':
      return { kind: 'ok', column: { type: 'blob' } };
    case 'enum':
      return { kind: 'no-form', why: 'a choice with no values' };
    case 'interval':
      return { kind: 'no-form', why: 'a length of time (interval)' };
    case 'geometry':
      return { kind: 'no-form', why: 'a shape on the map (geometry)' };
    case 'inet':
      return { kind: 'no-form', why: 'a network address (inet)' };
    default:
      return { kind: 'no-form', why: `of a type Adminium does not know (${col.dbType})` };
  }
}

function indexable(column: Column | undefined): boolean {
  if (column === undefined) return false;
  return column.type !== 'json' && column.type !== 'blob' && (column.type !== 'text' || column.maxLength !== undefined || column.rules?.code !== undefined);
}

// ── one column ─────────────────────────────────────────────────────────────

/** A model's own semantic tag (a person's `column.semanticType`) → the manifest's, where one exists. */
const SEMANTICS: Readonly<Record<string, Column['semantic']>> = {
  money: 'money',
  email: 'email',
  'image-url': 'image',
  image: 'image',
  avatar: 'avatar',
  'person-name': 'name',
  name: 'name',
  'geo-lat': 'geo-lat',
  'geo-lng': 'geo-lng',
};

function finishColumn(
  c: Context,
  saved: SavedTable,
  col: ColumnModel,
  shape: Partial<Column> & { type: Column['type'] },
  ov: (op: string, column?: string) => Row | undefined,
  composite: boolean,
  plain = false,
): Column {
  const table = saved.model;
  const out: Writable<Column> = { ...shape, ref: col.name } as Writable<Column>;
  const single = !composite && col.isPrimaryKey && table.primaryKey.length === 1;
  if (single) out.role = 'pk';
  if (col.nullable && !single) out.nullable = true;

  // Links: a real foreign key, or one a person added in Adminium. A column carried as text links nothing.
  if (!plain) link(c, saved, col, out, ov);

  // A key that numbers itself: anything else has no form, and the install numbers it.
  if (single && (out.type === 'int' || out.type === 'bigint') && col.default?.kind !== 'autoincrement' && c.ctx.source.dialect !== 'sqlite') {
    info(c, 'KEY_NUMBERED', 'column', table.name, `"${table.name}.${col.name}" is a number key the database does not count itself; an install makes it count.`, col.name);
  }

  // The places a decimal keeps, as the person set them (`currency` included).
  const scale = ov('column.scale', col.name)?.['scale'];
  if ((out.type === 'decimal' || out.type === 'money') && (scale === 'currency' || (typeof scale === 'number' && scale >= 0 && scale <= 4))) {
    out.scale = scale;
    if (out.precision !== undefined && typeof scale === 'number' && out.precision < scale) delete out.precision;
    if (scale === 'currency' && out.precision !== undefined && out.precision < 4) delete out.precision;
  }

  columnDefault(c, saved, col, out);

  // Words a person gave the column.
  const label = fileLabel(ov('column.label', col.name)?.['label']);
  if (label !== null) out.label = label;
  const hidden = ov('column.hidden', col.name)?.['hidden'];
  if (typeof hidden === 'boolean') out.hidden = hidden;
  if (ov('column.yesNo', col.name)?.['yesNo'] === true && out.type === 'int') out.yesNo = true;
  const semanticType = ov('column.semanticType', col.name)?.['semanticType'];
  if (typeof semanticType === 'string') {
    const semantic = SEMANTICS[semanticType];
    if (semantic !== undefined) out.semantic = semantic;
    else info(c, 'SEMANTIC_NOT_CARRIED', 'column', table.name, `"${table.name}.${col.name}" was marked as ${semanticType}; an app file cannot say so, and the target guesses it again.`, col.name);
  }

  const rules = columnRules(c, saved, col, out, ov);
  if (Object.keys(rules).length > 0) out.rules = rules;

  // Unique, as the database keeps it.
  if (col.isUnique && out.role !== 'pk') {
    if (out.type === 'text' && out.maxLength === undefined && out.rules?.code === undefined) {
      out.maxLength = UNIQUE_TEXT_WIDTH;
      info(c, 'UNIQUE_TEXT_WIDTH', 'column', table.name, `"${table.name}.${col.name}" is unique and of any length; an app file keeps it to ${String(UNIQUE_TEXT_WIDTH)} characters so every database can keep it unique.`, col.name);
    }
    if (indexable(out)) out.unique = true;
  }
  return checkedColumn(c, saved, out);
}

/** A column that passes the manifest's own column rules; what does not is dropped, and said. */
function checkedColumn(c: Context, saved: SavedTable, column: Writable<Column>): Column {
  for (const field of ['default', 'rules', 'unique', 'semantic', 'label'] as const) {
    if (requiredColumnSchema.safeParse(column).success) break;
    if (column[field] === undefined) continue;
    delete column[field];
    info(c, 'COLUMN_FIELD_NOT_CARRIED', 'column', saved.model.name, `"${saved.model.name}.${column.ref}" keeps its ${field} here only: an app file cannot hold it as it is.`, column.ref);
  }
  return column;
}

function link(c: Context, saved: SavedTable, col: ColumnModel, out: Writable<Column>, ov: (op: string, column?: string) => Row | undefined): void {
  const table = saved.model;
  const declared = c.model.relations.find((rel) => rel.kind === 'declared-fk' && rel.from.tableId === saved.id && rel.from.columns.length === 1 && rel.from.columns[0] === col.name);
  const fromDeclared = declared === undefined ? col.references : { tableId: declared.to.tableId, column: declared.to.columns[0]! };
  const added = ov('relation.add', col.name);
  const removed = ov('relation.remove', col.name);
  const named = ov('relation.label', col.name);

  let target: { tableId: string; column: string } | null = null;
  let constraint = true;
  if (fromDeclared !== null && fromDeclared !== undefined) target = fromDeclared;
  else if (added !== undefined && typeof added['toTable'] === 'string' && typeof added['toColumn'] === 'string') {
    target = { tableId: added['toTable'], column: added['toColumn'] };
    constraint = false;
  }
  if (target === null) {
    if (removed !== undefined) {
      info(c, 'LINK_REMOVAL_NOT_CARRIED', 'column', table.name, `"${table.name}.${col.name}" was taken off a link Adminium guessed; the target guesses its links again.`, col.name);
    }
    return;
  }
  const ref = c.ctx.refs.table(target.tableId);
  const to = c.model.tables.find((one) => one.id === target.tableId);
  if (ref === null || to === undefined) {
    info(c, 'LINK_TABLE_LEFT_OUT', 'column', table.name, `"${table.name}.${col.name}" links to "${to?.name ?? target.tableId}", which is not in the app, so it is carried as a plain column.`, col.name);
    return;
  }
  if (to.primaryKey.length !== 1 || to.primaryKey[0] !== target.column) {
    info(c, 'LINK_NOT_TO_KEY', 'column', table.name, `"${table.name}.${col.name}" links to "${to.name}.${target.column}", which is not that table's one key; an app file links only to a key, so it is carried as a plain column.`, col.name);
    return;
  }
  // The link takes its target key's type: whatever the column held, it is now the link.
  for (const field of ['enum', 'maxLength', 'scale', 'precision', 'default'] as const) delete out[field];
  out.type = 'fk';
  out.references = ref;
  if (removed !== undefined && constraint) {
    out.relation = { remove: true };
    return;
  }
  const label = typeof named?.['label'] === 'string' ? named['label'].trim().slice(0, 120) : '';
  if (!constraint || label !== '') out.relation = { ...(label === '' ? {} : { label }), ...(constraint ? {} : { constraint: false as const }) };
}

/** The database's own default, where every engine can make the same one. */
function columnDefault(c: Context, saved: SavedTable, col: ColumnModel, out: Writable<Column>): void {
  const value = col.default;
  if (value === null || out.role === 'pk' || out.type === 'fk') return;
  const say = () => info(c, 'DEFAULT_NOT_CARRIED', 'column', saved.model.name, `"${saved.model.name}.${col.name}" has a default the database works out; an app file cannot carry it, so the target's column has none.`, col.name);
  if (value.kind === 'autoincrement') return;
  if (value.kind === 'now') {
    if (out.type === 'timestamptz') out.default = 'now';
    else say();
    return;
  }
  if (value.kind !== 'literal') {
    say();
    return;
  }
  const text = value.text;
  let literal: string | number | boolean | undefined;
  switch (out.type) {
    case 'int':
    case 'bigint':
      literal = /^-?\d+$/.test(text) ? Number(text) : undefined;
      break;
    case 'decimal':
    case 'money':
    case 'float':
      literal = text.trim() !== '' && Number.isFinite(Number(text)) ? Number(text) : undefined;
      break;
    case 'bool':
      literal = /^(true|1|'1'|b'1')$/i.test(text) ? true : /^(false|0|'0'|b'0')$/i.test(text) ? false : undefined;
      break;
    case 'text':
    case 'enum':
      literal = text;
      break;
    default:
      literal = undefined;
  }
  if (literal === undefined) {
    say();
    return;
  }
  out.default = literal;
}

// ── column rules ───────────────────────────────────────────────────────────

/** Ops whose value is the rule as the manifest spells it. */
const SAME_SHAPE: Readonly<Record<string, keyof ColumnRules>> = {
  'column.requiredWhen': 'requiredWhen',
  'column.validation': 'validation',
  'column.copy': 'copy',
  'column.sequence': 'sequence',
  'column.code': 'code',
  'column.format': 'format',
  'column.lookup': 'lookup',
  'column.band': 'band',
  'column.rollup': 'rollup',
  'column.perNight': 'perNight',
  'column.codeLast4': 'codeLast4',
  'column.customerKey': 'customerKey',
  'column.addOnLink': 'addOnLink',
  'column.linkable': 'linkable',
  'column.file': 'file',
};

/** Ops stored as `{flag: true}` whose rule is `true`. */
const FLAGS: Readonly<Record<string, keyof ColumnRules>> = {
  'column.required': 'required',
  'column.retryKey': 'retryKey',
  'column.venueLocal': 'venueLocal',
  'column.tableRef': 'tableRef',
  'column.announce': 'announce',
  'column.staff': 'staff',
  'column.place': 'place',
  'column.area': 'area',
};

/** Ops stored as `{<field>: value}` whose rule is that value. */
const WRAPPED: Readonly<Record<string, [keyof ColumnRules, string]>> = {
  'column.formula': ['formula', 'formula'],
  'column.normalize': ['normalize', 'normalize'],
  'column.mentions': ['mentions', 'mentions'],
  'column.plainText': ['plainText', 'plainText'],
  'column.changes': ['changes', 'guards'],
  'column.history': ['history', 'history'],
  'column.pii': ['personal', 'masked'],
  'column.secret': ['secret', 'secret'],
};

/** A rule's value with every real table id in it back to its ref, or the tables it names that do not travel. */
function refsBack(c: Context, value: unknown, refKeys: readonly string[] = []): { value: unknown; missing: string[] } {
  return mapTableRefs(value, (id) => c.ctx.refs.table(id) ?? undefined, { refKeys });
}

function columnRules(c: Context, saved: SavedTable, col: ColumnModel, out: Writable<Column>, ov: (op: string, column?: string) => Row | undefined): ColumnRules {
  const table = saved.model;
  const rules: Record<string, unknown> = {};
  const drop = (op: string, why: string) =>
    info(c, 'RULE_NOT_CARRIED', 'column', table.name, `"${table.name}.${col.name}" keeps its ${op.replace('column.', '')} rule here only: ${why}.`, col.name);
  const put = (op: string, key: keyof ColumnRules, raw: unknown, refKeys: readonly string[] = []) => {
    const mapped = refsBack(c, raw, refKeys);
    if (mapped.missing.length > 0) return drop(op, 'it names a table that is not in the app');
    const parsed = (columnRulesSchema.shape[key] as { safeParse: (v: unknown) => { success: boolean; data?: unknown } }).safeParse(mapped.value);
    if (!parsed.success || parsed.data === undefined) return drop(op, 'an app file cannot hold it as it is');
    rules[key] = parsed.data;
  };

  for (const [op, key] of Object.entries(SAME_SHAPE)) {
    const value = ov(op, col.name);
    if (value !== undefined) put(op, key, value, op === 'column.rollup' ? ['from'] : []);
  }
  for (const [op, key] of Object.entries(FLAGS)) if (ov(op, col.name) !== undefined) put(op, key, true);
  for (const [op, [key, field]] of Object.entries(WRAPPED)) {
    const value = ov(op, col.name);
    if (value !== undefined && value[field] !== undefined) put(op, key, value[field]);
  }

  // Answers from a list: the list travels under its name, and the column names it.
  const options = ov('column.options', col.name);
  if (options !== undefined) {
    if (typeof options['list'] === 'string') {
      const key = options['list'];
      if (key.startsWith('builtin:')) put('column.options', 'options', { list: key });
      else {
        const name = c.ctx.refs.useOptionList(key);
        const list = c.lists.get(key);
        if (name === null || list === undefined) drop('column.options', 'its list belongs to an installed app or is gone');
        else {
          writeOptionList(c, name, list);
          put('column.options', 'options', { list: name });
        }
      }
    } else if (Array.isArray(options['values'])) {
      const values = (options['values'] as Row[]).map((item) => {
        const label = fileLabel(item['label']);
        return { value: item['value'], ...(label === null ? {} : { label }), ...(typeof item['tone'] === 'string' ? { tone: item['tone'] } : {}) };
      });
      put('column.options', 'options', { values });
    }
  }
  const enumLabels = ov('column.enumLabels', col.name);
  if (enumLabels !== undefined && isRecord(enumLabels['labels'])) {
    const labels: Record<string, unknown> = {};
    for (const [value, label] of Object.entries(enumLabels['labels'])) {
      const one = fileLabel(label);
      if (one !== null) labels[value] = one;
    }
    put('column.enumLabels', 'enumLabels', { labels, ...(isRecord(enumLabels['tones']) ? { tones: enumLabels['tones'] } : {}) });
  }

  const bounds = ov('column.bounds', col.name);
  if (bounds !== undefined) {
    if (bounds['notAfter'] !== undefined) put('column.bounds', 'notAfter', bounds['notAfter']);
    if (bounds['notBefore'] !== undefined) put('column.bounds', 'notBefore', bounds['notBefore']);
  }

  const stamp = ov('column.stamp', col.name);
  if (stamp !== undefined) {
    // A working week or cut-off read from an installed app's settings names that app: it does not travel.
    const week = isRecord(stamp['set']) ? stamp['set']['addWorkingDays'] : undefined;
    if (isRecord(week) && (isRecord(week['weekdays']) || isRecord(week['cutoff']))) drop('column.stamp', "it reads an installed app's settings");
    else put('column.stamp', 'stamp', stamp);
  }

  const fill = ov('column.default', col.name);
  if (fill !== undefined) {
    if (fill['kind'] === 'from' && fill['from'] !== undefined) put('column.default', 'default', { from: fill['from'] });
    else if (fill['kind'] === 'now' && (out.type === 'timestamptz' || out.type === 'date') && out.role === undefined) {
      // Filled with the moment by Adminium: the column's role says so, and the install writes the fill back.
      out.role = fill['onUpdate'] === true ? 'updated_at' : 'created_at';
    } else drop('column.default', 'an app file fills a column only from a setting or with the moment');
  }

  // A file rule names no table; its upload part names a public door, kept as is.
  return rules as ColumnRules;
}

/** One option list as the manifest reads it. */
const optionListSchema = () => appManifestSchema.shape.optionLists.unwrap().valueType;

function writeOptionList(c: Context, name: string, list: { name: string; items: { value: string; label?: string | undefined; tone?: string | undefined; description?: string | undefined }[] }): void {
  if (c.optionLists[name] !== undefined) return;
  const doc = {
    label: list.name.trim().slice(0, 256) || name,
    values: list.items.map((item) => ({
      value: item.value,
      ...(item.label === undefined || item.label.trim() === '' ? {} : { label: item.label.slice(0, 256) }),
      ...(item.tone === undefined ? {} : { tone: item.tone.slice(0, 32) }),
      ...(item.description === undefined || item.description.trim() === '' ? {} : { description: item.description.slice(0, 512) }),
    })),
  };
  const parsed = optionListSchema().safeParse(doc);
  if (parsed.success) c.optionLists[name] = parsed.data;
  else c.ctx.check.add({ group: 'info', code: 'LIST_NOT_CARRIED', kind: 'list', item: list.name, message: `The list "${list.name}" cannot be held by an app file as it is.` });
}

// ── keys and indexes ───────────────────────────────────────────────────────

function keysAndIndexes(c: Context, saved: SavedTable, out: Writable<RequiredTable>, written: readonly Column[], uniqueSets: string[][]): void {
  const table = saved.model;
  const byRef = new Map(written.map((column) => [column.ref, column]));
  const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join('\u0000') === [...b].sort().join('\u0000');
  const usable = (set: readonly string[]) => set.every((name) => indexable(byRef.get(name)));
  const plain = (index: TableModel['indexes'][number]) => !index.primary && !index.partial && index.expression === null && index.columns.length > 0;

  const wantedUnique = [
    ...table.uniques.map((unique) => unique.columns),
    ...table.indexes.filter((index) => plain(index) && index.unique).map((index) => index.columns),
  ];
  for (const set of wantedUnique) {
    if (set.length < 2) continue;
    if (sameSet(set, table.primaryKey) || uniqueSets.some((have) => sameSet(have, set))) continue;
    if (set.length > 4 || !usable(set)) {
      info(c, 'UNIQUE_NOT_CARRIED', 'table', table.name, `"${table.name}" keeps (${set.join(', ')}) unique together; an app file cannot hold that set.`);
      continue;
    }
    uniqueSets.push([...set]);
  }
  if (uniqueSets.length > 8) {
    info(c, 'UNIQUE_NOT_CARRIED', 'table', table.name, `"${table.name}" keeps more column sets unique than an app file holds; the first 8 travel.`);
    uniqueSets.length = 8;
  }
  if (uniqueSets.length > 0) out.unique = uniqueSets;

  // MySQL makes an index for each foreign key, named after it: the install makes it again with the key.
  const keyIndexes =
    c.ctx.source.dialect === 'mysql'
      ? new Set(c.model.relations.filter((rel) => rel.kind === 'declared-fk' && rel.from.tableId === saved.id && rel.constraintName !== null).map((rel) => rel.constraintName!))
      : new Set<string>();
  const indexes: string[][] = [];
  for (const index of table.indexes.filter((one) => plain(one) && !one.unique && !keyIndexes.has(one.name))) {
    const set = index.columns;
    if (indexes.some((have) => have.length === set.length && have.every((name, at) => set[at] === name))) continue;
    if (uniqueSets.some((have) => sameSet(have, set))) continue;
    const only = set.length === 1 ? byRef.get(set[0]!) : undefined;
    if (only !== undefined && (only.role === 'pk' || only.unique === true)) continue;
    if (set.length > 4 || !usable(set)) {
      info(c, 'INDEX_NOT_CARRIED', 'table', table.name, `"${table.name}" has an index over (${set.join(', ')}) an app file cannot hold; the target goes without it.`);
      continue;
    }
    indexes.push([...set]);
  }
  if (indexes.length > 6) {
    info(c, 'INDEX_NOT_CARRIED', 'table', table.name, `"${table.name}" has more indexes than an app file holds; the first 6 travel.`);
    indexes.length = 6;
  }
  if (indexes.length > 0) out.indexes = indexes;
}

// ── table rules ────────────────────────────────────────────────────────────

/** The table's rules, each from the op it is stored under, unwrapped the way `tableOpsFor` wrapped it. */
const TABLE_RULES: readonly [op: string, key: keyof RequiredTable, unwrap: (value: Row) => unknown][] = [
  ['table.capacity', 'capacity', (value) => (Array.isArray(value['rules']) ? value['rules'] : value)],
  ['table.booking', 'booking', (value) => value],
  ['table.occupies', 'occupies', (value) => value],
  ['table.states', 'states', (value) => value],
  ['table.postings', 'postings', (value) => value['postings']],
  ['table.adjust', 'adjust', (value) => value],
  ['table.check', 'check', (value) => value],
  ['table.belongs', 'belongs', (value) => value['ways']],
  ['table.private', 'private', (value) => (value['private'] === true ? true : undefined)],
  ['table.removal', 'removal', (value) => value],
];

function tableRules(c: Context, saved: SavedTable, out: Writable<RequiredTable>, ov: (op: string, column?: string) => Row | undefined): void {
  const table = saved.model;
  for (const [op, key, unwrap] of TABLE_RULES) {
    const stored = ov(op);
    if (stored === undefined) continue;
    const drop = (why: string) => info(c, 'RULE_NOT_CARRIED', 'table', table.name, `"${table.name}" keeps its ${key} rule here only: ${why}.`, key);
    let raw = unwrap(stored);
    if (raw === undefined) continue;
    if (op === 'table.states') {
      const states = statesBack(c, table.name, raw);
      if (states === null) {
        drop('it cannot be carried as it is');
        continue;
      }
      raw = states;
    }
    const mapped = refsBack(c, raw);
    if (mapped.missing.length > 0) {
      drop('it names a table that is not in the app');
      continue;
    }
    const parsed = (requiredTableSchema.shape[key] as { safeParse: (v: unknown) => { success: boolean; data?: unknown } }).safeParse(mapped.value);
    if (!parsed.success || parsed.data === undefined) {
      drop('an app file cannot hold it as it is');
      continue;
    }
    (out as Row)[key] = parsed.data;
  }
}

/**
 * Stored states as the manifest spells them: a move kept for some roles names
 * them by role SLUG in the store, and by role KEY in the file. A role that
 * does not travel is taken off the move; a move left with no role is taken
 * out (fewer moves, never more people). A button's words go back to labels.
 */
function statesBack(c: Context, tableName: string, raw: unknown): Row | null {
  if (!isRecord(raw) || !isRecord(raw['moves'])) return null;
  const moves: Record<string, unknown[]> = {};
  for (const [from, list] of Object.entries(raw['moves'])) {
    if (!Array.isArray(list)) return null;
    moves[from] = [];
    for (const move of list) {
      if (!isRecord(move) || !Array.isArray(move['roles'])) {
        moves[from].push(move);
        continue;
      }
      const roles = (move['roles'] as unknown[]).flatMap((slug) => {
        const key = typeof slug === 'string' ? c.roleKeys.get(slug) : undefined;
        return key === undefined ? [] : [key];
      });
      if (roles.length < (move['roles'] as unknown[]).length) {
        info(c, 'STATE_ROLE_NOT_CARRIED', 'table', tableName, `A move of "${tableName}" from "${from}" is kept for a role that is not in the app; the move keeps the roles that are${roles.length === 0 ? ', and none is, so it is left out' : ''}.`, 'states');
      }
      if (roles.length > 0) moves[from].push({ ...move, roles });
    }
  }
  const out: Row = { ...raw, moves };
  if (Array.isArray(raw['actions'])) {
    out['actions'] = (raw['actions'] as unknown[]).map((action) => {
      if (!isRecord(action)) return action;
      const next: Row = { ...action };
      for (const word of ['label', 'confirm']) {
        if (action[word] === undefined) continue;
        const label = fileLabel(action[word], 300);
        if (label === null) delete next[word];
        else next[word] = label;
      }
      return next;
    });
  }
  return out;
}

// ── the last check ─────────────────────────────────────────────────────────

/**
 * The tables and lists through the manifest's own validator: a rule that
 * names a column left out, or is wrong for the column as written, is taken
 * off and said. Whatever else the validator says is another part's.
 */
function selfCheck(c: Context, tables: PlannedTable[]): void {
  const writtenTables = () => tables.filter((table) => table.written !== null);
  for (let round = 0; round < 50; round += 1) {
    const list = writtenTables();
    if (list.length === 0) return;
    const doc = {
      kind: 'app',
      manifestVersion: 1,
      key: c.ctx.choices.key,
      name: c.ctx.choices.name,
      version: c.ctx.choices.version,
      publisher: { id: 'local', name: c.ctx.choices.label },
      license: 'UNLICENSED',
      description: { key: 'd', fallback: 'd' },
      categories: ['operations'],
      // The running version: a word this server reads is never the reason a rule is dropped.
      compatibility: { minAdminiumVersion: c.ctx.source.adminiumVersion },
      requiredSchema: { tables: list.map((table) => table.written) },
      ...(Object.keys(c.optionLists).length > 0 ? { optionLists: c.optionLists } : {}),
      // The roles that travel, by key: a move kept for one of them is the roles part's to fill in.
      ...(c.ctx.refs.roles().length > 0 ? { roles: c.ctx.refs.roles().map(({ key }) => ({ key, name: key })) } : {}),
      pages: [],
      frontends: [{ side: 'staff', kind: 'none' }],
    };
    const result = validateManifest(doc, { allowLocalPublisher: true });
    if (result.ok) return;
    let dropped = false;
    for (const issue of result.issues) {
      const path = issue.path.split('.');
      if (path[0] !== 'requiredSchema' || path[1] !== 'tables') continue;
      const planned = list[Number(path[2])];
      if (planned?.written === undefined || planned.written === null) continue;
      const table = planned.written as Writable<RequiredTable>;
      if (path[3] === 'columns' && path[5] === 'rules' && path[6] !== undefined) {
        const column = table.columns[Number(path[4])] as Writable<Column> | undefined;
        const rules = column?.rules as Row | undefined;
        if (column === undefined || rules?.[path[6]] === undefined) continue;
        delete rules[path[6]];
        if (Object.keys(rules).length === 0) delete column.rules;
        info(c, 'RULE_NOT_CARRIED', 'column', planned.saved.model.name, `"${planned.saved.model.name}.${column.ref}" keeps its ${path[6]} rule here only: ${issue.message}.`, column.ref);
        dropped = true;
        break;
      }
      const field = path[3];
      if (field !== undefined && field !== 'columns' && field !== 'ref' && field !== 'name' && field !== 'schema' && (table as Row)[field] !== undefined) {
        delete (table as Row)[field];
        if (field === 'label') delete table.labelPlural;
        info(c, 'RULE_NOT_CARRIED', 'table', planned.saved.model.name, `"${planned.saved.model.name}" keeps its ${field} here only: ${issue.message}.`, field);
        dropped = true;
        break;
      }
    }
    if (!dropped) return;
  }
}
