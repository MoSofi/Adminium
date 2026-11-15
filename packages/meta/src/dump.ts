// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A meta store as a portable dump: every `adminium_*` table as plain JSON rows
 * that any of the three dialects can load back. The instance archive
 * (`adminium archive create/restore`) writes and reads it.
 *
 * It is `relocate.ts` split in two halves with a file in the middle. Relocation
 * reads a table from one live store and writes it to another; a dump reads the
 * table, keeps what each column PHYSICALLY was on the source (`kinds`), and the
 * load later plans the coercion from those recorded kinds and the target's own
 * columns, with the same `planMetaColumns` and `writeMetaTableRows`. So a
 * SQLite dump loads into Postgres by exactly the rule a SQLite → Postgres
 * relocation follows, and there is one definition of that rule.
 *
 * ONE POINT IN TIME. A dump of a store that is in use is read inside
 * {@link withMetaSnapshot}: one read-only transaction around every table, so a
 * write that lands between two tables is in neither or in both, never half.
 *
 * What a dump is NOT: it carries no ledger (`adminium_migrations` is never
 * dumped, as it is never relocated) and no DDL. The loader expects a target
 * that is migrated to the dump's own level; the archive restore makes sure of
 * that (it migrates an empty target up to the dump's last migration, loads,
 * then runs the rest, so data migrations still apply to old rows).
 */

import { sql } from 'kysely';

import type { MetaDialect } from './columns.js';
import type { MetaDb } from './connect.js';
import { assertMetaTable } from './prefix.js';
import {
  MetaCopyVerificationError,
  MetaRelocateError,
  countMetaTableRows,
  introspectMetaColumnKinds,
  planMetaColumns,
  readMetaTableRows,
  writeMetaTableRows,
  MAX_ROWS_PER_TABLE,
  type MetaColumnKind,
} from './relocate.js';
import { META_TABLE_NAMES, type MetaDB } from './schema/tables.js';

/** One table of a dump. Rows are arrays in `columns` order, to keep the file small. */
export interface MetaTableDump {
  table: string;
  /** camelCase column → what it physically was on the source. */
  kinds: Record<string, MetaColumnKind>;
  columns: string[];
  rows: unknown[][];
}

/** A value JSON can carry. Drivers hand back bigints only past 2^53, which ids and epoch ms never reach. */
function portable(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString();
  }
  if (value instanceof Uint8Array) {
    // No meta column is binary (`columns.ts` has no such helper); a driver that
    // hands one back is reading a column this build does not know.
    throw new MetaRelocateError('A meta column holds binary data, which a dump cannot carry.');
  }
  return value === undefined ? null : value;
}

/**
 * What each dialect says to open a read-only transaction whose every read sees
 * the same committed state, and the read that fixes that state at once.
 *
 *  - SQLite: a deferred transaction, made to read straight away. Under WAL that
 *    read takes the one read view every later statement uses; without WAL it
 *    takes the SHARED lock, which keeps any writer from committing until the
 *    transaction ends (a writer waits for its busy timeout).
 *  - Postgres: REPEATABLE READ, READ ONLY. The snapshot is taken by the first
 *    statement after `start transaction`, hence the `select 1`.
 *  - MySQL/MariaDB: the isolation level for this one transaction first (WITH
 *    CONSISTENT SNAPSHOT means nothing at READ COMMITTED, and a server may
 *    default to it), then a transaction that takes its read view as it starts.
 *    Only InnoDB keeps a read view; every meta table is InnoDB.
 */
const SNAPSHOT_STATEMENTS: Record<MetaDialect, { begin: readonly string[]; pin: string | null }> = {
  sqlite: { begin: ['begin'], pin: 'select count(*) from sqlite_master' },
  postgres: { begin: ['start transaction isolation level repeatable read, read only'], pin: 'select 1' },
  mysql: {
    begin: ['set transaction isolation level repeatable read', 'start transaction with consistent snapshot, read only'],
    pin: null,
  },
};

/**
 * Run `read` against ONE point in time of `meta`: a single read-only
 * transaction on one pinned connection, opened before `read` is called (so
 * nothing committed after this function hands over is seen) and closed after
 * it settles. `read` gets a {@link MetaDb} bound to that transaction and must
 * use nothing else: on SQLite the store has one connection, and a query on
 * `meta` itself would wait for this transaction to end.
 *
 * Read only. A write inside `read` is refused by Postgres and MySQL; nothing
 * here stops one on SQLite, so do not write.
 */
export async function withMetaSnapshot<T>(meta: MetaDb, read: (snapshot: MetaDb) => Promise<T>): Promise<T> {
  if (meta.db.isTransaction) {
    throw new MetaRelocateError('A meta-store snapshot cannot be taken inside another transaction.');
  }
  const statements = SNAPSHOT_STATEMENTS[meta.dialect];
  return meta.db.connection().execute(async (pinned) => {
    for (const statement of statements.begin) await sql.raw(statement).execute(pinned);
    let result: T;
    try {
      if (statements.pin !== null) await sql.raw(statements.pin).execute(pinned);
      result = await read({ db: pinned, dialect: meta.dialect });
    } catch (error) {
      await sql.raw('rollback').execute(pinned).catch(() => undefined);
      throw error;
    }
    // Nothing was written; ending it with COMMIT or ROLLBACK is the same, and COMMIT says the read went through.
    await sql.raw('commit').execute(pinned);
    return result;
  });
}

/** The physical kinds of every `adminium_` table on `meta`, keyed by table. */
export async function metaColumnKinds(meta: MetaDb): Promise<Map<string, Map<string, MetaColumnKind>>> {
  return introspectMetaColumnKinds(meta);
}

/**
 * Dump one table. `kinds` comes from {@link metaColumnKinds} (read once by the
 * caller rather than once per table: introspection lists every table).
 */
export async function dumpMetaTable(
  meta: MetaDb,
  table: string,
  kinds: ReadonlyMap<string, MetaColumnKind>,
): Promise<MetaTableDump> {
  assertMetaTable(table);
  const count = await countMetaTableRows(meta.db, table);
  if (count > MAX_ROWS_PER_TABLE) {
    throw new MetaRelocateError(
      `${table} holds ${String(count)} rows, more than an archive carries in one table ` +
        `(${String(MAX_ROWS_PER_TABLE)}). Back the meta store up with the database's own tools instead.`,
    );
  }
  const columns = [...kinds.keys()];
  const rows = (await readMetaTableRows(meta, table)).map((row) => columns.map((column) => portable(row[column])));
  return { table, kinds: Object.fromEntries(kinds), columns, rows };
}

export interface LoadMetaDumpOptions {
  /**
   * Tables emptied, in the same transaction and before the load, in reverse
   * foreign-key order: the rows a first run seeded (built-in roles, the
   * instance id) that the dump carries its own copy of.
   */
  wipe?: readonly string[] | undefined;
  onTable?: ((table: string, rows: number) => void) | undefined;
}

export interface LoadMetaDumpResult {
  tables: { table: string; rows: number }[];
}

/**
 * Load `tables` into `to` in ONE transaction, in foreign-key order, and check
 * every count against the committed store afterwards. A table the target does
 * not have, or a table outside the `adminium_` namespace, is refused before
 * anything is written.
 */
export async function loadMetaDump(
  to: MetaDb,
  tables: readonly MetaTableDump[],
  opts: LoadMetaDumpOptions = {},
): Promise<LoadMetaDumpResult> {
  const order = new Map<string, number>(META_TABLE_NAMES.map((name, index) => [name, index]));
  const byName = new Map<string, MetaTableDump>();
  for (const dump of tables) {
    assertMetaTable(dump.table);
    if (!order.has(dump.table) || dump.table === 'adminium_migrations') {
      throw new MetaRelocateError(`The dump holds ${dump.table}, which this build does not load.`);
    }
    if (byName.has(dump.table)) throw new MetaRelocateError(`The dump holds ${dump.table} twice.`);
    byName.set(dump.table, dump);
  }

  const targetKinds = await introspectMetaColumnKinds(to);
  const sourceKinds = new Map<string, Map<string, MetaColumnKind>>();
  for (const dump of byName.values()) {
    if (!targetKinds.has(dump.table)) {
      throw new MetaRelocateError(`The target meta store has no ${dump.table} table; it is older than the dump.`);
    }
    sourceKinds.set(dump.table, new Map(Object.entries(dump.kinds)));
  }
  const plan = planMetaColumns(sourceKinds, targetKinds);

  const sorted = [...byName.values()].sort((a, b) => (order.get(a.table) ?? 0) - (order.get(b.table) ?? 0));
  const wipe = [...(opts.wipe ?? [])]
    .filter((table) => targetKinds.has(table))
    .sort((a, b) => (order.get(b) ?? 0) - (order.get(a) ?? 0));
  const loaded: { table: string; rows: number }[] = [];

  await to.db.transaction().execute(async (trx) => {
    for (const table of wipe) {
      assertMetaTable(table);
      await trx.deleteFrom(table as keyof MetaDB).execute();
    }
    for (const dump of sorted) {
      const rows = dump.rows.map((cells) => {
        const row: Record<string, unknown> = {};
        dump.columns.forEach((column, index) => {
          row[column] = cells[index];
        });
        return row;
      });
      const written = rows.length === 0 ? 0 : await writeMetaTableRows(trx, to, dump.table, rows, plan.get(dump.table));
      if (written !== rows.length) throw new MetaCopyVerificationError(dump.table, rows.length, written);
      loaded.push({ table: dump.table, rows: written });
      opts.onTable?.(dump.table, written);
    }
  });

  for (const { table, rows } of loaded) {
    const actual = await countMetaTableRows(to.db, table);
    if (actual !== rows) throw new MetaCopyVerificationError(table, rows, actual);
  }
  return { tables: loaded };
}
