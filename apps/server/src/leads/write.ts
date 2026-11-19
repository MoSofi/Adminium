// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A FOUND COMPANY'S FACTS, AS THEY ARE WRITTEN INTO A COMPANIES TABLE.
 *
 * ─── Which columns ─────────────────────────────────────────────────────────
 * Only the columns the app declares for a company's details (its `lead`
 * word, as the owner's sheet left it: `companies.ts`) and its name column.
 * Nothing else of the row is ever written by a found company.
 *
 * ─── In what shape ─────────────────────────────────────────────────────────
 * Every text is one plain line (`plainWords`: no control or
 * direction-changing characters), cut to its column's width, so MySQL takes
 * what SQLite would have taken. A website that does not fit is left out
 * rather than cut (a cut address leads somewhere else). A country is written
 * only as a two-letter ISO code. What a company does is its first activity's
 * words, with its code after them when both fit ("Architectural activities ·
 * 71111"), else the words cut.
 *
 * ─── As whom ───────────────────────────────────────────────────────────────
 * The caller writes the row as the staff member (`crud/as-person.ts`): their
 * grants, column limits, row limits, rules, audit and live updates apply.
 * The owner column, where the app declares one, is the person who added it.
 *
 * ─── Where each fact came from ─────────────────────────────────────────────
 * Each written field is noted in the add-on's fields' sources table, as
 * Adminium writes it: the table and row, the column, the source and when,
 * and the hash of the value as the record page reads it (its text, trimmed;
 * sha-256 hex). The record page shows "From {source} · {date}" under a field
 * only while its value still hashes the same, so a later edit hides the note
 * with nothing to clear.
 */
import { createHash } from 'node:crypto';

import type { CompanyFacts } from '@adminium/add-on-contracts';
import { sql } from 'kysely';

import type { ConnectionManager } from '../connections/manager.js';
import { instantFor } from '../crud/instants.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { insertRow, type RecordWriteService } from '../crud/write-service.js';
import { plainWords } from '../designer/untrusted.js';
import type { CompaniesTable } from './companies.js';
import { leadsWriteContext } from './found-store.js';
import type { LeadsAddOnTables } from './installs.js';

/** The facts of a company a found company may write, by the name the door calls each. */
export const LEAD_FIELDS = ['name', 'number', 'website', 'phone', 'lines', 'town', 'region', 'postalCode', 'country', 'activity', 'about'] as const;
export type LeadField = (typeof LEAD_FIELDS)[number];

/** The longest a fact is kept before it meets a column (the contract's own bounds are wider for some). */
const FACT_MAX = 2000;
/** The widths of the fields' sources table's text columns, as the add-on's manifest word declares them. */
const SOURCE_MAX = 32;
const ROW_KEY_MAX = 200;
const TABLE_REF_MAX = 64;
const COLUMN_MAX = 64;

/** The column each fact goes in, on one companies table: only the ones it declares and has. */
export function leadColumns(companies: Pick<CompaniesTable, 'declared' | 'table'>): Partial<Record<LeadField, string>> {
  const { declared, table } = companies;
  const lead = declared.lead ?? {};
  const named: Partial<Record<LeadField, string | undefined>> = {
    name: declared.name ?? undefined,
    number: lead.number,
    website: lead.website,
    phone: lead.phone,
    lines: lead.address?.lines,
    town: lead.address?.town,
    region: lead.address?.region,
    postalCode: lead.address?.postalCode,
    country: lead.address?.country,
    activity: lead.activity,
    about: lead.about,
  };
  const out: Partial<Record<LeadField, string>> = {};
  for (const field of LEAD_FIELDS) {
    const column = named[field];
    if (column !== undefined && table.columns.has(column)) out[field] = column;
  }
  return out;
}

/** The owner column a found company is written with (the person who adds it), when the table declares one. */
export function ownerColumn(companies: Pick<CompaniesTable, 'declared' | 'table'>): string | null {
  const column = companies.declared.lead?.owner;
  return column !== undefined && companies.table.columns.has(column) ? column : null;
}

/** What a company does, as one line: its words, then its code when both are given. */
function activityText(activity: CompanyFacts['activity']): string | null {
  const label = activity?.label === undefined ? '' : plainWords(activity.label, FACT_MAX);
  const code = activity?.code === undefined ? '' : plainWords(activity.code, 40);
  if (label !== '' && code !== '') return `${label} · ${code}`;
  return label !== '' ? label : code !== '' ? code : null;
}

/** A company's facts by field, each one plain line (not yet cut to any column). */
export function factsByField(facts: CompanyFacts): Partial<Record<LeadField, string>> {
  const out: Partial<Record<LeadField, string>> = {};
  const put = (field: LeadField, value: string | undefined | null) => {
    if (value === undefined || value === null) return;
    const line = plainWords(value, FACT_MAX);
    if (line !== '') out[field] = line;
  };
  put('name', facts.name);
  put('number', facts.number);
  put('website', facts.website);
  put('phone', facts.phone);
  put('lines', facts.address?.lines);
  put('town', facts.address?.town);
  put('region', facts.address?.region);
  put('postalCode', facts.address?.postalCode);
  put('country', facts.address?.country);
  put('activity', activityText(facts.activity));
  put('about', facts.about);
  return out;
}

/** A column's width, when it has one. */
function widthOf(table: Pick<ResolvedTable, 'table'>, column: string): number | null {
  const width = table.table.columns.find((one) => one.name === column)?.maxLength;
  return typeof width === 'number' && width > 0 ? width : null;
}

/** One fact as its column takes it; null when it may not be written there (see the header). */
export function columnValue(field: LeadField, value: string, width: number | null): string | null {
  if (field === 'country') return /^[A-Z]{2}$/.test(value) && (width === null || width >= 2) ? value : null;
  if (field === 'website') return /^https:\/\/\S+$/.test(value) && (width === null || [...value].length <= width) ? value : null;
  if (field === 'activity' && width !== null && [...value].length > width) {
    // The words without the code, cut, before the code is cut away mid-way.
    const words = value.split(' · ')[0] ?? value;
    return plainWords(words, width);
  }
  return width === null ? value : plainWords(value, width);
}

/** One fact to write: its field, its column and its value. */
export interface FieldWrite {
  field: LeadField;
  column: string;
  value: string;
}

/**
 * The values a found company's facts write on a companies table: each fact
 * the table declares a column for, in that column's shape. `only`: just these
 * fields (a fill's ticked ones).
 */
export function writesFor(companies: Pick<CompaniesTable, 'declared' | 'table'>, facts: CompanyFacts, only?: readonly LeadField[]): FieldWrite[] {
  const columns = leadColumns(companies);
  const found = factsByField(facts);
  const out: FieldWrite[] = [];
  for (const field of LEAD_FIELDS) {
    if (only !== undefined && !only.includes(field)) continue;
    const column = columns[field];
    const raw = found[field];
    if (column === undefined || raw === undefined) continue;
    const value = columnValue(field, raw, widthOf(companies.table, column));
    if (value !== null && value !== '') out.push({ field, column, value });
  }
  return out;
}

/**
 * How a column's value reads on the record page, for a note's hash: as text
 * (trimmed), as a number, as a day or as an instant. By the column's kind,
 * never by what the driver handed back, so every engine reads one value the
 * same: Postgres and MySQL give a decimal as `"12.50"` where SQLite gives
 * `12.5`, and a day or an instant as a `Date` where SQLite gives text.
 */
export type ShownKind = 'text' | 'number' | 'date' | 'instant';

/** The kind a column of this logical type reads as. */
export function shownKindOf(logicalType: string | undefined): ShownKind {
  if (logicalType === 'integer' || logicalType === 'bigint' || logicalType === 'decimal' || logicalType === 'float') return 'number';
  if (logicalType === 'date') return 'date';
  if (logicalType === 'timestamp' || logicalType === 'timestamptz') return 'instant';
  return 'text';
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/** A number as one spelling: no trailing zeros after the point, no point when nothing follows it. */
function numberText(value: unknown): string | null {
  if (typeof value === 'number') return Number.isFinite(value) ? String(Object.is(value, -0) ? 0 : value) : null;
  if (typeof value === 'bigint') return String(value);
  if (typeof value !== 'string') return null;
  const m = /^\s*([+-]?)(\d+)(?:\.(\d*))?\s*$/.exec(value);
  if (m === null) return value.trim();
  const whole = m[2]!.replace(/^0+(?=\d)/, '');
  const fraction = (m[3] ?? '').replace(/0+$/, '');
  const text = fraction === '' ? whole : `${whole}.${fraction}`;
  return m[1] === '-' && text !== '0' ? `-${text}` : text;
}

/** A day as `YYYY-MM-DD`: as written, or the server's own day of an instant (the day a driver's midnight stands for). */
function dayText(value: unknown): string | null {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return value.trim();
  const at = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null;
  if (at === null || Number.isNaN(at.getTime())) return typeof value === 'string' ? value.trim() : null;
  return `${pad(at.getFullYear(), 4)}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** A wall time with no zone, as SQLite keeps one: `2026-07-28 11:30:00`, maybe with milliseconds. */
const WALL = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?$/;

/**
 * An instant as ISO text in UTC. A wall time with no zone is the server's own
 * clock (what Adminium keeps in a SQLite timestamp column, and what a driver
 * makes of a Postgres `timestamp`), read as the instant it denotes.
 */
function instantText(value: unknown): string | null {
  const wall = typeof value === 'string' ? WALL.exec(value.trim()) : null;
  const at =
    value instanceof Date
      ? value
      : wall !== null
        ? new Date(Number(wall[1]), Number(wall[2]) - 1, Number(wall[3]), Number(wall[4]), Number(wall[5]), Number(wall[6] ?? 0), Number((wall[7] ?? '0').padEnd(3, '0')))
        : typeof value === 'string'
          ? new Date(value.trim())
          : null;
  if (at === null || Number.isNaN(at.getTime())) return typeof value === 'string' ? value.trim() : null;
  return at.toISOString();
}

/** The text a record page reads a value as, trimmed; null when it holds none. A column's kind reads it by that kind. */
export function shownText(value: unknown, kind: ShownKind = 'text'): string | null {
  if (value === null || value === undefined) return null;
  if (kind === 'number') return numberText(value);
  if (kind === 'date') return dayText(value);
  if (kind === 'instant') return instantText(value);
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value);
}

/**
 * The hash a field's note is drawn by: sha-256 hex of the value as the record
 * page reads it (its text, trimmed; a number, a day or an instant by its
 * column's kind). The fill writes it; the notes compare against it.
 */
export function valueHash(value: unknown, kind: ShownKind = 'text'): string {
  return createHash('sha256').update(shownText(value, kind) ?? '', 'utf8').digest('hex');
}

/** What notes the fields a source wrote: on which add-on, which row, which columns, by which source, when. */
export interface FieldSourcesNote {
  addOn: LeadsAddOnTables;
  view: SnapshotView;
  /** The table as the add-on's tables name it (`<app>:<ref>`). */
  tableRef: string;
  rowKey: string;
  /** Each column written, by the source that gave it, with the row as stored after the write. */
  columns: readonly { column: string; source: string }[];
  stored: Row;
  /** The table written: each column's value is hashed by its kind. Absent, every value reads as text. */
  table?: Pick<ResolvedTable, 'columns'> | undefined;
  at: number;
}

/**
 * Notes, as Adminium, where each written field came from: one row per
 * column of the fields' sources table, the one before it replaced. A column
 * whose stored value is empty gets no note.
 */
export async function noteFieldSources(deps: { manager: Pick<ConnectionManager, 'data'>; writes: Pick<RecordWriteService, 'check'> }, note: FieldSourcesNote): Promise<number> {
  const table = note.addOn.fieldSources;
  if (table === null || note.columns.length === 0) return 0;
  const { db, dialect } = await deps.manager.data(note.addOn.connectionId);
  const tableRef = note.tableRef.slice(0, TABLE_REF_MAX);
  const rowKey = note.rowKey.slice(0, ROW_KEY_MAX);
  const columns = [...new Set(note.columns.map((one) => one.column))];
  await db
    .deleteFrom(table.id as never)
    .where(sql.ref('table_ref'), '=', tableRef as never)
    .where(sql.ref('row_key'), '=', rowKey as never)
    .where(sql.ref('column_name'), 'in', columns as never)
    .execute();
  const target = { connectionId: note.addOn.connectionId, view: note.view, table, db, dialect };
  const context = leadsWriteContext(note.addOn.name);
  let written = 0;
  for (const { column, source } of note.columns) {
    const kind = shownKindOf(note.table?.columns.get(column)?.logicalType);
    const shown = shownText(note.stored[column], kind);
    if (shown === null || shown === '') continue;
    const values: Row = {
      table_ref: tableRef,
      row_key: rowKey,
      column_name: column.slice(0, COLUMN_MAX),
      source: plainWords(source, SOURCE_MAX),
      found_at: instantFor(new Date(note.at)),
      value_hash: valueHash(note.stored[column], kind),
    };
    const verdict = await deps.writes.check('create', target, context, [values], { capacity: 'unchecked' });
    const good = verdict.rows[0];
    if (good === null || good === undefined) throw new Error(`the fields' sources table refused a row: ${JSON.stringify(verdict.issues[0] ?? {})}`);
    await insertRow(db, dialect, table, good);
    written += 1;
  }
  return written;
}
