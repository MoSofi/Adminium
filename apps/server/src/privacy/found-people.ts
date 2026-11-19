// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A PERSON FOUND BY A SOURCE, IN THEIR DATA: the part of a person's data an
 * add-on that finds people keeps (`sources.ts` finds, `export.ts`
 * downloads, `erase.ts` erases), modelled on a form's answers
 * (`form-answers.ts`).
 *
 * Their found person's rows are theirs when:
 *  - a row keeps their address (`email`, as found); or
 *  - a row names one of their people rows (its `person_table` and
 *    `person_key`, by any name the table is known by); or
 *  - a tell mail went to their address (the outbox's `to`), and names the
 *    found person's row.
 * With each go the tell mails sent to them (by the address, or naming one of
 * their found rows) and the sources of the fields filled on their people
 * rows (`field_sources`, by the row).
 *
 * The download says, for each: which source found them and when, the
 * purpose they were kept for, by when they were to be told and when they
 * were, and the pages the source saw their address on (Art. 15(1)(g)); and
 * for each field a source filled, which source and when.
 *
 * An erasure deletes all three; what it keeps is only the day each was told
 * ("told on {date}"), which the erasure's own audit entry carries beside the
 * keyed hash of the address, never the address (`routes/privacy`). Read as
 * the privacy action, as the rest of a person's data: no role's limits. The
 * address is compared as `normaliseAddress` spells it.
 *
 * A SOLE TRADER (`leads/sole-trader.ts`) is one person in two rows: the
 * company row the lead door added for them (their name, their business's
 * address and phone) goes with them. Its fields' sources are theirs, the
 * download carries the row, and an erasure empties it in place (`erase.ts`).
 */
import type { Dialect } from '@adminium/engine';
import { realTableOf, type MetaDb } from '@adminium/meta';
import { sql, type Kysely } from 'kysely';

import { resolveTableRef, storedTableRef, tableRefIndex, type TableRefIndex } from '../apps/table-ref.js';
import type { ConnectionManager, SourceDatabase } from '../connections/manager.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { readInstant } from '../crud/moments.js';
import { fetchByPk } from '../crud/records.js';
import { loadSnapshotView } from '../data-io/snapshot-view.js';
import { foundRowOf, zoneOf, dayIn, type FoundRow } from '../leads/found-store.js';
import { leadsAddOnsOn, storedLeadsAddOns, type LeadsAddOnTables } from '../leads/installs.js';
import { SOLE_TRADER_MARK, soleTraderCompany } from '../leads/sole-trader.js';
import { pkOfRowKey, rowKeyOf } from '../payments/payables.js';
import { peopleTablesOf } from '../people/tables-of.js';
import type { ErasedRole } from './erase-values.js';
import type { TheirRow } from './chat-transcripts.js';
import type { FoundSource } from './types.js';
import { plainValue } from './values.js';

/** How many keys one statement names. */
const BATCH = 200;

/** One add-on's rows of one person. */
export interface FoundPersonRows {
  connectionId: string;
  db: Kysely<SourceDatabase>;
  dialect: Dialect;
  addOn: LeadsAddOnTables;
  /** Their found person's rows. */
  found: Row[];
  /** The tell mails sent to them. */
  mails: Row[];
  /** The sources of fields filled on their people rows (and on a sole trader's company row). */
  fields: Row[];
  /** A sole trader's company rows: theirs, with the columns of them that are (their name, their business's details). */
  companies: SoleTraderCompany[];
  /** The install's clock: the day each was told is written on it. */
  zone: string;
}

/** A sole trader's company row, as found for them. */
export interface SoleTraderCompany {
  /** The found person's row it belongs to, by its key. */
  found: string;
  table: ResolvedTable;
  /** Its key, as the record pages name it. */
  key: string;
  row: Row;
  /** Its columns that are the person's, and how each is emptied. */
  columns: Map<string, ErasedRole>;
}

export interface FoundPeopleDeps {
  meta: MetaDb;
  manager: Pick<ConnectionManager, 'data'>;
}

const addressIs = (column: string, address: string) => sql<boolean>`lower(trim(${sql.ref(column)})) = ${address}`;

/** Every name a stored table name may hold for a table: its id, its maker's `<app>:<ref>`, and every app's that holds it. */
function namesOf(index: TableRefIndex, view: SnapshotView, tableId: string): string[] {
  const out = new Set<string>([tableId, storedTableRef(index, tableId)]);
  for (const record of index.records) {
    if (record.state === 'dropped') continue;
    try {
      if (view.table(realTableOf(record)).id === tableId) out.add(`${record.appKey}:${record.ref}`);
    } catch {
      // A table gone from the snapshot names nothing.
    }
  }
  return [...out];
}

/** Rows of `table` whose `column` is one of `values`, in batches. */
async function rowsIn(db: Kysely<SourceDatabase>, table: ResolvedTable, column: string, values: readonly unknown[]): Promise<Row[]> {
  if (!table.columns.has(column) || values.length === 0) return [];
  const out: Row[] = [];
  for (let at = 0; at < values.length; at += BATCH) {
    out.push(...((await db.selectFrom(table.id as never).selectAll().where(sql.ref(column), 'in', values.slice(at, at + BATCH) as never).execute()) as Row[]));
  }
  return out;
}

/** The rows of a table that are not already in `held`, by the table's key. */
function newRows(table: ResolvedTable, held: Row[], more: readonly Row[]): Row[] {
  const seen = new Set(held.map((row) => rowKeyOf(table, row)));
  for (const row of more) {
    const key = rowKeyOf(table, row);
    if (seen.has(key)) continue;
    seen.add(key);
    held.push(row);
  }
  return held;
}

/**
 * Every add-on's found people rows of one person, with their tell mails and
 * their fields' sources: by the rows of theirs the search found, and by the
 * address their tell mails went to (`limit`: the most rows a search keeps
 * per add-on and part).
 */
export async function findFoundPeopleRows(deps: FoundPeopleDeps, address: string, theirs: readonly TheirRow[], limit?: number): Promise<FoundPersonRows[]> {
  const stored = await storedLeadsAddOns(deps.meta);
  const out: FoundPersonRows[] = [];
  for (const connectionId of [...new Set(stored.map((one) => one.connectionId))].sort()) {
    let view: SnapshotView;
    try {
      view = await loadSnapshotView(deps.meta, connectionId, { forOthers: true });
    } catch {
      continue;
    }
    const { db, dialect } = await deps.manager.data(connectionId);
    const index = await tableRefIndex(deps.meta, connectionId, view.model);
    const byTable = new Map<string, string[]>();
    for (const row of theirs) if (row.connectionId === connectionId) byTable.set(row.table, [...new Set([...(byTable.get(row.table) ?? []), row.key])]);
    const linked = [...byTable].map(([table, keys]) => ({ names: namesOf(index, view, table), keys }));
    const zone = await zoneOf(deps.meta, connectionId);

    for (const addOn of await leadsAddOnsOn(deps.meta, connectionId, view, stored)) {
      const people = addOn.foundPeople;
      if (people === null) continue;
      const found: Row[] = [];
      // By the address they were found with.
      if (people.columns.has('email') && address !== '') newRows(people, found, (await db.selectFrom(people.id as never).selectAll().where(addressIs('email', address)).execute()) as Row[]);
      for (const one of linked) {
        const rows = (await db
          .selectFrom(people.id as never)
          .selectAll()
          .where(sql.ref('person_table'), 'in', one.names as never)
          .where(sql.ref('person_key'), 'in', one.keys as never)
          .execute()) as Row[];
        newRows(people, found, rows);
      }
      // The tell mails to the address, and the found people rows they name.
      const mails: Row[] = [];
      const tell = addOn.tell;
      if (tell !== null) {
        if (address !== '') newRows(tell.table, mails, (await db.selectFrom(tell.table.id as never).selectAll().where(addressIs(tell.definition.columns.to, address)).execute()) as Row[]);
        const named = mails.map((row) => row[tell.link]).filter((value) => value !== null && value !== undefined);
        newRows(people, found, await rowsIn(db, people, people.primaryKey[0]!, named));
        newRows(tell.table, mails, await rowsIn(db, tell.table, tell.link, found.map((row) => row[people.primaryKey[0]!])));
      }
      const { fields, companies } = await ownedBy(deps, { connectionId, db, view, index, addOn }, found, linked);
      if (found.length === 0 && mails.length === 0 && fields.length === 0) continue;
      const cut = <T>(rows: T[]) => (limit === undefined ? rows : rows.slice(0, limit));
      out.push({ connectionId, db, dialect, addOn, found: cut(found), mails: cut(mails), fields: cut(fields), companies, zone });
    }
  }
  return out;
}

/** Where an add-on's found people are read: its database, the snapshot, and the names its tables go by. */
interface FoundPlace {
  connectionId: string;
  db: Kysely<SourceDatabase>;
  view: SnapshotView;
  index: TableRefIndex;
  addOn: LeadsAddOnTables;
}

/**
 * What found people's rows bring with them: the fields' sources of their
 * people rows (and of `linked` rows), and each sole trader's company row with
 * its own fields' sources.
 */
async function ownedBy(deps: FoundPeopleDeps, place: FoundPlace, found: readonly Row[], linked: readonly { names: string[]; keys: string[] }[]): Promise<{ fields: Row[]; companies: SoleTraderCompany[] }> {
  const { db, view, index, addOn } = place;
  const people = addOn.foundPeople!;
  const sources = addOn.fieldSources;
  const parsed = found.map((row) => foundRowOf(people, row)).filter((row): row is FoundRow => row !== null);
  const companies = await soleTraderCompanies(deps, place, parsed);
  const fields: Row[] = [];
  if (sources !== null) {
    const rows = new Map<string, Set<string>>();
    const add = (table: string, keys: readonly string[]) => rows.set(table, new Set([...(rows.get(table) ?? []), ...keys]));
    for (const one of linked) for (const name of one.names) add(name, one.keys);
    for (const row of parsed) add(row.personTable, [row.personKey]);
    // A sole trader's company row: by every name its table is known by.
    for (const company of companies) for (const name of namesOf(index, view, company.table.id)) add(name, [company.key]);
    for (const [table, keys] of rows) {
      const hits = (await db
        .selectFrom(sources.id as never)
        .selectAll()
        .where(sql.ref('table_ref'), '=', table as never)
        .where(sql.ref('row_key'), 'in', [...keys] as never)
        .execute()) as Row[];
      newRows(sources, fields, hits);
    }
  }
  return { fields, companies };
}

/** The company rows of the sole traders among these found people (`leads/sole-trader.ts`), with the columns of each that are theirs. */
async function soleTraderCompanies(deps: FoundPeopleDeps, place: FoundPlace, found: readonly FoundRow[]): Promise<SoleTraderCompany[]> {
  const out: SoleTraderCompany[] = [];
  let declared: Awaited<ReturnType<ReturnType<typeof peopleTablesOf>['all']>> | null = null;
  for (const one of found) {
    if (!(await soleTraderCompany(place.db, place.addOn.fieldSources, one))) continue;
    const tableId = resolveTableRef(place.index, one.companyTable!)?.tableId ?? null;
    if (tableId === null) continue;
    let table: ResolvedTable;
    try {
      table = place.view.table(tableId);
    } catch {
      continue;
    }
    const pk = pkOfRowKey(table, one.companyKey!);
    const row = pk === null ? undefined : ((await fetchByPk(place.db, table, pk)) as Row | undefined);
    if (row === undefined) continue;
    declared ??= await peopleTablesOf(deps.meta).all(place.connectionId, place.view.model);
    const entry = declared.find((candidate) => candidate.table === tableId && candidate.kind === 'companies');
    const columns = new Map<string, ErasedRole>();
    if (entry?.name !== null && entry?.name !== undefined) columns.set(entry.name, 'name');
    const lead = entry?.lead;
    // Every detail the door wrote of them; never the owner (a member of staff), never a key.
    for (const column of [lead?.number, lead?.website, lead?.phone, lead?.activity, lead?.about, lead?.address?.lines, lead?.address?.town, lead?.address?.region, lead?.address?.postalCode, lead?.address?.country]) {
      if (column !== undefined && column !== null && table.columns.has(column) && !table.primaryKey.includes(column)) columns.set(column, 'other');
    }
    if (out.some((held) => held.table.id === table.id && held.key === one.companyKey)) continue;
    out.push({ found: one.id, table, key: one.companyKey!, row, columns });
  }
  return out;
}

/**
 * One found person's own rows, by their found person's row: that row, the
 * tell mails that name it, the fields' sources of their people row and of a
 * sole trader's company row. Null when the row is gone. What the keeping
 * sweep erases, and nothing else of them.
 */
export async function findFoundPersonRows(deps: FoundPeopleDeps, input: { connectionId: string; addOnKey: string; found: string }): Promise<FoundPersonRows | null> {
  const stored = (await storedLeadsAddOns(deps.meta)).filter((one) => one.connectionId === input.connectionId && one.key === input.addOnKey);
  if (stored.length === 0) return null;
  let view: SnapshotView;
  try {
    view = await loadSnapshotView(deps.meta, input.connectionId, { forOthers: true });
  } catch {
    return null;
  }
  const addOn = (await leadsAddOnsOn(deps.meta, input.connectionId, view, stored))[0];
  const people = addOn?.foundPeople ?? null;
  if (addOn === undefined || people === null) return null;
  const { db, dialect } = await deps.manager.data(input.connectionId);
  const index = await tableRefIndex(deps.meta, input.connectionId, view.model);
  const found = await rowsIn(db, people, people.primaryKey[0]!, [boundKey(input.found)]);
  if (found.length === 0) return null;
  const mails: Row[] = [];
  if (addOn.tell !== null) newRows(addOn.tell.table, mails, await rowsIn(db, addOn.tell.table, addOn.tell.link, found.map((row) => row[people.primaryKey[0]!])));
  const { fields, companies } = await ownedBy(deps, { connectionId: input.connectionId, db, view, index, addOn }, found, []);
  return { connectionId: input.connectionId, db, dialect, addOn, found, mails, fields, companies, zone: await zoneOf(deps.meta, input.connectionId) };
}

/** A found person's key as its column takes it. */
const boundKey = (id: string): number | string => (Number.isSafeInteger(Number(id)) ? Number(id) : id);

const plain = (row: Row): Record<string, unknown> => Object.fromEntries(Object.entries(row).map(([column, value]) => [column, plainValue(value)]));

/** A found person's row as the download writes it: where they were found, by what, why, and when they were told (Art. 15(1)(g)). */
function foundExport(addOn: LeadsAddOnTables, row: Row, fields: readonly Row[], companies: readonly SoleTraderCompany[]): Record<string, unknown> {
  const parsed = foundRowOf(addOn.foundPeople!, row);
  if (parsed === null) return plain(row);
  const own = fields.filter((one) => one['table_ref'] === parsed.personTable && String(one['row_key']) === parsed.personKey);
  const company = companies.find((one) => one.found === parsed.id);
  // A sole trader: their business's details are theirs too, each with where it came from; their address a member of staff typed.
  const soleTrader =
    company === undefined
      ? {}
      : {
          soleTrader: {
            table: parsed.companyTable,
            row: parsed.companyKey,
            values: plain(Object.fromEntries([...company.columns.keys()].map((column) => [column, company.row[column] ?? null]))),
            fields: fields
              .filter((one) => one['table_ref'] === parsed.companyTable && String(one['row_key']) === parsed.companyKey && one['column_name'] !== SOLE_TRADER_MARK)
              .map((one) => ({ column: one['column_name'], source: one['source'], at: readInstant(one['found_at']) })),
          },
        };
  return plain({
    id: parsed.id,
    foundBy: parsed.source,
    foundAt: new Date(parsed.foundAt),
    foundAtCompany: parsed.companyTable === null ? null : { table: parsed.companyTable, row: parsed.companyKey },
    purpose: parsed.purpose,
    tellBy: parsed.tellBy,
    toldAt: parsed.toldAt === null ? null : new Date(parsed.toldAt),
    state: parsed.state,
    sourcePages: parsed.pages,
    email: parsed.email,
    table: parsed.personTable,
    row: parsed.personKey,
    // Each field a source gave, with the source and when: their name and work address from the one that found them.
    fields: [
      { column: 'name', source: parsed.source, at: new Date(parsed.foundAt) },
      { column: 'email', source: company === undefined ? parsed.source : 'staff', at: new Date(parsed.foundAt) },
      ...own.map((one) => ({ column: one['column_name'], source: one['source'], at: readInstant(one['found_at']) })),
    ],
    ...soleTrader,
  });
}

/** Their found people rows, tell mails and fields' sources as sources of a person's data (the download's rows included). */
export function foundPeopleSources(found: readonly FoundPersonRows[]): FoundSource[] {
  const out: FoundSource[] = [];
  for (const one of found) {
    const parts = [
      ['found-people', one.addOn.foundPeople, one.found, one.addOn.block.foundPeople, (row: Row) => foundExport(one.addOn, row, one.fields, one.companies)],
      ['found-people-mail', one.addOn.tell?.table ?? null, one.mails, 'tell', plain],
      ['found-people-fields', one.addOn.fieldSources, one.fields, one.addOn.block.fieldSources, plain],
    ] as const;
    for (const [kind, table, rows, ref, write] of parts) {
      if (table === null || rows.length === 0) continue;
      out.push({
        id: `${kind}-${one.addOn.key}`,
        kind,
        group: 'held',
        connectionId: one.connectionId,
        table: table.id,
        app: one.addOn.key,
        ref,
        label: table.table.label ?? table.name,
        keptByLaw: null,
        count: rows.length,
        keys: rows.map((row) => rowKeyOf(table, row)),
        rows: rows.map(write),
      });
    }
  }
  return out;
}

/** Deletes rows of a table by their single key, in batches; answers how many went. */
async function deleteRows(db: Kysely<SourceDatabase>, table: ResolvedTable, rows: readonly Row[]): Promise<number> {
  const key = table.primaryKey[0];
  if (key === undefined || rows.length === 0) return 0;
  let gone = 0;
  const keys = rows.map((row) => row[key]);
  for (let at = 0; at < keys.length; at += BATCH) {
    const result = await db.deleteFrom(table.id as never).where(sql.ref(key), 'in', keys.slice(at, at + BATCH) as never).executeTakeFirst();
    gone += Number(result.numDeletedRows);
  }
  return gone;
}

/** What an erasure of their found people did: the rows removed per source id, and the days each was told on. */
export interface FoundPeopleErased {
  counts: Record<string, number>;
  /** `YYYY-MM-DD`, one per found person told, oldest first: all the erasure keeps of them. */
  told: string[];
}

/** Erases their found people rows with their tell mails and their fields' sources (see the header). */
export async function eraseFoundPeopleRows(found: readonly FoundPersonRows[]): Promise<FoundPeopleErased> {
  const counts: Record<string, number> = {};
  const told: string[] = [];
  for (const one of found) {
    const people = one.addOn.foundPeople;
    if (people === null) continue;
    for (const row of one.found) {
      const parsed = foundRowOf(people, row);
      if (parsed?.toldAt !== null && parsed?.toldAt !== undefined) told.push(dayIn(parsed.toldAt, one.zone));
    }
    // The mails first (they name the found rows), then the fields' sources, then the found rows themselves.
    if (one.addOn.tell !== null) {
      const mails = await deleteRows(one.db, one.addOn.tell.table, one.mails);
      if (mails > 0) counts[`found-people-mail-${one.addOn.key}`] = mails;
    }
    if (one.addOn.fieldSources !== null) {
      const fields = await deleteRows(one.db, one.addOn.fieldSources, one.fields);
      if (fields > 0) counts[`found-people-fields-${one.addOn.key}`] = fields;
    }
    const gone = await deleteRows(one.db, people, one.found);
    if (gone > 0) counts[`found-people-${one.addOn.key}`] = gone;
  }
  return { counts, told: told.sort() };
}
