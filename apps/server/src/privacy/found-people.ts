// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A PERSON FOUND BY A SOURCE, IN THEIR DATA: the part of a person's data an
 * add-on that finds people keeps (`sources.ts` finds, `export.ts`
 * downloads, `erase.ts` erases), modelled on a form's answers
 * (`form-answers.ts`).
 *
 * Their found person's rows are theirs when:
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
 */
import type { Dialect } from '@adminium/engine';
import { realTableOf, type MetaDb } from '@adminium/meta';
import { sql, type Kysely } from 'kysely';

import { storedTableRef, tableRefIndex, type TableRefIndex } from '../apps/table-ref.js';
import type { ConnectionManager, SourceDatabase } from '../connections/manager.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { readInstant } from '../crud/moments.js';
import { loadSnapshotView } from '../data-io/snapshot-view.js';
import { foundRowOf, zoneOf, dayIn } from '../leads/found-store.js';
import { leadsAddOnsOn, storedLeadsAddOns, type LeadsAddOnTables } from '../leads/installs.js';
import { rowKeyOf } from '../payments/payables.js';
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
  /** The sources of fields filled on their people rows. */
  fields: Row[];
  /** The install's clock: the day each was told is written on it. */
  zone: string;
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
        newRows(tell.table, mails, (await db.selectFrom(tell.table.id as never).selectAll().where(addressIs(tell.definition.columns.to, address)).execute()) as Row[]);
        const named = mails.map((row) => row[tell.link]).filter((value) => value !== null && value !== undefined);
        newRows(people, found, await rowsIn(db, people, people.primaryKey[0]!, named));
        newRows(tell.table, mails, await rowsIn(db, tell.table, tell.link, found.map((row) => row[people.primaryKey[0]!])));
      }
      // The sources of fields filled on their people rows.
      const fields: Row[] = [];
      const sources = addOn.fieldSources;
      if (sources !== null) {
        const rows = new Map<string, Set<string>>();
        for (const one of linked) for (const name of one.names) rows.set(name, new Set([...(rows.get(name) ?? []), ...one.keys]));
        for (const row of found) {
          const parsed = foundRowOf(people, row);
          if (parsed !== null) rows.set(parsed.personTable, new Set([...(rows.get(parsed.personTable) ?? []), parsed.personKey]));
        }
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
      if (found.length === 0 && mails.length === 0 && fields.length === 0) continue;
      const cut = (rows: Row[]) => (limit === undefined ? rows : rows.slice(0, limit));
      out.push({ connectionId, db, dialect, addOn, found: cut(found), mails: cut(mails), fields: cut(fields), zone });
    }
  }
  return out;
}

const plain = (row: Row): Record<string, unknown> => Object.fromEntries(Object.entries(row).map(([column, value]) => [column, plainValue(value)]));

/** A found person's row as the download writes it: where they were found, by what, why, and when they were told (Art. 15(1)(g)). */
function foundExport(addOn: LeadsAddOnTables, row: Row, fields: readonly Row[]): Record<string, unknown> {
  const parsed = foundRowOf(addOn.foundPeople!, row);
  if (parsed === null) return plain(row);
  const own = fields.filter((one) => one['table_ref'] === parsed.personTable && String(one['row_key']) === parsed.personKey);
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
    table: parsed.personTable,
    row: parsed.personKey,
    // Each field a source gave, with the source and when: their name and work address from the one that found them.
    fields: [
      { column: 'name', source: parsed.source, at: new Date(parsed.foundAt) },
      { column: 'email', source: parsed.source, at: new Date(parsed.foundAt) },
      ...own.map((one) => ({ column: one['column_name'], source: one['source'], at: readInstant(one['found_at']) })),
    ],
  });
}

/** Their found people rows, tell mails and fields' sources as sources of a person's data (the download's rows included). */
export function foundPeopleSources(found: readonly FoundPersonRows[]): FoundSource[] {
  const out: FoundSource[] = [];
  for (const one of found) {
    const parts = [
      ['found-people', one.addOn.foundPeople, one.found, one.addOn.block.foundPeople, (row: Row) => foundExport(one.addOn, row, one.fields)],
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
