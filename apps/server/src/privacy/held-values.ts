// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT A PERSON STILL HOLDS, WHEN THEY ASK TO BE FORGOTTEN: a pack of visits,
 * a gift card, store credit, on an add-on's table that declares `holders`.
 *
 *  - A row with NO VALUE LEFT (used up, expired, refunded, voided) loses the
 *    person's name, address and key at once, and the address on the mail sent
 *    about it. Its amounts and its ledger stay.
 *  - A row with VALUE LEFT keeps them, so it stays spendable by the person who
 *    holds it, and its `forgotten` mark is set. The mark says nothing about
 *    them. Once a day the sweep finds marked rows whose value has ended and
 *    empties them, so the promise holds without anybody remembering it.
 *
 * Which rows are theirs:
 *
 *  - on the public door, by a link and never by a typed address: the keyed
 *    hash of the address they proved (`key`), or their own purchase (`sale`),
 *    and then only if the address on the row is the one they proved. A gift
 *    they bought for somebody else stays that person's, whole. A card somebody
 *    else bought for them names them by a typed address alone, so the door
 *    cannot reach it;
 *  - in the staff erasure, by the address, as that erasure finds everything.
 *
 * The writes are direct, as the erasure's are (`erase-rows.ts`): no save, no
 * rule, no mail. A table the law keeps is never touched.
 */
import type { Dialect } from '@adminium/engine';
import type { AddOnManifest, Holders, Outbox } from '@adminium/manifest';
import { appTablesRepo, manifestsRepo, realTableOf, type MetaDb } from '@adminium/meta';
import { sql, type Kysely } from 'kysely';

import { resolveTableRef, tableRefIndex, type TableRefIndex } from '../apps/table-ref.js';
import type { ConnectionManager, SourceDatabase } from '../connections/manager.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { loadSnapshotView } from '../data-io/snapshot-view.js';
import { tableOfReal } from '../installs/table-id.js';
import { blankRow, pkOf } from './erase-rows.js';
import type { ErasedRole } from './erase-values.js';
import { addressIs, NO_SECRETS, PRESENT } from './sources.js';

type HolderPerson = Holders['people'][number];

/** The add-on's mail about a row: its address goes when the row's does. */
interface HeldMail {
  table: ResolvedTable;
  link: string;
  to: string;
  status: string;
  error: string | undefined;
  skipReason: string | undefined;
}

export interface HolderTable {
  addOn: string;
  ref: string;
  table: ResolvedTable;
  holders: Holders;
  mail: HeldMail[];
}

/** Who is asking. `person` is their own row, for what they bought; `byAddress` is the staff erasure's reach. */
export interface HeldAsker {
  address: string;
  key: string | null;
  person?: { table: ResolvedTable; key: unknown };
  byAddress?: boolean;
}

export interface HeldOutcome {
  /** Rows that still have value and keep the person's details. */
  kept: number;
  /** Rows with none left, emptied now. */
  emptied: number;
}

/** How many keys one `in` list carries. */
const CHUNK = 500;
/** How many rows one round of the sweep reads. */
const BATCH = 200;
const DAY_MS = 86_400_000;

const normal = (address: string): string => address.trim().toLowerCase();
const chunks = <T>(items: readonly T[]): T[][] => {
  const out: T[][] = [];
  for (let at = 0; at < items.length; at += CHUNK) out.push(items.slice(at, at + CHUNK));
  return out;
};
const set = (value: unknown): boolean => value !== null && value !== undefined && value !== '';
const yes = (value: unknown): boolean => value === true || value === 1 || value === '1' || value === 't';
/** A yes as each engine keeps one: SQLite and MySQL as a number. */
const yesOn = (dialect: Dialect): boolean | number => (dialect === 'postgres' ? true : 1);

const dayOf = (value: unknown): string | null => {
  if (!set(value)) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
};

/**
 * Whether a row is still worth something. A day's grace on the last day, for
 * a business in any timezone: a row is emptied a day late, never a day early.
 * A figure not worked out yet counts as live for the same reason.
 */
export function isLive(live: Holders['live'], row: Row, now: number): boolean {
  const status = String(row[live.status] ?? '');
  if (!live.open.includes(status)) return false;
  if (live.until !== undefined) {
    const last = dayOf(row[live.until]);
    if (last !== null && last < new Date(now - DAY_MS).toISOString().slice(0, 10)) return false;
  }
  if (live.waiting?.includes(status) === true) return true;
  const left = row[live.left];
  return !set(left) || Number(left) > 0;
}

/** The tables of the add-ons on this database that declare holders. */
export async function holderTablesOn(meta: MetaDb, connectionId: string, view: SnapshotView): Promise<HolderTable[]> {
  const addOns = (await manifestsRepo(meta, NO_SECRETS).list('add-on')).filter((entry) => entry.row.connectionId === connectionId && PRESENT.has(entry.row.status));
  const out: HolderTable[] = [];
  for (const entry of addOns) {
    const manifest = entry.document as AddOnManifest | null;
    const declared = (manifest?.requiredSchema?.tables ?? []).filter((table) => table.holders !== undefined && table.keep === undefined);
    if (declared.length === 0) continue;
    const addOn = entry.row.manifestKey;
    const records = (await appTablesRepo(meta).forInstall(connectionId, addOn)).filter((record) => record.state === 'created' || record.state === 'adopted');
    const tableOfRef = (ref: string): ResolvedTable | null => {
      const record = records.find((one) => one.ref === ref);
      const model = record === undefined ? undefined : tableOfReal(view.model, realTableOf(record));
      return model === undefined ? null : view.table(model.id);
    };
    const outbox = (manifest as { outbox?: Outbox } | null)?.outbox;
    for (const one of declared) {
      const table = tableOfRef(one.ref);
      if (table === null || table.primaryKey.length !== 1) continue;
      const mail: HeldMail[] = [];
      const box = outbox === undefined ? null : tableOfRef(outbox.table);
      if (outbox !== undefined && box !== null && box.primaryKey.length > 0) {
        const boxColumns = manifest?.requiredSchema?.tables.find((candidate) => candidate.ref === outbox.table)?.columns ?? [];
        for (const link of Object.values(outbox.links ?? {})) {
          const column = boxColumns.find((candidate) => candidate.ref === link) as { references?: unknown } | undefined;
          if (column?.references !== one.ref) continue;
          mail.push({ table: box, link, to: outbox.columns.to, status: outbox.columns.status, error: outbox.columns.error, skipReason: outbox.columns.skipReason });
        }
      }
      out.push({ addOn, ref: one.ref, table, holders: one.holders!, mail });
    }
  }
  return out;
}

/** The keys of one table's rows that lead to the person, by one link or by two. */
async function keysLeadingTo(db: Kysely<SourceDatabase>, view: SnapshotView, tableId: string, person: NonNullable<HeldAsker['person']>): Promise<unknown[]> {
  const table = view.table(tableId);
  if (table.primaryKey.length !== 1) return [];
  const links = view.model.relations.filter((relation) => relation.through === null && relation.from.columns.length === 1);
  const pick = async (from: ResolvedTable, column: string, values: readonly unknown[]): Promise<unknown[]> => {
    const out: unknown[] = [];
    for (const part of chunks(values)) {
      const rows = (await db.selectFrom(from.id as never).select(sql.ref(from.primaryKey[0]!).as('k') as never).where(sql.ref(column), 'in', part as never).execute()) as { k: unknown }[];
      out.push(...rows.map((row) => row.k));
    }
    return out;
  };
  const direct = links.find((relation) => relation.from.tableId === table.id && relation.to.tableId === person.table.id);
  if (direct !== undefined) return pick(table, direct.from.columns[0]!, [person.key]);
  for (const step of links.filter((relation) => relation.from.tableId === table.id)) {
    const middle = view.table(step.to.tableId);
    if (middle.primaryKey.length !== 1) continue;
    const up = links.find((relation) => relation.from.tableId === middle.id && relation.to.tableId === person.table.id);
    if (up === undefined) continue;
    const parents = await pick(middle, up.from.columns[0]!, [person.key]);
    return parents.length === 0 ? [] : pick(table, step.from.columns[0]!, parents);
  }
  return [];
}

/** The rows of a table that name this person: by their key, by what they bought, or (the staff erasure) by the address. */
async function rowsOf(db: Kysely<SourceDatabase>, view: SnapshotView, index: TableRefIndex, held: HolderTable, holder: HolderPerson, asker: HeldAsker): Promise<Row[]> {
  const address = normal(asker.address);
  const found = new Map<string, Row>();
  const pk = held.table.primaryKey[0]!;
  const keep = (rows: readonly Row[]) => {
    for (const row of rows) found.set(String(row[pk]), row);
  };
  const from = () => db.selectFrom(held.table.id as never).selectAll();
  if (holder.key !== undefined && asker.key !== null) keep((await from().where(sql.ref(holder.key), '=', asker.key as never).execute()) as Row[]);
  if (asker.byAddress === true) keep((await from().where(addressIs(holder.email, address)).execute()) as Row[]);
  if (holder.sale !== undefined && asker.person !== undefined) {
    const sale = holder.sale;
    const named = (await db.selectFrom(held.table.id as never).select(sql.ref(sale.table).as('t') as never).distinct().execute()) as { t: unknown }[];
    for (const { t } of named) {
      if (typeof t !== 'string' || t === '') continue;
      const tableId = resolveTableRef(index, t)?.tableId;
      if (tableId === undefined) continue;
      const keys = await keysLeadingTo(db, view, tableId, asker.person);
      for (const part of chunks(keys.map(String))) {
        const rows = (await from().where(sql.ref(sale.table), '=', t as never).where(sql.ref(sale.row), 'in', part as never).execute()) as Row[];
        // Bought by them, and for them: a gift for somebody else keeps that person's details.
        keep(rows.filter((row) => typeof row[holder.email] === 'string' && normal(row[holder.email] as string) === address));
      }
    }
  }
  return [...found.values()];
}

/** Sets a row's mark, empties this person's details from it when `empty`, and takes the address off the mail about it. */
async function writeRow(db: Kysely<SourceDatabase>, dialect: Dialect, held: HolderTable, holder: HolderPerson, row: Row, empty: boolean): Promise<void> {
  const { table } = held;
  if (!table.columns.has(holder.forgotten)) return;
  const values: Row = yes(row[holder.forgotten]) ? {} : { [holder.forgotten]: yesOn(dialect) };
  if (empty) {
    const columns = new Map<string, ErasedRole>([[holder.email, 'email']]);
    if (holder.name !== undefined) columns.set(holder.name, 'name');
    if (holder.key !== undefined) columns.set(holder.key, 'other');
    Object.assign(values, blankRow(table, row, columns, dialect, '', new Map()).values);
  }
  if (Object.keys(values).length > 0) {
    let update = db.updateTable(table.id as never).set(values as never);
    for (const [column, value] of Object.entries(pkOf(table, row))) update = update.where(sql.ref(column), '=', value as never);
    await update.execute();
  }
  const address = row[holder.email];
  if (!empty || typeof address !== 'string' || address === '') return;
  const key = row[table.primaryKey[0]!];
  for (const mail of held.mail) {
    const sent = (await db.selectFrom(mail.table.id as never).selectAll().where(sql.ref(mail.link), '=', key as never).where(addressIs(mail.to, normal(address))).execute()) as Row[];
    for (const message of sent) {
      const blank = blankRow(mail.table, message, new Map<string, ErasedRole>([[mail.to, 'email']]), dialect, '', new Map()).values;
      const waiting = message[mail.status] === 'queued';
      if (waiting) {
        // Skipped, as a message to a person who deleted their details is (`outbox/forgotten.ts`).
        blank[mail.status] = 'skipped';
        if (mail.error !== undefined) blank[mail.error] = 'No email on file';
        const reason = mail.skipReason === undefined ? undefined : mail.table.table.columns.find((column) => column.name === mail.skipReason);
        if (reason !== undefined) blank[mail.skipReason!] = 'no-longer-needed';
      }
      if (Object.keys(blank).length === 0) continue;
      let change = db.updateTable(mail.table.id as never).set(blank as never);
      for (const [column, value] of Object.entries(pkOf(mail.table, message))) change = change.where(sql.ref(column), '=', value as never);
      await change.execute();
    }
  }
}

/**
 * A person's address changed, by their own proved change or at the desk: what
 * they hold by their key goes with them. Left behind, the old mailbox's next
 * owner could prove that address and spend it, and the person could neither
 * spend it nor have it found when they delete their details. A row that only
 * holds a typed address, with no key, proves nothing and stays as typed.
 */
export async function moveHeldToAddress(
  deps: { meta: MetaDb; db: Kysely<SourceDatabase>; keyOf: (connectionId: string, address: string) => string },
  connectionId: string,
  view: SnapshotView,
  from: string,
  to: string,
): Promise<number> {
  if (normal(from) === normal(to)) return 0;
  const tables = await holderTablesOn(deps.meta, connectionId, view);
  if (tables.length === 0) return 0;
  const fromKey = deps.keyOf(connectionId, from);
  const toKey = deps.keyOf(connectionId, to);
  let moved = 0;
  await deps.db.transaction().execute(async (trx) => {
    for (const held of tables) {
      for (const holder of held.holders.people) {
        if (holder.key === undefined) continue;
        const changed = await trx
          .updateTable(held.table.id as never)
          .set({ [holder.key]: toKey, [holder.email]: to.trim() } as never)
          .where(sql.ref(holder.key), '=', fromKey as never)
          .executeTakeFirst();
        moved += Number(changed.numUpdatedRows);
      }
    }
  });
  return moved;
}

/** How stored table names read on this database: asked before a transaction opens, where nothing may wait on another pool. */
export const heldIndex = (meta: MetaDb, connectionId: string, view: SnapshotView): Promise<TableRefIndex> => tableRefIndex(meta, connectionId, view.model);

/** Whether a table names a person by a typed address and a sale alone: a card somebody else bought for them, which the public door cannot reach. */
export const reachesGiftsOnlyBySale = (tables: readonly HolderTable[]): boolean => tables.some((held) => held.holders.people.some((holder) => holder.key === undefined && holder.sale !== undefined));

/** What a person's request does to what they hold, inside the caller's transaction. */
export async function forgetHeld(db: Kysely<SourceDatabase>, dialect: Dialect, view: SnapshotView, index: TableRefIndex, tables: readonly HolderTable[], asker: HeldAsker, now: number): Promise<HeldOutcome> {
  if (tables.length === 0) return { kept: 0, emptied: 0 };
  const kept = new Set<string>();
  const emptied = new Set<string>();
  for (const held of tables) {
    for (const holder of held.holders.people) {
      for (const row of await rowsOf(db, view, index, held, holder, asker)) {
        const id = `${held.table.id}\u0000${String(row[held.table.primaryKey[0]!])}`;
        const live = isLive(held.holders.live, row, now);
        await writeRow(db, dialect, held, holder, row, !live);
        (live ? kept : emptied).add(id);
      }
    }
  }
  for (const id of kept) emptied.delete(id);
  return { kept: kept.size, emptied: emptied.size };
}

/** The staff erasure's half: every database that has such a table, by the address, each in its own transaction. */
export async function forgetHeldByAddress(deps: { meta: MetaDb; manager: Pick<ConnectionManager, 'data'>; now: () => number }, address: string): Promise<HeldOutcome> {
  const out: HeldOutcome = { kept: 0, emptied: 0 };
  for (const one of await heldDatabases(deps)) {
    const { db, dialect } = await deps.manager.data(one.connectionId);
    const index = await heldIndex(deps.meta, one.connectionId, one.view);
    const done = await db.transaction().execute((trx) => forgetHeld(trx, dialect, one.view, index, one.tables, { address, key: null, byAddress: true }, deps.now()));
    out.kept += done.kept;
    out.emptied += done.emptied;
  }
  return out;
}

/** How many rows the staff erasure would keep for this address, for what it says stays. Writes nothing. */
export async function countHeldByAddress(deps: { meta: MetaDb; manager: Pick<ConnectionManager, 'data'>; now: () => number }, address: string): Promise<{ connectionId: string; table: string; label: string; count: number }[]> {
  const out: { connectionId: string; table: string; label: string; count: number }[] = [];
  for (const one of await heldDatabases(deps)) {
    const { db } = await deps.manager.data(one.connectionId);
    const index = await heldIndex(deps.meta, one.connectionId, one.view);
    for (const held of one.tables) {
      const live = new Set<string>();
      for (const holder of held.holders.people) {
        for (const row of await rowsOf(db, one.view, index, held, holder, { address, key: null, byAddress: true })) {
          if (isLive(held.holders.live, row, deps.now())) live.add(String(row[held.table.primaryKey[0]!]));
        }
      }
      if (live.size > 0) out.push({ connectionId: one.connectionId, table: held.table.id, label: held.table.table.label ?? held.table.name, count: live.size });
    }
  }
  return out;
}

async function heldDatabases(deps: { meta: MetaDb }): Promise<{ connectionId: string; view: SnapshotView; tables: HolderTable[] }[]> {
  const addOns = (await manifestsRepo(deps.meta, NO_SECRETS).list('add-on')).filter((entry) => entry.row.connectionId !== null && PRESENT.has(entry.row.status));
  const connections = [...new Set(addOns.filter((entry) => ((entry.document as AddOnManifest | null)?.requiredSchema?.tables ?? []).some((table) => table.holders !== undefined)).map((entry) => entry.row.connectionId as string))];
  const out: { connectionId: string; view: SnapshotView; tables: HolderTable[] }[] = [];
  for (const connectionId of connections) {
    let view: SnapshotView;
    try {
      view = await loadSnapshotView(deps.meta, connectionId, { forOthers: true });
    } catch {
      continue;
    }
    const tables = await holderTablesOn(deps.meta, connectionId, view);
    if (tables.length > 0) out.push({ connectionId, view, tables });
  }
  return out;
}

/** Once a day: a kept row whose value has ended loses what was kept for it. Answers how many, per add-on and table. */
export async function sweepKeptHolders(deps: { meta: MetaDb; manager: Pick<ConnectionManager, 'data'>; now?: (() => number) | undefined; log?: { warn(details: object, message: string): void } | undefined }): Promise<Record<string, number>> {
  const now = (deps.now ?? Date.now)();
  const out: Record<string, number> = {};
  for (const one of await heldDatabases(deps)) {
    try {
      const { db, dialect } = await deps.manager.data(one.connectionId);
      for (const held of one.tables) {
        const pk = held.table.primaryKey[0]!;
        for (const holder of held.holders.people) {
          if (!held.table.columns.has(holder.forgotten)) continue;
          const marked = yesOn(dialect);
          let after: unknown;
          for (;;) {
            let query = db.selectFrom(held.table.id as never).selectAll().where(sql.ref(holder.forgotten), '=', marked as never).where(sql.ref(holder.email), 'is not', null);
            if (after !== undefined) query = query.where(sql.ref(pk), '>', after as never);
            const rows = (await query.orderBy(sql.ref(pk) as never).limit(BATCH).execute()) as Row[];
            for (const row of rows) {
              if (isLive(held.holders.live, row, now)) continue;
              await db.transaction().execute((trx) => writeRow(trx, dialect, held, holder, row, true));
              const name = `${held.addOn}:${held.ref}`;
              out[name] = (out[name] ?? 0) + 1;
            }
            if (rows.length < BATCH) break;
            after = rows[rows.length - 1]![pk];
          }
        }
      }
    } catch (error) {
      // A database that cannot be read now is swept on a later day.
      deps.log?.warn({ err: error, connectionId: one.connectionId }, "a kept holder's details could not be emptied today");
    }
  }
  return out;
}
