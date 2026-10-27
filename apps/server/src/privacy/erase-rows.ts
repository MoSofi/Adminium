// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A PERSON'S ROWS IN THE APPS' OWN DATABASES, ERASED IN PLACE: what the
 * erasure finds and writes there (`erase.ts` runs it; `erase-meta.ts` does
 * Adminium's own stores).
 *
 * Found by the address, as the search finds them (`sources.ts`), but every
 * row: the search keeps 2,000 rows a source for the download, and an
 * erasure that stopped there would leave the rest without a word.
 *
 *  - THEIR OWN ROWS, on each people table an installed app declares: the
 *    fields that are theirs are emptied, and the row is kept, so every link
 *    to it stays whole (a deal, a quote, a sign-off still open). Theirs:
 *    the declared address, name, first name, language and consent column,
 *    the opt-out mark, every column the app marks (or the schema guesses)
 *    personal, the columns the app's own "delete my details" empties
 *    (`publicAccess[].forget`), and the stamps those columns set (who ticked
 *    the consent box, and when). Never a key, never a link, never a column
 *    another table's link points at. A companies table loses only the
 *    address that matched. Where the app's "delete my details" stamps when
 *    it happened, the erasure stamps it too, so its outbox reads them as
 *    forgotten (`outbox/forgotten.ts`).
 *  - THEIR COPIES on other tables (a quote's recipient, a signer): each
 *    declared copy column whose link names one of their rows, or that holds
 *    their address. Nothing else on that row changes.
 *  - THEIR MAIL in each app's outbox: to their address, or linking one of
 *    their rows. Its address, the values kept for it and any wording written
 *    for it are emptied; one still waiting is skipped, with the same
 *    sentence a message to a person who deleted their details gets.
 *  - A table the app marks kept by law (`keep: {law}`) is left whole, their
 *    copies on it included: "What stays" lists it.
 *
 * The writes are the erasure's own: one UPDATE per row, as the system, in
 * one transaction per database. Not a staff save: a save would run under a
 * role's reach and row limits (and stop half-way), drop any value sent for
 * a strict stamp, fire the rules (which would mail, notify and copy the name
 * into their history again), follow copies into sent and locked rows, and
 * write the name into the audit log's before-image. None of that happens
 * here, and nothing is told to the consent log: the erasure deletes it.
 */
import type { Outbox } from '@adminium/manifest';
import { appOutboxesRepo, manifestsRepo, type MetaDb } from '@adminium/meta';
import type { Dialect } from '@adminium/engine';
import { sql, type Kysely } from 'kysely';

import type { ConnectionManager, SourceDatabase } from '../connections/manager.js';
import { tableRulesFor, type ColumnStamp } from '../crud/column-rules.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { bindWriteValue } from '../crud/write-values.js';
import { loadSnapshotView } from '../data-io/snapshot-view.js';
import { rowKeyOf } from '../payments/payables.js';
import type { DeclaredPeopleTable } from '../people/declared.js';
import { peopleTablesOf } from '../people/tables-of.js';
import { forgetOf, forgetsOn, type TableForgets } from '../public-api/forgets-on.js';
import { alreadyBlank, blankValue, columnFacts, type ErasedRole } from './erase-values.js';
import { addressIs, keptTablesOf, NO_SECRETS, PRESENT, tableOf, type AppOnDatabase } from './sources.js';
import { isAddress } from './values.js';

/** What the erasure does to one row. */
export interface ErasedRow {
  key: string;
  pk: Row;
  /** The row as found. */
  before: Row;
  /** The values written (already bound for the database). */
  values: Row;
  /** The columns emptied: the ones the audit log's and the removed-row history's images lose too. */
  columns: string[];
  /** A message still waiting: skipped, while it still waits. */
  skip?: Row;
}

/** The rows of one source (as the search names it: `people-crm-contacts`, `copy-crm-contacts-quotes`, `outbox-crm`). */
export interface ErasedSource {
  id: string;
  kind: 'people' | 'copy' | 'outbox';
  connectionId: string;
  table: ResolvedTable;
  app: string;
  ref: string;
  label: string;
  /** For a people source: the declared entry (consent, files, sign-ins read it). */
  entry?: DeclaredPeopleTable;
  /** For a copy source: each copy column and the link it is kept through. */
  copies?: { column: string; via: string | null }[];
  /** For an outbox source: its status column (a waiting message is skipped only while it still waits). */
  status?: string;
  rows: ErasedRow[];
}

/** A column that may not be emptied (not null, and not text or yes/no): left, and counted. */
export interface LeftColumn {
  connectionId: string;
  table: string;
  column: string;
  rows: number;
}

export interface PersonRows {
  address: string;
  databases: { connectionId: string; db: Kysely<SourceDatabase>; dialect: Dialect; view: SnapshotView; sources: ErasedSource[] }[];
  left: LeftColumn[];
}

export interface EraseRowsDeps {
  meta: MetaDb;
  manager: Pick<ConnectionManager, 'data'>;
  /** "Erased person" in the install's language. */
  erasedName: string;
  now: () => number;
}

/** The columns any link of the model starts from or points at: never emptied, so every link stays whole. */
function linkColumnsOf(view: SnapshotView, tableId: string): Set<string> {
  const out = new Set<string>();
  for (const relation of view.model.relations) {
    if (relation.from.tableId === tableId) for (const column of relation.from.columns) out.add(column);
    if (relation.to.tableId === tableId) for (const column of relation.to.columns) out.add(column);
  }
  return out;
}

/** Whether a stamp is set by a change of one of these columns. */
function stampTouches(stamp: ColumnStamp, columns: ReadonlySet<string>): boolean {
  const triggers = Array.isArray(stamp.on) ? stamp.on : [stamp.on];
  return triggers.some((trigger) => {
    if (trigger === 'create') return false;
    if ('columns' in trigger) return trigger.columns.some((column) => columns.has(column));
    return columns.has(trigger.column);
  });
}

/** A person's own fields on a people row, each with what it is to them (see the header). */
function ownColumns(view: SnapshotView, table: ResolvedTable, entry: DeclaredPeopleTable, forgets: TableForgets): Map<string, ErasedRole> {
  const out = new Map<string, ErasedRole>();
  const role = (column: string): ErasedRole => (column === entry.email ? 'email' : column === entry.name || (entry.firstName !== null && typeof entry.firstName === 'object' && entry.firstName.column === column) ? 'name' : 'other');
  const add = (column: string | null | undefined) => {
    if (column !== null && column !== undefined && table.columns.has(column)) out.set(column, role(column));
  };
  add(entry.email);
  if (entry.kind === 'people') {
    add(entry.name);
    if (entry.firstName !== null && typeof entry.firstName === 'object') add(entry.firstName.column);
    add(entry.language);
    add(entry.consent?.column);
    add(entry.optOutMark);
    for (const column of table.columns.values()) if (column.masked) add(column.name);
    for (const column of forgetOf(forgets, table.id)?.columns ?? []) add(column);
    // The stamps those columns set: who ticked the box and when go with the tick.
    const own = new Set(out.keys());
    for (const stamp of tableRulesFor({ view, table })?.stamps ?? []) if (stampTouches(stamp, own)) add(stamp.column);
  }
  const links = linkColumnsOf(view, table.id);
  const stamp = forgetOf(forgets, table.id)?.stamp;
  for (const column of [...out.keys()]) {
    const resolved = table.columns.get(column)!;
    if (resolved.isPrimaryKey || resolved.secret || links.has(column) || column === stamp) out.delete(column);
  }
  return out;
}

/** Every row of `table` matching any of `conditions` (no cap: an erasure leaves nobody behind). */
async function rowsWhere(db: Kysely<SourceDatabase>, table: ResolvedTable, conditions: ReturnType<typeof sql<boolean>>[]): Promise<Row[]> {
  if (conditions.length === 0) return [];
  return (await db
    .selectFrom(table.id as never)
    .selectAll()
    .where(sql<boolean>`(${sql.join(conditions, sql` or `)})`)
    .execute()) as Row[];
}

const pkOf = (table: ResolvedTable, row: Row): Row => Object.fromEntries(table.primaryKey.map((column) => [column, row[column]]));

/** `column in (values)`, a chunk at a time so no engine meets too long a list. */
function inList(column: string, values: readonly unknown[]): ReturnType<typeof sql<boolean>>[] {
  const out: ReturnType<typeof sql<boolean>>[] = [];
  for (let at = 0; at < values.length; at += 500) {
    out.push(sql<boolean>`${sql.ref(column)} in (${sql.join(values.slice(at, at + 500).map((value) => sql`${value as never}`))})`);
  }
  return out;
}

/**
 * The values one row gets: each column as the rule says (`erase-values.ts`),
 * bound for the database; a column already empty is not written.
 */
function blankRow(table: ResolvedTable, row: Row, columns: ReadonlyMap<string, ErasedRole>, dialect: Dialect, erasedName: string, left: Map<string, number>): { values: Row; columns: string[] } {
  const values: Row = {};
  const written: string[] = [];
  for (const [column, role] of columns) {
    const facts = columnFacts(table, column);
    if (facts === null) continue;
    if (alreadyBlank(row[column], facts, role, erasedName)) {
      written.push(column);
      continue;
    }
    const blank = blankValue(facts, role, dialect, erasedName);
    if ('left' in blank) {
      left.set(column, (left.get(column) ?? 0) + 1);
      continue;
    }
    values[column] = blank.value === null ? null : bindWriteValue(table.columns.get(column)!, blank.value, dialect);
    written.push(column);
  }
  return { values, columns: written };
}

/** Everything of a person in the apps' own databases, with what each row gets (nothing is written). */
export async function findPersonRows(deps: EraseRowsDeps, address: string): Promise<PersonRows> {
  const { meta } = deps;
  const out: PersonRows = { address, databases: [], left: [] };
  const installed = (await manifestsRepo(meta, NO_SECRETS).list('app')).filter((entry) => entry.row.connectionId !== null && PRESENT.has(entry.row.status));
  const outboxes = await appOutboxesRepo(meta).list();
  const connections = [...new Set(installed.map((entry) => entry.row.connectionId as string))].sort();

  for (const connectionId of connections) {
    let view: SnapshotView;
    try {
      view = await loadSnapshotView(meta, connectionId, { forOthers: true });
    } catch {
      continue;
    }
    const apps: AppOnDatabase[] = installed.filter((entry) => entry.row.connectionId === connectionId).map((entry) => ({ appKey: entry.row.manifestKey, document: entry.document as AppOnDatabase['document'] }));
    const declared = await peopleTablesOf(meta).all(connectionId, view.model);
    const ownOutboxes = outboxes.filter((one) => one.connectionId === connectionId && apps.some((app) => app.appKey === one.appKey));
    if (declared.length === 0 && ownOutboxes.length === 0) continue;
    const { db, dialect } = await deps.manager.data(connectionId);
    const kept = await keptTablesOf(meta, connectionId, apps, view);
    const forgets = await forgetsOn(meta, connectionId);
    const sources: ErasedSource[] = [];
    const left = new Map<string, Map<string, number>>();
    const leftOf = (table: ResolvedTable) => {
      let held = left.get(table.id);
      if (held === undefined) left.set(table.id, (held = new Map()));
      return held;
    };
    /** Their rows' key values, per people table: what a copy's link and an outbox's recipient point at. */
    const keysOf = new Map<string, unknown[]>();

    // ── their own rows ───────────────────────────────────────────────────────
    for (const entry of declared) {
      const table = tableOf(view, entry.table);
      if (table === null || entry.email === null || table.primaryKey.length === 0) continue;
      const rows = await rowsWhere(db, table, [addressIs(entry.email, address)]);
      if (rows.length === 0) continue;
      if (table.primaryKey.length === 1) keysOf.set(table.id, [...(keysOf.get(table.id) ?? []), ...rows.map((row) => row[table.primaryKey[0]!])]);
      // A table the law keeps stays whole ("What stays" lists it).
      if (kept.has(table.id)) continue;
      const columns = ownColumns(view, table, entry, forgets);
      const stamp = entry.kind === 'people' ? forgetOf(forgets, table.id)?.stamp : undefined;
      const source: ErasedSource = { id: `people-${entry.appKey}-${entry.ref}`, kind: 'people', connectionId, table, app: entry.appKey, ref: entry.ref, label: table.table.label ?? table.name, entry, rows: [] };
      for (const row of rows) {
        const blank = blankRow(table, row, columns, dialect, deps.erasedName, leftOf(table));
        // As "delete my details" says when: their outbox reads them as forgotten from now on.
        const stampColumn = stamp === undefined ? undefined : table.columns.get(stamp);
        if (stampColumn !== undefined && (row[stampColumn.name] === null || row[stampColumn.name] === undefined)) blank.values[stampColumn.name] = bindWriteValue(stampColumn, new Date(deps.now()).toISOString(), dialect);
        source.rows.push({ key: rowKeyOf(table, row), pk: pkOf(table, row), before: row, ...blank });
      }
      sources.push(source);
    }

    // ── their copies on other tables ─────────────────────────────────────────
    for (const entry of declared) {
      const owner = tableOf(view, entry.table);
      const pks = owner === null ? [] : (keysOf.get(owner.id) ?? []);
      const pkSet = new Set(pks.map((pk) => String(pk)));
      const byTable = new Map<string, typeof entry.copies>();
      for (const copy of entry.copies) byTable.set(copy.table, [...(byTable.get(copy.table) ?? []), copy]);
      for (const [copyTableId, copies] of byTable) {
        const table = tableOf(view, copyTableId);
        if (table === null || table.primaryKey.length === 0 || kept.has(table.id)) continue;
        const conditions = copies.flatMap((copy) => [...(copy.holds === 'email' ? [addressIs(copy.column, address)] : []), ...(copy.via !== null && pks.length > 0 ? inList(copy.via, pks) : [])]);
        const rows = await rowsWhere(db, table, conditions);
        if (rows.length === 0) continue;
        const links = linkColumnsOf(view, table.id);
        const source: ErasedSource = {
          id: `copy-${entry.appKey}-${entry.ref}-${copies[0]!.ref}`,
          kind: 'copy',
          connectionId,
          table,
          app: entry.appKey,
          ref: copies[0]!.ref,
          label: table.table.label ?? table.name,
          copies: copies.map((copy) => ({ column: copy.column, via: copy.via })),
          rows: [],
        };
        for (const row of rows) {
          // Only the copies that are theirs on this row: linked to one of their rows, or holding their address.
          const columns = new Map<string, ErasedRole>();
          for (const copy of copies) {
            const theirs = (copy.via !== null && pkSet.has(String(row[copy.via]))) || (copy.holds === 'email' && isAddress(row[copy.column], address));
            const resolved = table.columns.get(copy.column);
            if (!theirs || resolved === undefined || resolved.isPrimaryKey || links.has(copy.column)) continue;
            columns.set(copy.column, copy.holds === 'email' ? 'email' : copy.holds === 'name' ? 'name' : 'other');
          }
          if (columns.size === 0) continue;
          source.rows.push({ key: rowKeyOf(table, row), pk: pkOf(table, row), before: row, ...blankRow(table, row, columns, dialect, deps.erasedName, leftOf(table)) });
        }
        if (source.rows.length > 0) sources.push(source);
      }
    }

    // ── their mail in the apps' outboxes ─────────────────────────────────────
    for (const one of ownOutboxes) {
      let definition: Outbox;
      try {
        definition = JSON.parse(one.definition) as Outbox;
      } catch {
        continue;
      }
      const table = tableOf(view, definition.table);
      if (table === null || table.primaryKey.length === 0 || kept.has(table.id)) continue;
      const recipients = tableOf(view, definition.recipient.table);
      const pks = recipients === null ? [] : (keysOf.get(recipients.id) ?? []);
      const rows = await rowsWhere(db, table, [addressIs(definition.columns.to, address), ...(pks.length > 0 ? inList(definition.recipient.via, pks) : [])]);
      if (rows.length === 0) continue;
      const cols = definition.columns;
      const columns = new Map<string, ErasedRole>([[cols.to, 'email']]);
      for (const column of [cols.was, cols.subjectOverride, cols.bodyOverride]) if (column !== undefined && table.columns.has(column)) columns.set(column, 'other');
      const skipReason = cols.skipReason === undefined ? undefined : table.table.columns.find((column) => column.name === cols.skipReason);
      const source: ErasedSource = { id: `outbox-${one.appKey}`, kind: 'outbox', connectionId, table, app: one.appKey, ref: 'outbox', label: table.table.label ?? table.name, status: cols.status, rows: [] };
      for (const row of rows) {
        const blank = blankRow(table, row, columns, dialect, deps.erasedName, leftOf(table));
        const erased: ErasedRow = { key: rowKeyOf(table, row), pk: pkOf(table, row), before: row, ...blank };
        if (row[cols.status] === 'queued') {
          // Skipped as a message to a person who deleted their details is (`outbox/forgotten.ts`).
          const skip: Row = { [cols.status]: 'skipped' };
          if (cols.error !== undefined) skip[cols.error] = 'No email on file';
          if (skipReason !== undefined && (skipReason.logicalType !== 'enum' || (view.model.enums ?? []).some((one) => one.id === skipReason.enumRef && one.values.includes('no-longer-needed')))) skip[cols.skipReason!] = 'no-longer-needed';
          erased.skip = skip;
        }
        source.rows.push(erased);
      }
      sources.push(source);
    }

    for (const [tableId, columns] of left) for (const [column, rows] of columns) out.left.push({ connectionId, table: tableId, column, rows });
    if (sources.length > 0) out.databases.push({ connectionId, db, dialect, view, sources });
  }
  return out;
}

/** Writes what `findPersonRows` found: one UPDATE a row, one transaction a database. Answers the rows changed per source. */
export async function writePersonRows(found: PersonRows): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const database of found.databases) {
    await database.db.transaction().execute(async (trx) => {
      for (const source of database.sources) {
        let written = 0;
        for (const row of source.rows) {
          if (Object.keys(row.values).length > 0) {
            let update = trx.updateTable(source.table.id as never).set(row.values as never);
            for (const [column, value] of Object.entries(row.pk)) update = update.where(sql.ref(column), '=', value as never);
            await update.execute();
          }
          if (row.skip !== undefined) {
            const status = source.status;
            // Only while it still waits: a message the sender took meanwhile keeps what the sender wrote.
            let skip = trx.updateTable(source.table.id as never).set(row.skip as never);
            for (const [column, value] of Object.entries(row.pk)) skip = skip.where(sql.ref(column), '=', value as never);
            if (status !== undefined) skip = skip.where(sql.ref(status), '=', 'queued' as never);
            await skip.execute();
          }
          written += 1;
        }
        counts[source.id] = (counts[source.id] ?? 0) + written;
      }
    });
  }
  return counts;
}
