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
 * under its limit. On Postgres each table counts its live rows
 * (`pg_stat_user_tables.n_live_tup`) times the size of one row as stored,
 * read from a sample of its pages (`pg_column_size` of the whole row, its
 * long values included), plus its indexes scaled by the share of its rows
 * that are live. Scaling the whole table by that share alone is not enough:
 * once autovacuum has cleaned up after a delete, no row is dead any more and
 * the table's size, which a vacuum does not give back, would count in full
 * again. A table whose rows were never counted yet (written a moment ago)
 * counts its full size. Adminium's own `adminium_*` tables do not count.
 *
 * On MySQL each table counts its data and index pages less the free space
 * InnoDB keeps inside them (`information_schema.TABLES`, read fresh, not from
 * the hour-old cache). Free space shows there once InnoDB has purged the
 * deleted rows and merged half-empty pages, so a delete counts within a minute
 * or so, though less exactly than on Postgres.
 *
 * Over `ADMINIUM_TRIAL_DATA_MAX_MB`, the connection is HELD BY THE SIZE CAP:
 * nothing that adds to the database runs (INSERT, UPDATE, DDL that adds),
 * DELETE, TRUNCATE and DROP do. The hold is its own state, kept here: the
 * connection probe rewrites the connection's `readOnly` flag every time it
 * runs and never touches it. It lets go once the database is back under 90%
 * of the limit, so it does not flap at the line.
 *
 * ─── The data folder ───────────────────────────────────────────────────────
 *
 * Every file under `ADMINIUM_DATA_DIR` counts (uploads, the embedded meta
 * store, exports, add-ons), walked at boot and every 10 minutes, with what
 * is stored in between added as it is stored. Past
 * `ADMINIUM_TRIAL_STORAGE_MAX_MB`, uploads, Designer writes and exports are
 * refused (`refuseStorage`).
 *
 * ─── Told to others ────────────────────────────────────────────────────────
 *
 * {@link SizeCap.listen} hears every reading (a database's, the data
 * folder's), for whoever sends the operator word of a folder over 80%.
 */
import { lstat, opendir } from 'node:fs/promises';
import { join } from 'node:path';

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
/** After a delete: long enough for the database's row counts to catch up (Postgres sends them about once a second). */
const AFTER_DELETE_MS = 2_000;
/** After a write that adds: measured again at most this often, so a stream of single rows costs one reading a while. */
const AFTER_GROWTH_MS = 30_000;
/** After a file is stored: the data folder walked again, once the burst is over. */
const AFTER_STORE_MS = 5_000;
/** Rows read from each table to learn the size of one. */
const SAMPLE_ROWS = 500;
/** Pages a sample aims to read from a large table. */
const SAMPLE_PAGES = 64;

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

export type SizeCapEvent = ({ kind: 'data' } & DataReading) | ({ kind: 'storage' } & StorageReading);

/** What the size cap reads of the connections. */
export interface SizeCapSources {
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
  log?: { warn(fields: object, message: string): void } | undefined;
  clock?: (() => number) | undefined;
  /** Test seam: how a database is measured (default {@link measurePostgres} and {@link measureMysql}). */
  measureWith?: ((engine: 'postgres' | 'mysql', db: AnyDb) => Promise<number>) | undefined;
  /** Test seam: the delays of {@link AFTER_DELETE_MS}, {@link AFTER_GROWTH_MS}, {@link AFTER_STORE_MS}. */
  delays?: Partial<{ afterDelete: number; afterGrowth: number; afterStore: number }> | undefined;
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

/**
 * The live data of a Postgres database, in bytes: per table, its live rows
 * times the stored size of one, plus its indexes scaled by the share of its
 * rows that are live. See the module comment for why not the tables' sizes.
 */
export async function measurePostgres(db: AnyDb): Promise<number> {
  const { rows: tables } = await sql<{ name: string; live: number; dead: number; pages: number; total: number; indexes: number }>`
    select quote_ident(s.schemaname) || '.' || quote_ident(s.relname) as name,
           s.n_live_tup::float8 as live,
           s.n_dead_tup::float8 as dead,
           c.relpages::float8 as pages,
           pg_total_relation_size(s.relid)::float8 as total,
           pg_indexes_size(s.relid)::float8 as indexes
      from pg_stat_user_tables s
      join pg_class c on c.oid = s.relid
     where c.relkind in ('r', 'm')
       and s.relname not like 'adminium\\_%'
  `.execute(db as Kysely<never>);
  let bytes = 0;
  for (const table of tables) {
    const live = Number(table.live);
    const dead = Number(table.dead);
    const total = Number(table.total);
    const indexes = Number(table.indexes);
    if (live + dead === 0) {
      // Rows not counted yet (written this second), or a table that never held any: its size as it stands.
      bytes += total;
      continue;
    }
    if (live === 0) continue;
    const rowBytes = await sampledRowBytes(db, table.name, Number(table.pages));
    // A sample that could not be read: the plain share of the table's size that is live.
    const heap = rowBytes === null ? ((total - indexes) * live) / (live + dead) : live * rowBytes;
    bytes += heap + (indexes * live) / (live + dead);
  }
  return Math.round(bytes);
}

/** The average stored size of one row of `name` (already quoted), from a sample of its pages; null when none could be read. */
async function sampledRowBytes(db: AnyDb, name: string, pages: number): Promise<number | null> {
  const percent = pages <= SAMPLE_PAGES ? 100 : Math.max(0.01, (SAMPLE_PAGES * 100) / pages);
  const read = async (from: string): Promise<number | null> => {
    const { rows } = await sql<{ n: number; bytes: number | null }>`
      select count(*)::int as n, avg(pg_column_size(t.*))::float8 as bytes
        from (select * from ${sql.raw(from)} limit ${sql.lit(SAMPLE_ROWS)}) t
    `.execute(db as Kysely<never>);
    const row = rows[0];
    return row === undefined || Number(row.n) === 0 || row.bytes === null ? null : Number(row.bytes) + 4;
  };
  try {
    // Plus 4: each row's slot in its page.
    return (await read(`${name} tablesample system (${String(percent)})`)) ?? (await read(name));
  } catch {
    return null;
  }
}

/**
 * The live data of a MySQL database, in bytes: per table, its rows (InnoDB's
 * own count, read fresh) times the length of one row from a sample, plus its
 * indexes in the share its data pages are still filled. InnoDB's page sizes do
 * not shrink after a delete either, and the free space it reports leaves out
 * the pages a delete only thinned, so neither is used alone.
 */
export async function measureMysql(db: AnyDb): Promise<number> {
  return (db as Kysely<never>).connection().execute(async (connection) => {
    // Fresh figures, not the cache MySQL 8 keeps for a day by default. An older server has no such cache.
    await sql`set session information_schema_stats_expiry = 0`.execute(connection).catch(() => undefined);
    const { rows: tables } = await sql<{ name: string; rows: number | string | null; data: number | string | null; indexes: number | string | null }>`
      select table_name as name, table_rows as \`rows\`, data_length as data, index_length as indexes
        from information_schema.tables
       where table_schema = database()
         and table_type = 'BASE TABLE'
         and table_name not like 'adminium\\_%'
    `.execute(connection);
    const { rows: columns } = await sql<{ tableName: string; columnName: string }>`
      select table_name as \`tableName\`, column_name as \`columnName\`
        from information_schema.columns
       where table_schema = database()
       order by table_name, ordinal_position
    `.execute(connection);
    const quote = (name: string): string => `\`${name.replaceAll('`', '``')}\``;
    let bytes = 0;
    for (const table of tables) {
      const rows = Number(table.rows ?? 0);
      if (rows === 0) continue;
      const lengths = columns.filter((column) => column.tableName === table.name).map((column) => `coalesce(length(${quote(column.columnName)}), 0)`);
      let rowBytes: number | null = null;
      if (lengths.length > 0) {
        try {
          const { rows: sample } = await sql<{ n: number | string; bytes: number | string | null }>`
            select count(*) as n, avg(${sql.raw(lengths.join(' + '))}) as bytes
              from (select * from ${sql.raw(quote(table.name))} limit ${sql.lit(SAMPLE_ROWS)}) t
          `.execute(connection);
          const row = sample[0];
          // Plus 20: each row's header and its place in the page.
          rowBytes = row === undefined || Number(row.n) === 0 || row.bytes === null ? null : Number(row.bytes) + 20;
        } catch {
          rowBytes = null;
        }
      }
      const data = Number(table.data ?? 0);
      const live = rowBytes === null ? data : rows * rowBytes;
      bytes += live + Number(table.indexes ?? 0) * Math.min(1, data === 0 ? 1 : live / data);
    }
    return Math.round(bytes);
  });
}

/** Every file under `root`, in bytes; links are not followed, a file that went away while walking counts nothing. */
export async function folderBytes(root: string): Promise<number> {
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
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) total += await lstat(path).then((stats) => stats.size, () => 0);
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
let storageHold: Pick<SizeCap, 'refuseStorage'> | null = null;

export function useStorageHold(hold: Pick<SizeCap, 'refuseStorage'> | null): void {
  storageHold = hold;
}

/** Before the Designer writes a file: refused while the data folder is past its limit. */
export function refuseDesignerWrite(): void {
  storageHold?.refuseStorage();
}

export function createSizeCap(opts: SizeCapOptions): SizeCap {
  const clock = opts.clock ?? Date.now;
  const afterDelete = opts.delays?.afterDelete ?? AFTER_DELETE_MS;
  const afterGrowth = opts.delays?.afterGrowth ?? AFTER_GROWTH_MS;
  const afterStore = opts.delays?.afterStore ?? AFTER_STORE_MS;
  const { dataMaxBytes, storageMaxBytes } = opts.limits;
  const measureWith = opts.measureWith ?? ((engine: 'postgres' | 'mysql', db: AnyDb) => (engine === 'postgres' ? measurePostgres(db) : measureMysql(db)));

  const readings = new Map<string, DataReading>();
  /** Sources found not to be on an operator host: a write to one asks nothing until the next round looks again. */
  const notMeasured = new Set<string>();
  const inFlight = new Map<string, Promise<DataReading | null>>();
  const timers = new Map<string, { at: number; timer: NodeJS.Timeout }>();
  const listeners = new Set<(event: SizeCapEvent) => void>();
  let storage: StorageReading = { usedBytes: 0, limitBytes: storageMaxBytes, measuredAt: null, over: false };
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

  const measureOnce = async (connectionId: string): Promise<DataReading | null> => {
    const connection = await opts.sources.connections.findById(connectionId);
    const dataDsn =
      connection === null || connection.disabled || connection.sourceKind !== 'dsn' || (connection.engine !== 'postgres' && connection.engine !== 'mysql')
        ? null
        : ((await opts.sources.connections.getDsns(connectionId))?.dataDsn ?? null);
    if (connection === null || dataDsn === null || !onOperatorHost(dataDsn, opts.sources.databaseHosts)) {
      readings.delete(connectionId);
      notMeasured.add(connectionId);
      return null;
    }
    notMeasured.delete(connectionId);
    const { db } = await opts.sources.data(connectionId);
    // Postgres or MySQL: anything else was set aside above.
    const usedBytes = await measureWith(connection.engine as 'postgres' | 'mysql', db);
    const wasHeld = readings.get(connectionId)?.held ?? false;
    const held = wasHeld ? usedBytes >= dataMaxBytes * RELEASE_SHARE : usedBytes > dataMaxBytes;
    const reading: DataReading = { connectionId, usedBytes, limitBytes: dataMaxBytes, measuredAt: new Date(clock()).toISOString(), held };
    readings.set(connectionId, reading);
    tell({ kind: 'data', ...reading });
    return reading;
  };

  const measure = (connectionId: string): Promise<DataReading | null> => {
    const pending = inFlight.get(connectionId);
    if (pending !== undefined) return pending;
    const next = measureOnce(connectionId).finally(() => inFlight.delete(connectionId));
    inFlight.set(connectionId, next);
    return next;
  };

  const measureQuietly = (connectionId: string): void => {
    measure(connectionId).catch((error: unknown) => {
      // An unreachable database keeps its last reading: a hold is not let go because a check failed.
      opts.log?.warn({ err: error, connectionId }, 'the size cap could not measure a database');
    });
  };

  /** Measure `connectionId` in `delay`, unless a reading is already due sooner. */
  const measureIn = (connectionId: string, delay: number): void => {
    if (stopped) return;
    const at = clock() + delay;
    const due = timers.get(connectionId);
    if (due !== undefined && due.at <= at) return;
    if (due !== undefined) clearTimeout(due.timer);
    const timer = setTimeout(() => {
      timers.delete(connectionId);
      measureQuietly(connectionId);
    }, delay);
    timer.unref();
    timers.set(connectionId, { at, timer });
  };

  const measureStorage = (): Promise<StorageReading> => {
    if (storageWalk !== null) return storageWalk;
    storageWalk = folderBytes(opts.dataDir)
      .then((usedBytes) => {
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
    for (const connection of connections) {
      try {
        await measure(connection.id);
      } catch (error) {
        opts.log?.warn({ err: error, connectionId: connection.id }, 'the size cap could not measure a database');
      }
    }
    await measureStorage();
  };

  return {
    held(connectionId): WriteHold | null {
      if (readings.get(connectionId)?.held !== true) return null;
      return { question: 'dataOverCap', reason: 'size-cap', message: dataCapMessage(dataMaxBytes) };
    },
    wrote(connectionId, effect: Exclude<StatementEffect, 'read'>) {
      if (notMeasured.has(connectionId)) return;
      measureIn(connectionId, effect === 'shrink' ? afterDelete : Math.max(0, Date.parse(readings.get(connectionId)?.measuredAt ?? '0') + afterGrowth - clock()));
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
    refuseStorage() {
      if (storage.over) throw new OffByOperatorError('storageOverCap', 'size-cap', storageCapMessage(storageMaxBytes));
    },
    stored(bytes) {
      if (bytes > 0) {
        storage = { ...storage, usedBytes: storage.usedBytes + bytes, over: storage.usedBytes + bytes > storageMaxBytes };
      }
      if (stopped || storageTimer !== null) return;
      storageTimer = setTimeout(() => {
        storageTimer = null;
        measureStorage().catch(() => undefined);
      }, afterStore);
      storageTimer.unref();
    },
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
