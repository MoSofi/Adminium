// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A FOUND PERSON'S ROW, AS ADMINIUM ALONE WRITES IT: the add-on's
 * `found_people` table (`addOn.leads.foundPeople`).
 *
 * One row per person a source found and Adminium stored in a people table:
 * which row they are, the company they were found at, the source, when, the
 * purpose they are kept for, the day they must be told by, when they were,
 * the outbox row of the mail that told them, where that stands, the pages
 * the source saw their address on (one https address per line), and their
 * address as found (`email`: where the tell mail goes; personal, so it is
 * found, downloaded and erased with the row).
 *
 * Written here only, as the system (never through a person's save: the
 * table refuses those, `compose.ts`): made when a person is kept, marked
 * when their tell mail goes or fails, removed with the person
 * (`privacy/found-people.ts`).
 *
 * ─── "Tell by" ─────────────────────────────────────────────────────────────
 * The day a found person must have been told by: the day they were found, on
 * the install's clock, one month on (the last day of a shorter month when
 * the month has no such day), less one day. Found on 21 July: told by
 * 20 August. Worked out once, when they are kept, and stored as that date;
 * the sweep compares it with today on the same clock.
 */
import { FOUND_PERSON_EMAIL_MAX, FOUND_PERSON_PAGES_MAX, FOUND_PERSON_PURPOSE_MAX, type FOUND_PERSON_STATES } from '@adminium/manifest';
import { connectionTenantConfig, type MetaDb } from '@adminium/meta';
import { sql, type Kysely } from 'kysely';

import type { SourceDatabase } from '../connections/manager.js';
import type { ResolvedTable } from '../crud/identifiers.js';
import { instantFor } from '../crud/instants.js';
import type { Row } from '../crud/mask.js';
import { dayPlus, readDay, readInstant } from '../crud/moments.js';
import { normalizeWriteValue } from '../crud/write-values.js';
import { insertRow, storableValues, type RecordWriteService, type WriteContext, type WriteTarget } from '../crud/write-service.js';
import { plainWords } from '../designer/untrusted.js';

/** Where a found person stands: waiting to be told, told, the mail failed, or they objected. */
export type FoundPersonState = (typeof FOUND_PERSON_STATES)[number];

/** The longest source id a row keeps (`addOn.sources[].id`). */
const SOURCE_MAX = 32;

const pad = (n: number): string => String(n).padStart(2, '0');

/** A day (`YYYY-MM-DD`) an instant falls on, on a clock. */
export function dayIn(at: number, zone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: zone }).format(new Date(at));
  } catch {
    return new Date(at).toISOString().slice(0, 10);
  }
}

/** The day a person found at `foundAt` must be told by, on the install's clock (see the header). */
export function tellByOf(foundAt: number, zone: string): string {
  const [y, m, d] = dayIn(foundAt, zone).split('-').map(Number) as [number, number, number];
  const year = m === 12 ? y + 1 : y;
  const month = m === 12 ? 1 : m + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return dayPlus(`${String(year).padStart(4, '0')}-${pad(month)}-${pad(Math.min(d, last))}`, -1);
}

/** The install's clock for a database: its time zone, else UTC. */
export async function zoneOf(meta: MetaDb, connectionId: string): Promise<string> {
  return (await connectionTenantConfig(meta, connectionId))?.timezone ?? 'UTC';
}

/** Who writes a found person's row: Adminium, as it writes the tables only it writes. */
export function leadsWriteContext(addOnName: string): WriteContext {
  return { origin: 'public', hops: 0, actor: { kind: 'system', id: null, label: addOnName.slice(0, 200) }, request: null };
}

/** A found person's row, as read back on any engine. */
export interface FoundRow {
  /** Its key, as text. */
  id: string;
  personTable: string;
  personKey: string;
  companyTable: string | null;
  companyKey: string | null;
  source: string;
  foundAt: number;
  purpose: string;
  /** `YYYY-MM-DD`. */
  tellBy: string;
  toldAt: number | null;
  outboxId: string | null;
  state: FoundPersonState;
  /** One https address per line, as kept. */
  pages: string[];
  /** Their address as found, normalised; null on a row that has none. */
  email: string | null;
}

const text = (value: unknown): string | null => (typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'bigint' ? String(value) : null);

/** A row as the engine reads it; null for one that does not hold what a found person's row must. */
export function foundRowOf(table: Pick<ResolvedTable, 'primaryKey'>, row: Row): FoundRow | null {
  const key = table.primaryKey[0];
  const id = key === undefined ? null : text(row[key]);
  const personTable = text(row['person_table']);
  const personKey = text(row['person_key']);
  const foundAt = readInstant(row['found_at'])?.getTime() ?? null;
  const tellBy = readDay(row['tell_by']);
  const state = text(row['state']);
  if (id === null || personTable === null || personKey === null || foundAt === null || tellBy === null || state === null) return null;
  const pages = text(row['source_pages']);
  return {
    id,
    personTable,
    personKey,
    companyTable: text(row['company_table']),
    companyKey: text(row['company_key']),
    source: text(row['source']) ?? '',
    foundAt,
    purpose: text(row['purpose']) ?? '',
    tellBy,
    toldAt: readInstant(row['told_at'])?.getTime() ?? null,
    outboxId: text(row['outbox_id']),
    state: state as FoundPersonState,
    pages: pages === null ? [] : pages.split('\n').filter((line) => line !== ''),
    email: text(row['email'])?.trim().toLowerCase() || null,
  };
}

/** The pages kept for a person: https addresses only, one per line, whole lines up to the column's width. */
export function pagesText(pages: readonly string[]): string | null {
  const out: string[] = [];
  let length = 0;
  for (const page of pages) {
    const line = page.trim();
    if (!/^https:\/\/[^\s]+$/.test(line)) continue;
    const added = length === 0 ? line.length : length + 1 + line.length;
    if (added > FOUND_PERSON_PAGES_MAX) break;
    out.push(line);
    length = added;
  }
  return out.length === 0 ? null : out.join('\n');
}

/** What a new found person's row holds. */
export interface NewFoundRow {
  personTable: string;
  personKey: string;
  companyTable: string | null;
  companyKey: string | null;
  source: string;
  foundAt: number;
  purpose: string;
  tellBy: string;
  pages: readonly string[];
  /** Their address as found: where the tell mail goes. */
  email: string;
}

/** The place a found person's row is written: its database and table. */
export interface FoundPlace {
  target: WriteTarget;
  writes: Pick<RecordWriteService, 'check'>;
  context: WriteContext;
}

/**
 * A count per meta store that moves whenever the set of people not told yet
 * may have grown or shrunk (a row written, a mail failed, a mail went): a
 * reader that keeps the set for a while (`people.ts`) reads it again then.
 */
const UNTOLD_GENERATION = new WeakMap<object, number>();

/** The current count for a meta store (see {@link UNTOLD_GENERATION}). */
export function untoldGeneration(meta: object): number {
  return UNTOLD_GENERATION.get(meta) ?? 0;
}

/** Says the set of people not told yet changed. */
export function untoldChanged(meta: object): void {
  UNTOLD_GENERATION.set(meta, untoldGeneration(meta) + 1);
}

/** Writes a found person's row, waiting to be told; answers its key. */
export async function insertFound(place: FoundPlace, row: NewFoundRow): Promise<string> {
  const values: Row = {
    person_table: row.personTable,
    person_key: row.personKey,
    company_table: row.companyTable,
    company_key: row.companyKey,
    source: plainWords(row.source, SOURCE_MAX),
    found_at: instantFor(new Date(row.foundAt)),
    purpose: plainWords(row.purpose, FOUND_PERSON_PURPOSE_MAX),
    tell_by: row.tellBy,
    told_at: null,
    outbox_id: null,
    state: 'waiting',
    source_pages: pagesText(row.pages),
    email: row.email.length <= FOUND_PERSON_EMAIL_MAX ? row.email : null,
  };
  const verdict = await place.writes.check('create', place.target, place.context, [values], { capacity: 'unchecked' });
  const good = verdict.rows[0];
  if (good === null || good === undefined) throw new Error(`the found people table refused a row: ${JSON.stringify(verdict.issues[0] ?? {})}`);
  const made = await insertRow(place.target.db, place.target.dialect, place.target.table, good);
  const key = place.target.table.primaryKey[0]!;
  return String(made[key]);
}

/** A found person's key, bound as its column takes it. */
export function boundId(id: string): number | string {
  const number = Number(id);
  return Number.isSafeInteger(number) ? number : id;
}

/** Changes columns of one found person's row (`where`: only while the row still stands so). True when it changed. */
export async function updateFound(
  target: Pick<WriteTarget, 'db' | 'dialect' | 'table'>,
  id: string,
  columns: Row,
  where?: (query: ReturnType<Kysely<SourceDatabase>['updateTable']>) => ReturnType<Kysely<SourceDatabase>['updateTable']>,
): Promise<boolean> {
  const key = target.table.primaryKey[0]!;
  const out: Row = {};
  for (const [name, value] of Object.entries(columns)) {
    const column = target.table.columns.get(name);
    out[name] = column === undefined || value === null || value === undefined ? value : normalizeWriteValue(column, value);
  }
  let query = target.db
    .updateTable(target.table.id as never)
    .set(storableValues(target.table, out, target.dialect) as never)
    .where(sql.ref(key), '=', boundId(id) as never);
  if (where !== undefined) query = where(query as never) as never;
  const result = await query.executeTakeFirst();
  return Number(result.numUpdatedRows) > 0;
}

/** Marks a found person told, now: their tell mail went. */
export async function markTold(target: Pick<WriteTarget, 'db' | 'dialect' | 'table'>, id: string, at: number): Promise<boolean> {
  return updateFound(target, id, { told_at: instantFor(new Date(at)), state: 'told' satisfies FoundPersonState });
}

/** Marks a found person's tell mail failed: they are not told, and stay so until another one goes. */
export async function markNotTold(target: Pick<WriteTarget, 'db' | 'dialect' | 'table'>, id: string): Promise<boolean> {
  return updateFound(target, id, { told_at: null, state: 'failed' satisfies FoundPersonState });
}

/** One found person's row by its key; null when it is gone. */
export async function foundById(db: Kysely<SourceDatabase>, table: ResolvedTable, id: string): Promise<FoundRow | null> {
  const key = table.primaryKey[0];
  if (key === undefined) return null;
  const row = (await db.selectFrom(table.id as never).selectAll().where(sql.ref(key), '=', boundId(id) as never).executeTakeFirst()) as Row | undefined;
  return row === undefined ? null : foundRowOf(table, row);
}

/** Every found person not told yet (waiting, or their mail failed). */
export async function untoldRows(db: Kysely<SourceDatabase>, table: ResolvedTable): Promise<FoundRow[]> {
  const rows = (await db.selectFrom(table.id as never).selectAll().where(sql.ref('told_at'), 'is', null).execute()) as Row[];
  return rows.map((row) => foundRowOf(table, row)).filter((row): row is FoundRow => row !== null);
}

/** Every found person's row naming one people row (by any name its table is known by). */
export async function foundRowsOf(db: Kysely<SourceDatabase>, table: ResolvedTable, personTables: readonly string[], personKeys: readonly string[]): Promise<FoundRow[]> {
  if (personTables.length === 0 || personKeys.length === 0) return [];
  const rows = (await db
    .selectFrom(table.id as never)
    .selectAll()
    .where(sql.ref('person_table'), 'in', personTables as never)
    .where(sql.ref('person_key'), 'in', personKeys as never)
    .execute()) as Row[];
  return rows.map((row) => foundRowOf(table, row)).filter((row): row is FoundRow => row !== null);
}
