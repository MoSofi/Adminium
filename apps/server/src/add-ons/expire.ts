// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN ADD-ON'S ROWS LET GO WHEN THEY EXPIRE (`expire` on a table of its own).
 *
 * A design a shopper saved and never ordered holds their words, photos and
 * logos: kept for nothing, it is personal data kept for nothing. The add-on
 * says on its table how long such a row lives (`@adminium/manifest`
 * `expire.ts`); the engine, once a day, deletes each row whose `after`
 * moment lies more than `days` days back, unless its `unless` column holds
 * the value given (an ordered design stays). The add-on runs no timer.
 *
 * What is never let go, whatever its age:
 *  - a row with no `after` moment (no age);
 *  - a row an app's table still names through its link into this table
 *    (`addOnLink`): an order line's design stays while the line names it;
 *  - a row another row of the database still points at (a foreign key the
 *    database refuses to break): it is left, and the next day tries again.
 *
 * A message about the row never keeps it (`outbox/release.ts`): a design
 * whose private link was mailed goes on its day all the same. As the row
 * goes, each message that names it lets go of it, in the same transaction:
 * one already sent stays in the log as it was sent (its kind, its address,
 * when it went), naming no row; one not sent yet is skipped, never sent.
 *
 * A row's files go the way any deleted row's do: to the bin, through the
 * file reconciler (`files/reconcile.ts` `trashForRecord`), whose sweep empties
 * it later. The rows are deleted as the system, in batches, never through a
 * person's save (no role's reach, no rule fired).
 */
import type { Dialect } from '@adminium/engine';
import type { AddOnManifest, Expire } from '@adminium/manifest';
import { appTablesRepo, manifestsRepo, type MetaDb, type RecordRef } from '@adminium/meta';
import { sql, type Kysely } from 'kysely';

import type { ConnectionManager, SourceDatabase } from '../connections/manager.js';
import type { ResolvedColumn, ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { deleteRows } from '../crud/write-service.js';
import { bindWriteValue } from '../crud/write-values.js';
import { loadSnapshotView } from '../data-io/snapshot-view.js';
import { ruledBlocksOf } from '../files/column-blocks.js';
import type { FileReconciler } from '../files/reconcile.js';
import type { ReleasedLink } from '../outbox/release.js';
import { rowKeyOf } from '../payments/payables.js';

/** Daily, after the forms' sweeps: an add-on's rows past their time are let go. */
export const ADD_ON_EXPIRE_SWEEP_NAME = 'add-on-expire-sweep';
export const ADD_ON_EXPIRE_SWEEP_CRON = '50 3 * * *';

/** How many rows one round reads and deletes. */
const BATCH = 200;
const DAY_MS = 86_400_000;
/** The statuses whose add-ons' rows are swept: one being changed waits for the next day. */
const SWEPT = new Set(['installed', 'disabled']);

export interface ExpireSweepDeps {
  meta: MetaDb;
  manager: Pick<ConnectionManager, 'data'>;
  /** The bin a deleted row's files go to; absent, only the rows go. */
  files?: Pick<FileReconciler, 'trashForRecord'> | undefined;
  now?: (() => number) | undefined;
  /** The snapshot of a database; the stored one when absent. */
  viewFor?: ((connectionId: string) => Promise<SnapshotView | null>) | undefined;
  log?: { warn(details: object, message: string): void } | undefined;
  /**
   * The outbox links that let go of a table's rows as they go (the
   * producers' `releasing`): a message about a row never keeps it. Absent,
   * a row a message names is left as the database refuses it.
   */
  releases?: ((connectionId: string, tableId: string) => Promise<readonly ReleasedLink[]>) | undefined;
}

/** A credential is never read here: only stored manifests. */
const NO_SECRETS = {
  encrypt: (): string => {
    throw new Error('the expiry sweep never stores a credential');
  },
  decrypt: (): string => {
    throw new Error('the expiry sweep never reads a credential');
  },
};

/** The moment before which a row has expired, bound for its `after` column. */
function cutoffFor(column: ResolvedColumn, now: number, days: number, dialect: Dialect): unknown {
  const at = new Date(now - days * DAY_MS).toISOString();
  return bindWriteValue(column, column.logicalType === 'date' ? at.slice(0, 10) : at, dialect);
}

/** The keys of `keys` an app's table still names through its link into this add-on's table. */
async function stillNamed(db: Kysely<SourceDatabase>, view: SnapshotView, addOn: string, ref: string, keys: readonly unknown[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (const model of view.model.tables) {
    let table: ResolvedTable;
    try {
      table = view.table(model.id);
    } catch {
      continue;
    }
    for (const column of table.table.columns ?? []) {
      if (column.addOnLink?.addOn !== addOn || column.addOnLink.table !== ref) continue;
      const named = (await db
        .selectFrom(table.id as never)
        .select(sql.ref(column.name).as('link') as never)
        .where(sql.ref(column.name), 'in', keys as never)
        .execute()) as { link: unknown }[];
      for (const row of named) if (row.link !== null && row.link !== undefined) out.add(String(row.link));
    }
  }
  return out;
}

/**
 * Deletes one row by its key, its messages letting go of it in the same
 * transaction; false when the database refuses (another row still points at
 * it), and then the messages are as they were.
 */
async function deleteOne(db: Kysely<SourceDatabase>, table: ResolvedTable, key: string, value: unknown, released: readonly ReleasedLink[]): Promise<boolean> {
  try {
    return (await deleteRows(db, table, { [key]: value }, undefined, undefined, released)) > 0;
  } catch {
    return false;
  }
}

/** Lets go of one table's expired rows. Answers how many went. */
async function sweepTable(deps: ExpireSweepDeps, input: { db: Kysely<SourceDatabase>; dialect: Dialect; view: SnapshotView; connectionId: string; addOn: string; ref: string; table: ResolvedTable; expire: Expire; now: number }): Promise<number> {
  const { db, table, expire } = input;
  const key = table.primaryKey.length === 1 ? table.primaryKey[0]! : undefined;
  const after = table.columns.get(expire.after);
  const kept = expire.unless === undefined ? undefined : table.columns.get(expire.unless.column);
  // A table whose key or columns are not as declared is left alone: nothing is guessed.
  if (key === undefined || after === undefined || (expire.unless !== undefined && kept === undefined)) return 0;
  const before = cutoffFor(after, input.now, expire.days, input.dialect);
  const released = (await deps.releases?.(input.connectionId, table.id)) ?? [];
  const keep = kept === undefined ? undefined : bindWriteValue(kept, expire.unless!.equals, input.dialect);
  let gone = 0;
  /** Rows looked at and left (still named, or refused by the database), by their keys: not read again this run. */
  const left = new Map<string, unknown>();
  for (;;) {
    let query = db
      .selectFrom(table.id as never)
      .selectAll()
      .where(sql.ref(expire.after), 'is not', null)
      .where(sql.ref(expire.after), '<', before as never);
    if (kept !== undefined) query = query.where((eb) => eb.or([eb(sql.ref(kept.name) as never, 'is', null), eb(sql.ref(kept.name) as never, '<>', keep as never)]));
    if (left.size > 0) query = query.where(sql.ref(key), 'not in', [...left.values()] as never);
    const due = (await query.orderBy(sql.ref(key) as never).limit(BATCH).execute()) as Row[];
    if (due.length === 0) break;
    const named = await stillNamed(db, input.view, input.addOn, input.ref, due.map((row) => row[key]));
    for (const row of due) {
      const value = row[key];
      if (named.has(String(value)) || !(await deleteOne(db, table, key, value, released))) {
        left.set(String(value), value);
        continue;
      }
      gone += 1;
      // Its files to the bin, as any deleted row's: the row is gone, so they are read from it as it was.
      const entity: RecordRef = { connectionId: input.connectionId, table: table.id, pk: { [key]: value }, label: rowKeyOf(table, row) };
      // The add-on's own file columns (`column.file`) are named: the page blocks alone never list them.
      await deps.files?.trashForRecord({ connectionId: input.connectionId, table: table.id, entity, row, ruled: ruledBlocksOf(table.columns.values()) });
    }
    if (due.length < BATCH) break;
  }
  return gone;
}

/** Lets go of every installed add-on's expired rows (see the header). Answers how many went, per add-on and table. */
export async function sweepExpiredRows(deps: ExpireSweepDeps): Promise<Record<string, number>> {
  const now = (deps.now ?? Date.now)();
  const out: Record<string, number> = {};
  const addOns = (await manifestsRepo(deps.meta, NO_SECRETS).list('add-on')).filter((entry) => entry.row.connectionId !== null && SWEPT.has(entry.row.status));
  for (const entry of addOns) {
    const manifest = entry.document as AddOnManifest | null;
    const expiring = (manifest?.requiredSchema?.tables ?? []).filter((table) => table.expire !== undefined);
    if (expiring.length === 0) continue;
    const connectionId = entry.row.connectionId!;
    const addOn = entry.row.manifestKey;
    try {
      const view = deps.viewFor === undefined ? await loadSnapshotView(deps.meta, connectionId, { forOthers: true }) : await deps.viewFor(connectionId);
      if (view === null) continue;
      const { db, dialect } = await deps.manager.data(connectionId);
      const records = (await appTablesRepo(deps.meta).forInstall(connectionId, addOn)).filter((record) => record.state === 'created' || record.state === 'adopted');
      for (const declared of expiring) {
        const record = records.find((one) => one.ref === declared.ref);
        const model = record === undefined ? undefined : view.model.tables.find((table) => table.name === record.tableName);
        if (model === undefined) continue;
        const gone = await sweepTable(deps, { db, dialect, view, connectionId, addOn, ref: declared.ref, table: view.table(model.id), expire: declared.expire!, now });
        if (gone > 0) out[`${addOn}:${declared.ref}`] = gone;
      }
    } catch (error) {
      // A database that cannot be read or reached now is swept on a later day.
      deps.log?.warn({ err: error, addOn }, "an add-on's expired rows could not be let go today");
    }
  }
  return out;
}
