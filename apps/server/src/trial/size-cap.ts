// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A trial's size caps: how much live data each database on the operator's
 * host may hold, and how much the data folder may.
 *
 * Trial mode only (`trialPolicy(env).limits`); an ordinary server and the
 * hosted profile have no caps, and this module is never built for them.
 *
 * ─── A database on the operator's host ─────────────────────────────────────
 *
 * Every source on a listed host that is not the person's own Supabase project
 * is measured: at boot, every 10 minutes, before each import, and again soon
 * after anything is written to it (an import, a Designer apply, a bulk write,
 * a single row: the connection's statements say so, `connections/write-hold.ts`).
 * A delete is measured again within seconds, so the person is not left
 * waiting for the next round.
 *
 * WHAT IS MEASURED IS LIVE DATA, not the files on the database server's disk.
 * `pg_database_size()` and the tables' own sizes do not shrink after a DELETE
 * until a `VACUUM FULL`: a database measured that way could never get back
 * under its limit. Each table's rows are read and the stored size of every
 * value added up ({@link measurePostgres}, {@link measureMysql}): neither the
 * order rows were written in nor a sample can hide any, a delete counts at
 * once, and a vacuum cannot bring back what was deleted. Indexes count an
 * entry per live row where that can be worked out, else their size in the
 * share of rows still live. A dropped column's values stay in the rows
 * written before the drop until the table is rewritten, so a table that
 * dropped one counts them too: on Postgres each row's whole stored size, on
 * MySQL its files in the share of its rows still there (on MariaDB, which
 * shows no sign of such a column, every InnoDB table does). The most rows
 * such a table held is kept in the operator tallies, so a restart does not
 * count again what a delete let go. Nothing counts more than the table's
 * files. A table that did not change since its last
 * reading is not read again, and one that cannot be read in time counts its
 * files. Tables named `adminium_*` are left out only where the meta store
 * shares the database.
 *
 * Over `ADMINIUM_TRIAL_DATA_MAX_MB`, the connection is HELD BY THE SIZE CAP:
 * nothing that adds to the database runs (INSERT, UPDATE, DDL that adds),
 * DELETE, TRUNCATE and DROP do. The hold is its own state, kept here: the
 * connection probe rewrites the connection's `readOnly` flag every time it
 * runs and never touches it, and a pause keeps it. It lets go once the
 * database is back under 90% of the limit, so it does not flap at the line.
 * The readings live in memory, so after a restart, a wake, a resume or a
 * changed connection, a write that adds or changes waits for its database's
 * first reading ({@link SizeCap.settle}).
 *
 * ─── The data folder ───────────────────────────────────────────────────────
 *
 * Every file under `ADMINIUM_DATA_DIR` counts (uploads, the embedded meta
 * store, exports, add-ons), and so does the project folder the Designer
 * writes to, less its packages and history: walked at boot and every 10
 * minutes, with what is stored in between added as it is stored. An upload
 * keeps room for itself first ({@link SizeCap.reserve}), so uploads side by
 * side cannot all pass on the same room. Past
 * `ADMINIUM_TRIAL_STORAGE_MAX_MB`, uploads, Designer writes and exports are
 * refused (`refuseStorage`); Export everything is not, as it is the way out.
 *
 * ─── Told to others ────────────────────────────────────────────────────────
 *
 * {@link SizeCap.listen} hears every reading (a database's, the data
 * folder's), for whoever sends the operator word of a folder over 80%.
 */
import { createHash } from 'node:crypto';
import { lstat, opendir } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

import { detectServerFlavor } from '@adminium/adapter-mysql';
import type { OperatorTalliesRepo } from '@adminium/meta';
import { sql, type Kysely } from 'kysely';

import { databaseHostListed, parseDsn, type DatabaseHost } from '../connections/dsn.js';
import type { StatementEffect, WriteHold, WriteWatch } from '../connections/write-hold.js';
import { OffByOperatorError } from './refuse.js';
import { isOwnSupabaseHost } from './sources.js';
import type { TrialLimits } from './policy.js';

/** How often every database and the data folder are measured. */
export const SIZE_CAP_INTERVAL_MS = 10 * 60 * 1000;
/** A held database lets go below this share of its limit. */
export const RELEASE_SHARE = 0.9;
/** After a delete: soon, once the statement's transaction has most likely ended. */
const AFTER_DELETE_MS = 2_000;
/**
 * After a delete, while held: once more, past the 10 seconds an idle
 * Postgres connection may keep its counts before it sends them, which a
 * table's TOAST chunks are read from.
 */
const AFTER_DELETE_LATE_MS = 12_000;
/** After a write that adds: measured again at most this often, so a stream of single rows costs one reading a while. */
const AFTER_GROWTH_MS = 30_000;
/** After a file is stored: the data folder walked again, once the burst is over. */
const AFTER_STORE_MS = 5_000;
/** How long a write waits for the first reading of its database before it is refused. */
const SETTLE_WAIT_MS = 20_000;

const MB = 1024 * 1024;

declare module 'fastify' {
  interface FastifyInstance {
    /** This server's size caps; null outside trial mode (`compose.ts`), absent on a server built without it. */
    sizeCap?: SizeCap | null;
  }
}

type AnyDb = Kysely<never> | Kysely<Record<string, Record<string, unknown>>>;

/** One database's last reading. */
export interface DataReading {
  connectionId: string;
  usedBytes: number;
  limitBytes: number;
  /** ISO 8601. */
  measuredAt: string;
  held: boolean;
}

/** The data folder's last reading. */
export interface StorageReading {
  usedBytes: number;
  limitBytes: number;
  /** ISO 8601; null before the first walk. */
  measuredAt: string | null;
  over: boolean;
}

/** Room kept in the data folder for one write under way. */
export interface StorageReservation {
  /** Stored, `bytes` of it: counted, and the room let go. */
  done(bytes: number): void;
  /** Nothing stored: the room let go. */
  cancel(): void;
}

export type SizeCapEvent = ({ kind: 'data' } & DataReading) | ({ kind: 'storage' } & StorageReading);

/** What the size cap reads of the connections. */
export interface SizeCapSources {
  /** Whether the meta store lives in the database `dataDsn` names: then its `adminium_*` tables do not count. */
  metaSharesDatabaseWith?(dataDsn: string | null): boolean;
  connections: {
    list(): Promise<readonly { id: string; engine: string; sourceKind: string; disabled: boolean }[]>;
    findById(id: string): Promise<{ id: string; engine: string; sourceKind: string; disabled: boolean } | null>;
    getDsns(id: string): Promise<{ dataDsn: string | null } | null>;
  };
  data(connectionId: string): Promise<{ db: AnyDb }>;
  readonly databaseHosts: readonly DatabaseHost[];
}

export interface SizeCapOptions {
  limits: Pick<TrialLimits, 'dataMaxBytes' | 'storageMaxBytes'>;
  sources: SizeCapSources;
  dataDir: string;
  /** Other folders this server writes a person's files to (the project the Designer edits): counted with the data folder. */
  folders?: readonly string[] | undefined;
  log?: { warn(fields: object, message: string): void } | undefined;
  clock?: (() => number) | undefined;
  /** Where a MySQL table's peak rows are kept beyond a restart ({@link tallyPeaks}); none: in memory alone. */
  tallies?: PeakTallies | undefined;
  /** Test seam: how a database is measured (default {@link measurePostgres} and {@link measureMysql}). */
  measureWith?: ((engine: 'postgres' | 'mysql', db: AnyDb, options: MeasureOptions) => Promise<number>) | undefined;
  /** Test seam: the delays of {@link AFTER_DELETE_MS}, {@link AFTER_DELETE_LATE_MS}, {@link AFTER_GROWTH_MS}, {@link AFTER_STORE_MS}, {@link SETTLE_WAIT_MS}. */
  delays?: Partial<{ afterDelete: number; afterDeleteLate: number; afterGrowth: number; afterStore: number; settleWait: number }> | undefined;
}

export interface SizeCap extends WriteWatch {
  /** Every database's last reading. */
  readings(): DataReading[];
  reading(connectionId: string): DataReading | null;
  /** Measure one database now (a reading in flight is shared). Null when it is not on an operator host. */
  measure(connectionId: string): Promise<DataReading | null>;
  /** Measure every database and walk the data folder. */
  measureAll(): Promise<void>;
  /** Measured first, then refused while held: what an import asks before it starts. */
  beforeImport(connectionId: string): Promise<void>;
  storage(): StorageReading;
  measureStorage(): Promise<StorageReading>;
  /** Throws 403 `OFF_BY_OPERATOR` while the data folder is past its limit. */
  refuseStorage(): void;
  /**
   * Room for a file of at most `bytes` about to be stored: refused (403) while
   * the data folder is past its limit, or would be with what other writes under
   * way have kept. Told what was stored, or that nothing was.
   */
  reserve(bytes: number): StorageReservation;
  /** A file of `bytes` was just stored under the data folder. */
  stored(bytes: number): void;
  /** Every reading, as it is taken. Answers a function that stops listening. */
  listen(listener: (event: SizeCapEvent) => void): () => void;
  /** Measure now and every 10 minutes after. */
  start(): void;
  stop(): void;
}

/** The sentence a held database's refusal carries (the dashboard has its own words). */
export function dataCapMessage(limitBytes: number): string {
  return `This database is over the trial's ${String(Math.round(limitBytes / MB))} MB limit, so it is read-only. Delete some rows to continue.`;
}

/** The sentence a write carries when its database has not been measured since the server started or the connection changed. */
export function dataNotMeasuredMessage(limitBytes: number): string {
  return `This database is being measured against the trial's ${String(Math.round(limitBytes / MB))} MB limit. Try again in a moment.`;
}

export function storageCapMessage(limitBytes: number): string {
  return `This installation's files are over the trial's ${String(Math.round(limitBytes / MB))} MB limit, so nothing more can be stored. Delete some files to continue.`;
}

/** Whether a source is a database on the operator's host: listed, and not the person's own Supabase project. */
export function onOperatorHost(dataDsn: string, hosts: readonly DatabaseHost[]): boolean {
  let parsed;
  try {
    parsed = parseDsn(dataDsn);
  } catch {
    return false;
  }
  if (parsed.scheme === 'sqlite' || parsed.host === null) return false;
  return databaseHostListed(hosts, parsed) && !isOwnSupabaseHost(parsed.host);
}

/** How one database is measured. */
export interface MeasureOptions {
  /** The meta store shares this database: its `adminium_*` tables are Adminium's own and do not count. */
  skipMetaTables?: boolean | undefined;
  /** What each table measured to last time, kept by whoever measures this database again; a table that did not change is not read again. */
  memo?: TableMemo | undefined;
  /** Every table read again, whatever the memo says: right after a delete, before the database's own counts have caught up. */
  fresh?: boolean | undefined;
  /** How long reading the tables may take in all; what is left counts its size on disk. */
  budgetMs?: number | undefined;
  /** MySQL: where each table's peak rows (`TableMemo` `rows`) are kept beyond the memo, so a restart does not lose them. */
  peaks?: TablePeaks | undefined;
}

/** A MySQL database's tables' peak rows, kept where a restart does not lose them. */
export interface TablePeaks {
  /** The kept peak of each table in `present` that has one; a table not in it is gone, and its peak let go. */
  read(present: readonly string[]): Promise<Map<string, number>>;
  /** Keep `rows` as the table's peak, unless a higher one is kept. */
  raise(table: string, rows: number): Promise<void>;
  /** The table holds no dropped values any more: its peak let go. */
  forget(table: string): Promise<void>;
}

/** What {@link tallyPeaks} uses of the operator tallies. */
export type PeakTallies = Pick<OperatorTalliesRepo, 'list' | 'raise' | 'release'>;

const PEAK_TALLY = 'size-peak:';
const digest = (text: string, length: number): string => createHash('sha256').update(text).digest('hex').slice(0, length);

/**
 * Peaks kept in the operator tallies, which only the server writes and no
 * restore brings back, so the person cannot set a peak higher to count less.
 * A tally is named for the database (`database`: the connection and where it
 * points, so a connection pointed elsewhere starts afresh) and the table,
 * both hashed to fit the 40 characters of a tally's name.
 */
export function tallyPeaks(tallies: PeakTallies, database: string): TablePeaks {
  const prefix = `${PEAK_TALLY}${digest(database, 16)}:`;
  const nameOf = (table: string): string => `${prefix}${digest(table, 13)}`;
  return {
    async read(present) {
      const tables = new Map(present.map((table) => [nameOf(table), table]));
      const kept = new Map<string, number>();
      for (const tally of await tallies.list(prefix)) {
        const table = tables.get(tally.name);
        if (table === undefined) await tallies.release(tally.name);
        else kept.set(table, tally.amount);
      }
      return kept;
    },
    raise: (table, rows) => tallies.raise(nameOf(table), rows),
    forget: (table) => tallies.release(nameOf(table)),
  };
}

/**
 * Per table: what it was measured to, and the figures that say whether it
 * changed since. `rows`: on MySQL, the most rows the table held while it kept
 * a dropped column's values, against which a delete lets its pages go (kept
 * beyond a restart in `peaks`).
 */
export type TableMemo = Map<string, { key: string; bytes: number; rows?: number }>;

/** Below this on disk, a table counts its size as it stands: reading its rows would cost more than the difference. */
const SMALL_TABLE_BYTES = 128 * 1024;
/** Reading every table of one database stops after this; the rest count their size on disk. */
const MEASURE_BUDGET_MS = 30_000;
/** A table someone else holds locked is not waited on for longer: it counts its size on disk. */
const LOCK_WAIT_MS = 2_000;
/** Postgres: each row's header and its slot in the page. */
const PG_ROW_BYTES = 28;
/** Postgres: a row's slot in the page alone (a whole row's stored size carries its header). */
const PG_ROW_SLOT_BYTES = 4;
/** Postgres: each b-tree entry's header and slot, and the largest entry a b-tree takes. */
const PG_INDEX_ENTRY_BYTES = 16;
const PG_INDEX_ENTRY_MAX = 2_720;
/** How full a b-tree's pages are kept. */
const BTREE_FILL = 0.9;
/** Postgres: the data one TOAST chunk holds (8 KB pages). */
const PG_TOAST_CHUNK_BYTES = 1_996;
/** MySQL: each row's header and its place in the page. */
const MYSQL_ROW_BYTES = 20;

const quotePg = (name: string): string => `"${name.replaceAll('"', '""')}"`;
const quoteMysql = (name: string): string => `\`${name.replaceAll('`', '``')}\``;

/** A JSON value a driver handed back parsed or as text. */
function parsedJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return (value ?? fallback) as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** The time a reading of the tables has left, from `budgetMs`. */
function budgetFrom(options: MeasureOptions): () => number {
  const until = Date.now() + (options.budgetMs ?? MEASURE_BUDGET_MS);
  return () => until - Date.now();
}

interface PgTable {
  id: string;
  name: string;
  table: number | string;
  indexes: number | string;
  live: number | string | null;
  dead: number | string | null;
  inserted: number | string | null;
  updated: number | string | null;
  deleted: number | string | null;
  toast_chunks: number | string | null;
  /** Whether a column of the table was ever dropped (absent from a test's stand-in). */
  dropped?: boolean | null;
  columns: unknown;
  index_list: unknown;
}

/**
 * The live data of a Postgres database, in bytes.
 *
 * Each table's rows are read and their stored sizes added up
 * (`pg_column_size` of each value: a long value counts what TOAST keeps of
 * it, without being fetched), so neither the order rows were written in nor a
 * sample can hide any of them, and a delete counts at once. A table's
 * b-tree indexes count an entry per live row, from the same values; any other
 * index counts its size scaled by the share of rows still live. In a
 * table that dropped a column, each row counts its whole stored size, which
 * keeps the dropped values written before the drop, until a rewrite (`VACUUM
 * FULL`, `CLUSTER`, a column type change) leaves them behind. Nothing
 * counts more than the table's files hold. A table that did not change since
 * the last reading (`memo`) is not read again; a small one counts its files.
 * Large objects the login owns count their length.
 *
 * Every catalog name is written in full and the search path set to the
 * catalog alone, so a table of the person's named like a catalog cannot stand
 * in for it.
 */
export async function measurePostgres(db: AnyDb, options: MeasureOptions = {}): Promise<number> {
  const k = db as Kysely<never>;
  const left = budgetFrom(options);
  const skip = options.skipMetaTables === true;
  const catalog = await k.transaction().execute(async (trx) => {
    await sql`set local search_path = pg_catalog, pg_temp`.execute(trx);
    await sql`set local lock_timeout = ${sql.lit(LOCK_WAIT_MS)}`.execute(trx);
    const { rows: tables } = await sql<PgTable>`/* size-cap:tables */
      select c.oid::pg_catalog.text as id,
             pg_catalog.quote_ident(n.nspname) || '.' || pg_catalog.quote_ident(c.relname) as name,
             pg_catalog.pg_table_size(c.oid)::pg_catalog.float8 as "table",
             pg_catalog.pg_indexes_size(c.oid)::pg_catalog.float8 as indexes,
             s.n_live_tup::pg_catalog.float8 as live,
             s.n_dead_tup::pg_catalog.float8 as dead,
             s.n_tup_ins::pg_catalog.float8 as inserted,
             s.n_tup_upd::pg_catalog.float8 as updated,
             s.n_tup_del::pg_catalog.float8 as deleted,
             (select ts.n_live_tup from pg_catalog.pg_stat_all_tables ts where ts.relid = c.reltoastrelid)::pg_catalog.float8 as toast_chunks,
             exists (select 1 from pg_catalog.pg_attribute a
                      where a.attrelid = c.oid and a.attnum > 0 and a.attisdropped) as dropped,
             (select pg_catalog.json_agg(a.attname order by a.attnum)
                from pg_catalog.pg_attribute a
               where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped) as columns,
             (select pg_catalog.json_agg(pg_catalog.json_build_object(
                       'bytes', pg_catalog.pg_relation_size(i.indexrelid),
                       'btree', am.amname = 'btree' and i.indexprs is null,
                       'keys', (select pg_catalog.json_agg(a.attname order by k.at)
                                  from pg_catalog.unnest(i.indkey::pg_catalog.int2[]) with ordinality as k(attnum, at)
                                  join pg_catalog.pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum)))
                from pg_catalog.pg_index i
                join pg_catalog.pg_class ic on ic.oid = i.indexrelid
                join pg_catalog.pg_am am on am.oid = ic.relam
               where i.indrelid = c.oid) as index_list
        from pg_catalog.pg_class c
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        left join pg_catalog.pg_stat_all_tables s on s.relid = c.oid
       where c.relkind in ('r', 'm')
         and n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
         and n.nspname not like 'pg\\_temp\\_%'
         and n.nspname not like 'pg\\_toast\\_temp\\_%'
         and (${sql.lit(!skip)} or c.relname not like 'adminium\\_%')
    `.execute(trx);
    return tables;
  });

  let bytes = await largeObjectBytes(k);
  for (const table of catalog) {
    const onDisk = Number(table.table) + Number(table.indexes);
    if (onDisk <= SMALL_TABLE_BYTES) {
      bytes += onDisk;
      continue;
    }
    const key = [table.table, table.indexes, table.live, table.dead, table.inserted, table.updated, table.deleted, table.toast_chunks].map(String).join(':');
    const known = options.memo?.get(table.id);
    if (known !== undefined && known.key === key && options.fresh !== true) {
      bytes += known.bytes;
      continue;
    }
    const measured = left() > 0 ? await readPgTable(k, table, left()) : null;
    // A table that could not be read in time (or at all): its files, which order and samples cannot shrink.
    const tableBytes = measured ?? onDisk;
    if (measured !== null) options.memo?.set(table.id, { key, bytes: tableBytes });
    else options.memo?.delete(table.id);
    bytes += tableBytes;
  }
  return Math.round(bytes);
}

/** One table's live data, read row by row; null when it could not be read within `timeoutMs`. */
async function readPgTable(db: Kysely<never>, table: PgTable, timeoutMs: number): Promise<number | null> {
  const columns = parsedJson<string[] | null>(table.columns, null) ?? [];
  const indexes = parsedJson<{ bytes: number; btree: boolean; keys: string[] | null }[] | null>(table.index_list, null) ?? [];
  const size = (column: string): string => `coalesce(pg_catalog.pg_column_size(t.${quotePg(column)}), 0)`;
  const values = [String(PG_ROW_BYTES), ...columns.map(size)].join(' + ');
  // A dropped column's values stay in each row written before the drop, out of reach by name; the whole row's stored size still holds them.
  const row = table.dropped === true ? `greatest(${values}, ${String(PG_ROW_SLOT_BYTES)} + pg_catalog.pg_column_size(t.*))` : values;
  const btrees = indexes.filter((index) => index.btree && index.keys !== null && index.keys.length > 0);
  const entries = btrees.map(
    (index, at) => `coalesce(sum(least(${[String(PG_INDEX_ENTRY_BYTES), ...(index.keys ?? []).map(size)].join(' + ')}, ${String(PG_INDEX_ENTRY_MAX)})), 0)::pg_catalog.float8 as i${String(at)}`,
  );
  try {
    return await db.transaction().execute(async (trx) => {
      await sql`set local search_path = pg_catalog, pg_temp`.execute(trx);
      await sql`set local lock_timeout = ${sql.lit(LOCK_WAIT_MS)}`.execute(trx);
      await sql`set local statement_timeout = ${sql.lit(Math.max(1, Math.ceil(timeoutMs)))}`.execute(trx);
      const { rows } = await sql<Record<string, number | string | null>>`/* size-cap:rows */
        select count(*)::pg_catalog.float8 as n, coalesce(sum(${sql.raw(row)}), 0)::pg_catalog.float8 as data${sql.raw(entries.map((entry) => `, ${entry}`).join(''))}
          from only ${sql.raw(table.name)} t
      `.execute(trx);
      const read = rows[0] ?? {};
      const live = Number(read['n'] ?? 0);
      const dead = Number(table.dead ?? 0);
      // Values kept out of the page: TOAST's own count of its chunks says what it holds, whatever the rows say.
      let total = Math.max(Number(read['data'] ?? 0), Number(table.toast_chunks ?? 0) * PG_TOAST_CHUNK_BYTES);
      for (const index of indexes) {
        const at = btrees.indexOf(index);
        const estimate = at === -1 ? (live + dead === 0 ? 0 : (index.bytes * live) / (live + dead)) : Number(read[`i${String(at)}`] ?? 0) / BTREE_FILL;
        total += Math.min(index.bytes, estimate);
      }
      // Never more than the table's files hold.
      return Math.min(total, Number(table.table) + Number(table.indexes));
    });
  } catch {
    return null;
  }
}

/** The length of every large object the login owns; when they cannot be read, the size of where they are kept. */
async function largeObjectBytes(db: Kysely<never>): Promise<number> {
  try {
    return await db.transaction().execute(async (trx) => {
      await sql`set local search_path = pg_catalog, pg_temp`.execute(trx);
      // Opened to read (0x40000) and sought to the end: its length, without reading it.
      const { rows } = await sql<{ bytes: number | string | null }>`/* size-cap:large-objects */
        select coalesce(sum(pg_catalog.lo_lseek64(pg_catalog.lo_open(m.oid, 262144), 0, 2)), 0)::pg_catalog.float8 as bytes
          from pg_catalog.pg_largeobject_metadata m
         where m.lomowner = (select r.oid from pg_catalog.pg_roles r where r.rolname = current_user)
      `.execute(trx);
      return Number(rows[0]?.bytes ?? 0);
    });
  } catch {
    const { rows } = await sql<{ bytes: number | string | null }>`/* size-cap:large-objects-disk */
      select pg_catalog.pg_total_relation_size('pg_catalog.pg_largeobject'::pg_catalog.regclass)::pg_catalog.float8 as bytes
    `.execute(db);
    return Number(rows[0]?.bytes ?? 0);
  }
}

/**
 * The live data of a MySQL database, in bytes: each table's rows read and
 * the length of each value added up, so neither the order rows were written
 * in nor a sample can hide any of them, and a delete counts at once. Its
 * indexes count in the share its data pages are still filled (InnoDB's pages
 * do not shrink after a delete). A table that did not change since the last
 * reading (`memo`) is not read again; a small one counts its pages.
 *
 * A column dropped in place (MySQL 8.0.29 and later) leaves its values in
 * every row written before the drop until the table is rebuilt, and no
 * statement can read them. The server lists such a column as hidden, and
 * while it does the table counts at least its pages in the share of its rows
 * still there, against the most rows it held while it was seen so (none
 * seen: all of its pages). That peak is kept in the memo and in `peaks`, so
 * a restart does not count again the pages a delete let go. A rebuild
 * (`OPTIMIZE TABLE`, `ALTER TABLE … FORCE`, `TRUNCATE`) takes the hidden
 * column away and the measure back to the values; a table no longer there
 * has its peak let go, so one made again under its name starts afresh.
 *
 * MariaDB (10.4 and later) drops a column in place too, but lists no sign of
 * it: `SHOW EXTENDED COLUMNS` does not exist there, the dropped column is
 * kept only in a hidden record inside the table, and the `INNODB_SYS_*`
 * tables need the PROCESS privilege, which a shared host does not give, and
 * are not documented to mark it either. So on MariaDB every InnoDB table
 * counts as if it held dropped values: never less than its pages in the
 * share of its rows still there. That counts the free room in its pages too,
 * but nothing a person stores can hide.
 */
export async function measureMysql(db: AnyDb, options: MeasureOptions = {}): Promise<number> {
  const left = budgetFrom(options);
  const skip = options.skipMetaTables === true;
  return (db as Kysely<never>).connection().execute(async (connection) => {
    // Fresh figures, not the cache MySQL 8 keeps for a day by default. An older server has no such cache.
    await sql`set session information_schema_stats_expiry = 0`.execute(connection).catch(() => undefined);
    const unseenDrops = await dropsColumnsUnseen(connection);
    const { rows: tables } = await sql<{ name: string; rows: number | string | null; data: number | string | null; indexes: number | string | null; updated: unknown; engine?: unknown }>`/* size-cap:tables */
      select table_name as name, table_rows as \`rows\`, data_length as data, index_length as indexes, update_time as updated, engine as engine
        from information_schema.tables
       where table_schema = database()
         and table_type = 'BASE TABLE'
         and (${sql.lit(!skip)} or table_name not like 'adminium\\_%')
    `.execute(connection);
    const { rows: columns } = await sql<{ tableName: string; columnName: string }>`/* size-cap:columns */
      select table_name as \`tableName\`, column_name as \`columnName\`
        from information_schema.columns
       where table_schema = database()
         and extra not like '%VIRTUAL%'
       order by table_name, ordinal_position
    `.execute(connection);
    const byTable = new Map<string, string[]>();
    for (const column of columns) {
      const list = byTable.get(column.tableName);
      if (list === undefined) byTable.set(column.tableName, [column.columnName]);
      else list.push(column.columnName);
    }
    const present = tables.map((table) => table.name);
    // A table gone takes its peak with it: one made again under its name has rows of its own.
    if (options.memo !== undefined) {
      const there = new Set(present);
      for (const name of [...options.memo.keys()]) if (!there.has(name)) options.memo.delete(name);
    }
    // Not kept, or not readable: every table seen so starts from its rows now, which counts more, not less.
    const kept = options.peaks === undefined ? new Map<string, number>() : await options.peaks.read(present).catch(() => new Map<string, number>());
    let bytes = 0;
    for (const table of tables) {
      const data = Number(table.data ?? 0);
      const indexes = Number(table.indexes ?? 0);
      if (data + indexes <= SMALL_TABLE_BYTES) {
        bytes += data + indexes;
        // Rebuilt or emptied: a peak kept from before would let a table that grows again count less.
        if (kept.has(table.name)) await options.peaks?.forget(table.name).catch(() => undefined);
        continue;
      }
      const key = [table.rows, data, indexes, table.updated instanceof Date ? table.updated.toISOString() : table.updated].map(String).join(':');
      const known = options.memo?.get(table.name);
      if (known !== undefined && known.key === key && options.fresh !== true) {
        bytes += known.bytes;
        continue;
      }
      const lengths = [String(MYSQL_ROW_BYTES), ...(byTable.get(table.name) ?? []).map((column) => `coalesce(length(${quoteMysql(column)}), 0)`)].join(' + ');
      let live: number | null = null;
      let count = 0;
      let dropped = false;
      if (left() > 0) {
        try {
          dropped = unseenDrops ? /^innodb$/i.test(String(table.engine ?? '')) : await holdsDroppedColumn(connection, table.name);
          // The hint stops a read that runs past the budget (MySQL 5.7.8 and later; others read it as a comment).
          const { rows } = await sql<{ live: number | string | null; n: number | string | null }>`/* size-cap:rows */
            select /*+ MAX_EXECUTION_TIME(${sql.raw(String(Math.max(1, Math.ceil(left()))))}) */ coalesce(sum(${sql.raw(lengths)}), 0) as live, count(*) as n
              from ${sql.raw(quoteMysql(table.name))}
          `.execute(connection);
          live = Number(rows[0]?.live ?? 0);
          count = Number(rows[0]?.n ?? 0);
        } catch {
          live = null;
        }
      }
      // A table that could not be read in time (or at all): its pages, which order and samples cannot shrink.
      let tableBytes = live === null ? data + indexes : live + indexes * Math.min(1, data === 0 ? 1 : live / data);
      // Dropped values out of reach: its pages in the share of its rows still there, never less than what was read.
      const keptRows = kept.get(table.name);
      const most = dropped ? Math.max(known?.rows ?? 0, keptRows ?? 0, count) : undefined;
      if (live !== null && most !== undefined && most > 0) tableBytes = Math.max(tableBytes, ((data + indexes) * count) / most);
      if (live !== null) {
        options.memo?.set(table.name, most === undefined ? { key, bytes: tableBytes } : { key, bytes: tableBytes, rows: most });
        // A peak not kept is lost at a restart, which then counts more: a failed write is let pass.
        if (most !== undefined && most > (keptRows ?? 0)) await options.peaks?.raise(table.name, most).catch(() => undefined);
        if (most === undefined && keptRows !== undefined) await options.peaks?.forget(table.name).catch(() => undefined);
      } else options.memo?.delete(table.name);
      bytes += tableBytes;
    }
    return Math.round(bytes);
  });
}

/** Whether the server is MariaDB 10.4 or later, which drops a column in place and lists no sign of it. */
async function dropsColumnsUnseen(connection: Kysely<never>): Promise<boolean> {
  try {
    const { rows } = await sql<{ version?: unknown }>`/* size-cap:version */ select version() as version`.execute(connection);
    const server = detectServerFlavor(String(rows[0]?.version ?? ''));
    return server.flavor === 'mariadb' && (server.major > 10 || (server.major === 10 && server.minor >= 4));
  } catch {
    return false;
  }
}

/**
 * Whether a MySQL table keeps the values of a column dropped in place: listed
 * among its hidden columns until a rebuild. A server that cannot list them
 * (before MySQL 8.0.29 none drops a column in place) says no.
 */
async function holdsDroppedColumn(connection: Kysely<never>, table: string): Promise<boolean> {
  try {
    const { rows } = await sql<{ Field?: unknown }>`/* size-cap:hidden */ show extended columns from ${sql.raw(quoteMysql(table))}`.execute(connection);
    return rows.some((column) => String(column.Field ?? '').startsWith('!hidden!_dropped_'));
  } catch {
    return false;
  }
}

/** In a project folder: what its packages and history hold, which the server's image brings, not the person. */
const NOT_A_PERSONS_FILES: ReadonlySet<string> = new Set(['node_modules', '.git']);

/** Every file under `root`, in bytes, less any folder named in `skip`; links are not followed, a file that went away while walking counts nothing. */
export async function folderBytes(root: string, skip: ReadonlySet<string> = new Set()): Promise<number> {
  let total = 0;
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await opendir(dir);
    } catch {
      return;
    }
    for await (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!skip.has(entry.name)) await walk(path);
      } else if (entry.isFile()) total += await lstat(path).then((stats) => stats.size, () => 0);
    }
  };
  await walk(root);
  return total;
}

/**
 * The data folder's hold for the Designer's own writes (its files, its
 * attachments), which are made far from any route: set as each server is
 * composed, the trial's size cap or none, like the own-code policy
 * (`trial/own-code.ts`). One server per process.
 */
let storageHold: Pick<SizeCap, 'refuseStorage' | 'stored'> | null = null;

export function useStorageHold(hold: Pick<SizeCap, 'refuseStorage' | 'stored'> | null): void {
  storageHold = hold;
}

/**
 * Before the Designer writes a file of `bytes`: refused while the data folder
 * is past its limit, else counted at once (its writes are made in one go, so
 * none runs beside another between the check and the count).
 */
export function refuseDesignerWrite(bytes: number): void {
  storageHold?.refuseStorage();
  storageHold?.stored(bytes);
}

/** `roots` without any that sits inside another, so no file is walked twice. */
function outermost(roots: readonly string[]): string[] {
  const all = [...new Set(roots.map((root) => resolve(root)))];
  return all.filter((root) => !all.some((other) => other !== root && (root + sep).startsWith(other.endsWith(sep) ? other : other + sep)));
}

export function createSizeCap(opts: SizeCapOptions): SizeCap {
  const clock = opts.clock ?? Date.now;
  const afterDelete = opts.delays?.afterDelete ?? AFTER_DELETE_MS;
  const afterDeleteLate = opts.delays?.afterDeleteLate ?? AFTER_DELETE_LATE_MS;
  const afterGrowth = opts.delays?.afterGrowth ?? AFTER_GROWTH_MS;
  const afterStore = opts.delays?.afterStore ?? AFTER_STORE_MS;
  const settleWait = opts.delays?.settleWait ?? SETTLE_WAIT_MS;
  const { dataMaxBytes, storageMaxBytes } = opts.limits;
  const measureWith =
    opts.measureWith ?? ((engine: 'postgres' | 'mysql', db: AnyDb, options: MeasureOptions) => (engine === 'postgres' ? measurePostgres(db, options) : measureMysql(db, options)));
  const dataDir = resolve(opts.dataDir);
  const folders = outermost([dataDir, ...(opts.folders ?? [])]);

  const readings = new Map<string, DataReading>();
  /** Sources found not to be on an operator host: a write to one asks nothing until the next round, or its handle opens again. */
  const notMeasured = new Set<string>();
  /**
   * Sources measured (or found not to need it) since their data handle last
   * opened: a write to any other waits for its first reading. The holds live
   * in memory, so after a restart, a wake or a change of the connection, no
   * write that adds goes through before the database has been measured again.
   */
  const settled = new Set<string>();
  /** Bumped each time a source's data handle opens: a reading begun before it does not settle it. */
  const opens = new Map<string, number>();
  /** Per source, what each table measured to last time, in the database it pointed at then. */
  const memos = new Map<string, { database: string; memo: TableMemo }>();
  const inFlight = new Map<string, Promise<DataReading | null>>();
  const timers = new Map<string, { at: number; timer: NodeJS.Timeout; fresh: boolean }>();
  const listeners = new Set<(event: SizeCapEvent) => void>();
  let storage: StorageReading = { usedBytes: 0, limitBytes: storageMaxBytes, measuredAt: null, over: false };
  /** Bytes kept for writes to the data folder under way. */
  let reserved = 0;
  let storageWalk: Promise<StorageReading> | null = null;
  let storageTimer: NodeJS.Timeout | null = null;
  let round: NodeJS.Timeout | null = null;
  let stopped = false;

  const tell = (event: SizeCapEvent): void => {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (error) {
        opts.log?.warn({ err: error }, 'a size cap listener failed');
      }
    }
  };

  const measureOnce = async (connectionId: string, fresh: boolean): Promise<DataReading | null> => {
    let opened = opens.get(connectionId) ?? 0;
    const settle = (): void => {
      if ((opens.get(connectionId) ?? 0) === opened) settled.add(connectionId);
    };
    const connection = await opts.sources.connections.findById(connectionId);
    if (connection === null) {
      readings.delete(connectionId);
      memos.delete(connectionId);
      notMeasured.add(connectionId);
      settle();
      return null;
    }
    // A paused source keeps its last reading: a hold is let go by a reading, never by a pause.
    if (connection.disabled) return readings.get(connectionId) ?? null;
    const dataDsn =
      connection.sourceKind !== 'dsn' || (connection.engine !== 'postgres' && connection.engine !== 'mysql')
        ? null
        : ((await opts.sources.connections.getDsns(connectionId))?.dataDsn ?? null);
    if (dataDsn === null || !onOperatorHost(dataDsn, opts.sources.databaseHosts)) {
      readings.delete(connectionId);
      memos.delete(connectionId);
      notMeasured.add(connectionId);
      settle();
      return null;
    }
    notMeasured.delete(connectionId);
    const { db } = await opts.sources.data(connectionId);
    // Opening the handle for this reading is no reason to read again.
    opened = opens.get(connectionId) ?? 0;
    // The connection and where it points: a connection pointed at another database knows nothing of its tables.
    const target = parseDsn(dataDsn);
    const database = [connectionId, target.host, String(target.port), target.database ?? ''].join('\u0000');
    let memo = memos.get(connectionId);
    if (memo?.database !== database) {
      memo = { database, memo: new Map() };
      memos.set(connectionId, memo);
    }
    // Postgres or MySQL: anything else was set aside above.
    const usedBytes = await measureWith(connection.engine as 'postgres' | 'mysql', db, {
      memo: memo.memo,
      fresh,
      skipMetaTables: opts.sources.metaSharesDatabaseWith?.(dataDsn) ?? false,
      ...(opts.tallies === undefined || connection.engine !== 'mysql' ? {} : { peaks: tallyPeaks(opts.tallies, database) }),
    });
    const wasHeld = readings.get(connectionId)?.held ?? false;
    const held = wasHeld ? usedBytes >= dataMaxBytes * RELEASE_SHARE : usedBytes > dataMaxBytes;
    const reading: DataReading = { connectionId, usedBytes, limitBytes: dataMaxBytes, measuredAt: new Date(clock()).toISOString(), held };
    readings.set(connectionId, reading);
    settle();
    tell({ kind: 'data', ...reading });
    return reading;
  };

  /** Measure `connectionId` now; a reading in flight is shared, unless this one must read every table again and that one may not. */
  const measureFresh = (connectionId: string, fresh: boolean): Promise<DataReading | null> => {
    const pending = inFlight.get(connectionId);
    if (pending !== undefined) {
      if (!fresh) return pending;
      return pending.catch(() => null).then(() => measureFresh(connectionId, true));
    }
    const next = measureOnce(connectionId, fresh).finally(() => {
      if (inFlight.get(connectionId) === next) inFlight.delete(connectionId);
    });
    inFlight.set(connectionId, next);
    return next;
  };
  const measure = (connectionId: string): Promise<DataReading | null> => measureFresh(connectionId, false);

  const measureQuietly = (connectionId: string, fresh: boolean): Promise<DataReading | null> =>
    measureFresh(connectionId, fresh).catch((error: unknown) => {
      // An unreachable database keeps its last reading: a hold is not let go because a check failed.
      opts.log?.warn({ err: error, connectionId }, 'the size cap could not measure a database');
      return null;
    });

  /** Measure `connectionId` in `delay`, unless a reading is already due sooner; `then` hears that reading. */
  const measureIn = (connectionId: string, delay: number, fresh = false, then?: (reading: DataReading | null) => void): void => {
    if (stopped) return;
    const at = clock() + delay;
    const due = timers.get(connectionId);
    if (due !== undefined && due.at <= at) {
      due.fresh ||= fresh;
      return;
    }
    if (due !== undefined) clearTimeout(due.timer);
    const freshNow = fresh || (due?.fresh ?? false);
    const timer = setTimeout(() => {
      const fired = timers.get(connectionId);
      timers.delete(connectionId);
      void measureQuietly(connectionId, fired?.fresh ?? freshNow).then((reading) => then?.(reading));
    }, delay);
    timer.unref();
    timers.set(connectionId, { at, timer, fresh: freshNow });
  };

  const measureStorage = (): Promise<StorageReading> => {
    if (storageWalk !== null) return storageWalk;
    storageWalk = Promise.all(folders.map((folder) => folderBytes(folder, folder === dataDir ? undefined : NOT_A_PERSONS_FILES)))
      .then((sizes) => {
        const usedBytes = sizes.reduce((sum, size) => sum + size, 0);
        storage = { usedBytes, limitBytes: storageMaxBytes, measuredAt: new Date(clock()).toISOString(), over: usedBytes > storageMaxBytes };
        tell({ kind: 'storage', ...storage });
        return storage;
      })
      .finally(() => {
        storageWalk = null;
      });
    return storageWalk;
  };

  const measureAll = async (): Promise<void> => {
    const connections = await opts.sources.connections.list();
    const present = new Set(connections.map((connection) => connection.id));
    notMeasured.clear();
    for (const id of readings.keys()) if (!present.has(id)) readings.delete(id);
    for (const id of memos.keys()) if (!present.has(id)) memos.delete(id);
    for (const connection of connections) {
      try {
        await measure(connection.id);
      } catch (error) {
        opts.log?.warn({ err: error, connectionId: connection.id }, 'the size cap could not measure a database');
      }
    }
    await measureStorage();
  };

  const refuseStorage = (): void => {
    if (storage.over) throw new OffByOperatorError('storageOverCap', 'size-cap', storageCapMessage(storageMaxBytes));
  };

  const stored = (bytes: number): void => {
    if (bytes > 0) {
      storage = { ...storage, usedBytes: storage.usedBytes + bytes, over: storage.usedBytes + bytes > storageMaxBytes };
    }
    if (stopped || storageTimer !== null) return;
    storageTimer = setTimeout(() => {
      storageTimer = null;
      measureStorage().catch(() => undefined);
    }, afterStore);
    storageTimer.unref();
  };

  return {
    held(connectionId): WriteHold | null {
      if (readings.get(connectionId)?.held !== true) return null;
      return { question: 'dataOverCap', reason: 'size-cap', message: dataCapMessage(dataMaxBytes) };
    },
    async settle(connectionId) {
      if (settled.has(connectionId) || notMeasured.has(connectionId)) return;
      let timer: NodeJS.Timeout | undefined;
      const waited = new Promise<'late'>((done) => {
        timer = setTimeout(() => done('late'), settleWait);
        timer.unref();
      });
      try {
        const outcome = await Promise.race([measure(connectionId), waited]);
        if (outcome !== 'late') return;
      } catch (error) {
        opts.log?.warn({ err: error, connectionId }, 'the size cap could not measure a database before a write');
      } finally {
        clearTimeout(timer);
      }
      // Not measured yet, so not known to be under its limit: nothing is added until it is.
      throw new OffByOperatorError('dataOverCap', 'size-cap', dataNotMeasuredMessage(dataMaxBytes));
    },
    opened(connectionId) {
      opens.set(connectionId, (opens.get(connectionId) ?? 0) + 1);
      settled.delete(connectionId);
      notMeasured.delete(connectionId);
    },
    wrote(connectionId, effect: Exclude<StatementEffect, 'read'>) {
      if (notMeasured.has(connectionId)) return;
      if (effect === 'shrink') {
        // Held: every table read again soon, and once more after the database's own counts have caught up, so the hold lets go as soon as it may.
        const held = readings.get(connectionId)?.held === true;
        measureIn(connectionId, afterDelete, held, (reading) => {
          if (held && reading?.held === true) measureIn(connectionId, Math.max(0, afterDeleteLate - afterDelete), true);
        });
        return;
      }
      measureIn(connectionId, Math.max(0, Date.parse(readings.get(connectionId)?.measuredAt ?? '0') + afterGrowth - clock()));
    },
    readings: () => [...readings.values()],
    reading: (connectionId) => readings.get(connectionId) ?? null,
    measure,
    measureAll,
    async beforeImport(connectionId) {
      const reading = await measure(connectionId);
      if (reading?.held === true) throw new OffByOperatorError('dataOverCap', 'size-cap', dataCapMessage(dataMaxBytes));
    },
    storage: () => storage,
    measureStorage,
    refuseStorage,
    reserve(bytes) {
      refuseStorage();
      // Writes under way count as stored: many at once cannot all pass on the same room.
      if (reserved > 0 && storage.usedBytes + reserved > storageMaxBytes) {
        throw new OffByOperatorError('storageOverCap', 'size-cap', storageCapMessage(storageMaxBytes));
      }
      const kept = Math.max(0, bytes);
      reserved += kept;
      let open = true;
      const letGo = (): boolean => {
        if (!open) return false;
        open = false;
        reserved -= kept;
        return true;
      };
      return {
        done(actual) {
          if (letGo()) stored(actual);
        },
        cancel() {
          letGo();
        },
      };
    },
    stored,
    listen(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start() {
      stopped = false;
      const run = (): void => {
        measureAll().catch((error: unknown) => opts.log?.warn({ err: error }, 'the size cap could not measure'));
      };
      run();
      round = setInterval(run, SIZE_CAP_INTERVAL_MS);
      round.unref();
    },
    stop() {
      stopped = true;
      if (round !== null) clearInterval(round);
      round = null;
      for (const { timer } of timers.values()) clearTimeout(timer);
      timers.clear();
      if (storageTimer !== null) clearTimeout(storageTimer);
      storageTimer = null;
    },
  };
}
