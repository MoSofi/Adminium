// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `adminium check-source`: whether a visitor's database can be the user's own
 * (`yours`) in a trial, and which tables it has. adminium.app runs it in a
 * one-off container of the trial image, after sign-in and before the trial
 * exists, with the visitor's connection string on stdin.
 *
 * It holds the string to exactly what a trial would: the parameter
 * allow-list (`parseDsn`), the user host's rules (a database port, public
 * addresses only, none of the fleet's: `ADMINIUM_DATABASE_DENY_ADDRESSES`),
 * the user host's TLS defaults, and a driver built from fields, never from the
 * string. It reads the catalog only, never a row, with an overall deadline
 * ({@link CHECK_DEADLINE_MS}), a per-statement timeout, and capped answers
 * ({@link CHECK_MAX_TABLES} tables, {@link CHECK_MAX_COLUMNS} columns each).
 *
 * The answer is one JSON object (the contract with adminium.app):
 *
 *   { ok, class, engine, version, tables: [{ id, schema, name, columns, links, estimate }], schemas }
 *
 *   class     ok | auth | unreachable | dns | tls | refused-by-us | ipv6-only |
 *             no-database | no-permission | too-many | empty
 *   engine    postgres | mysql | null (not a database this could check)
 *   version   the server's version number, e.g. "16.4", "8.4.0", "10.11.6 MariaDB"
 *   tables    `id` = `schema.table` (MySQL: the database's name as the schema);
 *             `columns` = column names in order, at most 200; `links` = the ids of
 *             the tables its foreign keys point at, at most 50; `estimate` = the
 *             database's own row estimate (pg `reltuples`, MySQL `TABLE_ROWS`),
 *             null when it has none. Views included; partitions folded into their parent.
 *   schemas   the schemas the login can see, at most 100, system ones left out.
 *
 * `too-many` carries the first 500 tables. Never a row, never the server's own
 * message: a driver's error can quote the address, the login or the password.
 */
import { Kysely, sql, type Dialect as KyselyDialect } from 'kysely';
import { isIP } from 'node:net';

import { AdapterError, adapterRegistry, type AdapterProvider, type AdapterRegistry, type DatabaseAdapter, type DatabaseEndpoint, type QueryEngine } from '@adminium/engine/adapter';

import { HostLookupFailedError } from '../errors.js';
import type { HostLookup } from '../net/address-guard.js';
import type { YourDatabaseReason } from '../project/your-database-state.js';
import { checkDsn, parseDsn, type DatabaseHost, type ParsedDsn } from './dsn.js';
import { userPortRefusal, type DenyRange } from './user-host.js';

export const CHECK_DEADLINE_MS = 15_000;
export const CHECK_STATEMENT_TIMEOUT_MS = 5_000;
export const CHECK_MAX_TABLES = 500;
export const CHECK_MAX_COLUMNS = 200;
export const CHECK_MAX_LINKS = 50;
export const CHECK_MAX_SCHEMAS = 100;
/** Column names in the whole answer at most: past it, later tables list fewer. Keeps the line under a few MB. */
export const CHECK_MAX_COLUMNS_TOTAL = 40_000;

export type CheckClass = 'ok' | YourDatabaseReason | 'too-many';

export const CHECK_CLASSES: readonly CheckClass[] = ['ok', 'auth', 'unreachable', 'dns', 'tls', 'refused-by-us', 'ipv6-only', 'no-database', 'no-permission', 'too-many', 'empty'];

export interface CheckTable {
  id: string;
  schema: string;
  name: string;
  columns: string[];
  links: string[];
  estimate: number | null;
}

export interface CheckSourceResult {
  ok: boolean;
  class: CheckClass;
  engine: 'postgres' | 'mysql' | null;
  version: string | null;
  tables: CheckTable[];
  schemas: string[];
}

export interface CheckSourceOptions {
  /** `ADMINIUM_DATABASE_DENY_ADDRESSES`. */
  denyAddresses?: readonly DenyRange[] | undefined;
  /** Default: the process registry (the CLI registers the adapters first). */
  registry?: AdapterRegistry<AdapterProvider> | undefined;
  /** Test seam: the lookup. */
  lookup?: HostLookup | undefined;
  /** Default {@link CHECK_DEADLINE_MS}. */
  deadlineMs?: number | undefined;
  /**
   * TESTS ONLY, never set by the command: hosts held to the operator-list rule
   * instead of the user host's, so a suite can check a database on this machine.
   * Under it the user host's TLS defaults do not apply either.
   */
  testListedHosts?: readonly DatabaseHost[] | undefined;
}

function answer(cls: CheckClass, engine: CheckSourceResult['engine'] = null, extra: Partial<CheckSourceResult> = {}): CheckSourceResult {
  return { ok: cls === 'ok', class: cls, engine, version: null, tables: [], schemas: [], ...extra };
}

/** `16.4`, `8.4.0`, `10.11.6 MariaDB`: the number the server gave, nothing else it said. */
export function shortVersion(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const match = /(\d+(?:\.\d+){0,2})/.exec(raw);
  if (match === null) return null;
  return /mariadb/i.test(raw) ? `${match[1] ?? ''} MariaDB` : (match[1] ?? null);
}

const NETWORK_V6 = /\b(ENETUNREACH|EHOSTUNREACH|EADDRNOTAVAIL|EAFNOSUPPORT)\b/;

/** An adapter's failure as a class, read from its typed code and the driver's code, never its words. */
export function classOfAdapterError(error: AdapterError, ipv6Only: boolean): CheckClass {
  const detail = error.detail ?? '';
  switch (error.code) {
    case 'AUTH':
      return /^(3D000|ER_BAD_DB_ERROR)\b/.test(detail) ? 'no-database' : 'auth';
    case 'TLS':
      return 'tls';
    case 'PERMISSION':
      return /^(ER_DBACCESS_DENIED_ERROR)\b/.test(detail) ? 'no-database' : 'no-permission';
    case 'HOST_UNREACHABLE':
      if (/\bENOTFOUND\b|\bEAI_AGAIN\b/.test(detail)) return 'dns';
      return ipv6Only && NETWORK_V6.test(detail) ? 'ipv6-only' : 'unreachable';
    default:
      return 'unreachable';
  }
}

function withDeadline<T>(work: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    work,
    new Promise<T>((resolve) => {
      timer = setTimeout(() => {
        resolve(onTimeout());
      }, ms);
      timer.unref();
    }),
  ]).finally(() => {
    clearTimeout(timer);
  });
}

/** Close quietly, and never wait long: a socket that hangs must not hold the one-off container. */
async function settle(close: () => Promise<unknown>): Promise<void> {
  await withDeadline(
    close().catch(() => undefined),
    2_000,
    () => undefined,
  );
}

const PG_SYSTEM = `n.nspname NOT LIKE 'pg\\_%' AND n.nspname <> 'information_schema'`;
const MYSQL_SYSTEM = ['mysql', 'information_schema', 'performance_schema', 'sys'];

interface Catalog {
  tables: CheckTable[];
  /** More than {@link CHECK_MAX_TABLES} exist. */
  more: boolean;
  schemas: string[];
  /** Tables exist that the login may not read. */
  hidden: boolean;
}

type Db = Kysely<Record<string, never>>;

function num(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : typeof value === 'bigint' ? Number(value) : Number.NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : Buffer.isBuffer(value) ? value.toString('utf8') : String(value ?? '');
}

/** Fill columns and links in, holding the whole answer to its caps. */
function assemble(
  rows: readonly { schema: string; name: string; estimate: number | null }[],
  columns: readonly { schema: string; name: string; column: string }[],
  links: readonly { schema: string; name: string; target: string }[],
): CheckTable[] {
  const byId = new Map<string, CheckTable>();
  for (const row of rows) {
    const id = `${row.schema}.${row.name}`;
    byId.set(id, { id, schema: row.schema, name: row.name, columns: [], links: [], estimate: row.estimate });
  }
  let total = 0;
  for (const column of columns) {
    const table = byId.get(`${column.schema}.${column.name}`);
    if (table === undefined || table.columns.length >= CHECK_MAX_COLUMNS || total >= CHECK_MAX_COLUMNS_TOTAL) continue;
    table.columns.push(column.column);
    total += 1;
  }
  for (const link of links) {
    const table = byId.get(`${link.schema}.${link.name}`);
    if (table === undefined || table.links.length >= CHECK_MAX_LINKS || table.links.includes(link.target)) continue;
    table.links.push(link.target);
  }
  return [...byId.values()];
}

async function postgresCatalog(db: Db): Promise<Catalog> {
  const schemas = await sql<{ name: string }>`
    SELECT n.nspname AS name FROM pg_catalog.pg_namespace n
    WHERE ${sql.raw(PG_SYSTEM)} AND n.nspname <> 'pg_toast' AND has_schema_privilege(n.oid, 'USAGE')
    ORDER BY 1 LIMIT ${sql.lit(CHECK_MAX_SCHEMAS)}`.execute(db);
  const listed = await sql<{ schema: string; name: string; estimate: unknown; oid: unknown; readable: boolean }>`
    SELECT n.nspname AS schema, c.relname AS name, c.reltuples AS estimate, c.oid AS oid,
           has_schema_privilege(n.oid, 'USAGE') AND has_table_privilege(c.oid, 'SELECT') AS readable
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f') AND NOT c.relispartition AND ${sql.raw(PG_SYSTEM)}
    ORDER BY (has_schema_privilege(n.oid, 'USAGE') AND has_table_privilege(c.oid, 'SELECT')) DESC, n.nspname, c.relname
    LIMIT ${sql.lit(CHECK_MAX_TABLES + 1)}`.execute(db);
  const readable = listed.rows.filter((row) => row.readable === true);
  const more = readable.length > CHECK_MAX_TABLES;
  const kept = readable.slice(0, CHECK_MAX_TABLES);
  const hidden = listed.rows.length > readable.length;
  if (kept.length === 0) return { tables: [], more: false, schemas: schemas.rows.map((row) => row.name), hidden };
  const oids = kept.map((row) => String(row.oid));
  const columns = await sql<{ schema: string; name: string; column: string }>`
    SELECT n.nspname AS schema, c.relname AS name, a.attname AS column
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid = a.attrelid JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE a.attrelid = ANY(${oids}::oid[]) AND a.attnum > 0 AND a.attnum <= ${sql.lit(CHECK_MAX_COLUMNS * 2)} AND NOT a.attisdropped
    ORDER BY a.attrelid, a.attnum`.execute(db);
  const links = await sql<{ schema: string; name: string; target: string }>`
    SELECT n.nspname AS schema, c.relname AS name, tn.nspname || '.' || t.relname AS target
    FROM pg_catalog.pg_constraint k
    JOIN pg_catalog.pg_class c ON c.oid = k.conrelid JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_class t ON t.oid = k.confrelid JOIN pg_catalog.pg_namespace tn ON tn.oid = t.relnamespace
    WHERE k.contype = 'f' AND k.conrelid = ANY(${oids}::oid[])
    ORDER BY 1, 2, 3 LIMIT ${sql.lit(CHECK_MAX_TABLES * CHECK_MAX_LINKS)}`.execute(db);
  // `reltuples` is -1 for a table never analysed (Postgres 14+): no estimate, not "none".
  const rows = kept.map((row) => {
    const estimate = num(row.estimate);
    return { schema: row.schema, name: row.name, estimate: estimate === null ? null : estimate };
  });
  return { tables: assemble(rows, columns.rows, links.rows), more, schemas: schemas.rows.map((row) => row.name), hidden };
}

async function mysqlCatalog(db: Db, database: string | null): Promise<Catalog> {
  const system = sql.join(MYSQL_SYSTEM.map((name) => sql.lit(name)));
  const schemas = await sql<{ name: unknown }>`
    SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA
    WHERE SCHEMA_NAME NOT IN (${system}) ${database === null ? sql`` : sql`AND SCHEMA_NAME = ${database}`}
    ORDER BY 1 LIMIT ${sql.lit(CHECK_MAX_SCHEMAS)}`.execute(db);
  const names = schemas.rows.map((row) => str(row.name));
  if (database !== null && names.length === 0) return { tables: [], more: false, schemas: [], hidden: false };
  const where = database === null ? sql`TABLE_SCHEMA NOT IN (${system})` : sql`TABLE_SCHEMA = ${database}`;
  const listed = await sql<{ schema: unknown; name: unknown; estimate: unknown; kind: unknown }>`
    SELECT TABLE_SCHEMA AS \`schema\`, TABLE_NAME AS name, TABLE_ROWS AS estimate, TABLE_TYPE AS kind
    FROM information_schema.TABLES WHERE ${where}
    ORDER BY TABLE_SCHEMA, TABLE_NAME LIMIT ${sql.lit(CHECK_MAX_TABLES + 1)}`.execute(db);
  const more = listed.rows.length > CHECK_MAX_TABLES;
  const kept = listed.rows.slice(0, CHECK_MAX_TABLES).map((row) => ({
    schema: str(row.schema),
    name: str(row.name),
    // A view has no row estimate.
    estimate: str(row.kind) === 'VIEW' ? null : num(row.estimate),
  }));
  if (kept.length === 0) return { tables: [], more: false, schemas: names, hidden: false };
  const columns = await sql<{ schema: unknown; name: unknown; column: unknown }>`
    SELECT TABLE_SCHEMA AS \`schema\`, TABLE_NAME AS name, COLUMN_NAME AS \`column\`
    FROM information_schema.COLUMNS WHERE ${where} AND ORDINAL_POSITION <= ${sql.lit(CHECK_MAX_COLUMNS)}
    ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION LIMIT ${sql.lit(CHECK_MAX_COLUMNS_TOTAL * 2)}`.execute(db);
  const links = await sql<{ schema: unknown; name: unknown; tschema: unknown; tname: unknown }>`
    SELECT DISTINCT TABLE_SCHEMA AS \`schema\`, TABLE_NAME AS name, REFERENCED_TABLE_SCHEMA AS tschema, REFERENCED_TABLE_NAME AS tname
    FROM information_schema.KEY_COLUMN_USAGE WHERE ${where} AND REFERENCED_TABLE_NAME IS NOT NULL
    ORDER BY 1, 2, 3, 4 LIMIT ${sql.lit(CHECK_MAX_TABLES * CHECK_MAX_LINKS)}`.execute(db);
  return {
    tables: assemble(
      kept,
      columns.rows.map((row) => ({ schema: str(row.schema), name: str(row.name), column: str(row.column) })),
      links.rows.map((row) => ({ schema: str(row.schema), name: str(row.name), target: `${str(row.tschema)}.${str(row.tname)}` })),
    ),
    more,
    schemas: names,
    hidden: false,
  };
}

/** The catalog on one connection, each statement under the timeout. */
async function readCatalog(engine: QueryEngine, scheme: 'postgres' | 'mysql', parsed: ParsedDsn): Promise<Catalog> {
  const db = new Kysely<Record<string, never>>({ dialect: engine.dialect as KyselyDialect });
  try {
    return await db.connection().execute(async (conn) => {
      if (scheme === 'mysql') {
        // MySQL's and MariaDB's own names for a statement's limit; whichever the server does not know, it refuses.
        await sql`SET SESSION max_execution_time = ${sql.lit(CHECK_STATEMENT_TIMEOUT_MS)}`.execute(conn).catch(() => undefined);
        await sql`SET SESSION max_statement_time = ${sql.lit(CHECK_STATEMENT_TIMEOUT_MS / 1000)}`.execute(conn).catch(() => undefined);
        let database: string | null = parsed.database;
        if (database !== null) {
          try {
            database = decodeURIComponent(database);
          } catch {
            // as written
          }
        }
        return mysqlCatalog(conn as Db, database);
      }
      return postgresCatalog(conn as Db);
    });
  } finally {
    await settle(() => db.destroy());
  }
}

/** Check one connection string. Never throws: every failure is a class. */
export async function checkSource(dsn: string, opts: CheckSourceOptions = {}): Promise<CheckSourceResult> {
  const deadline = opts.deadlineMs ?? CHECK_DEADLINE_MS;
  const closers: (() => Promise<unknown>)[] = [];
  let finished = false;
  // A handle opened after the deadline answered is closed at once: nothing may hold the one-off container open.
  const hold = (close: () => Promise<unknown>): void => {
    if (finished) void settle(close);
    else closers.push(close);
  };
  let engine: CheckSourceResult['engine'] = null;
  const work = (async (): Promise<CheckSourceResult> => {
    let parsed: ParsedDsn;
    try {
      parsed = parseDsn(dsn.trim());
    } catch {
      return answer('refused-by-us');
    }
    if (parsed.scheme === 'sqlite' || parsed.host === null || parsed.port === null) return answer('refused-by-us');
    const scheme = parsed.scheme;
    engine = scheme;
    const testListed = opts.testListedHosts;
    if (testListed === undefined && userPortRefusal(parsed.port) !== null) return answer('refused-by-us', scheme);
    let endpoint: DatabaseEndpoint;
    try {
      const checked = await checkDsn(dsn.trim(), {
        engine: scheme,
        blockLoopback: true,
        blockPrivate: true,
        hideAddresses: true,
        lookup: opts.lookup,
        ...(testListed === undefined
          ? { userHost: { host: parsed.host.toLowerCase(), port: parsed.port }, denyAddresses: opts.denyAddresses }
          : { databaseHosts: testListed }),
      });
      if (checked.endpoint === null) return answer('refused-by-us', scheme);
      endpoint = checked.endpoint;
    } catch (error) {
      return answer(error instanceof HostLookupFailedError ? 'dns' : 'refused-by-us', scheme);
    }
    const addresses = endpoint.addresses ?? [];
    const ipv6Only = addresses.length > 0 && addresses.every((address) => isIP(address) === 6);
    const registry = opts.registry ?? adapterRegistry;
    if (!registry.has(scheme)) return answer('unreachable', scheme);
    const provider = registry.get(scheme);
    let adapter: DatabaseAdapter<'introspect'>;
    try {
      adapter = await provider.create({ role: 'introspect', endpoint, poolMax: 1, statementTimeoutMs: CHECK_STATEMENT_TIMEOUT_MS });
    } catch (error) {
      return answer(error instanceof AdapterError ? classOfAdapterError(error, ipv6Only) : 'unreachable', scheme);
    }
    hold(() => adapter.close());
    const test = await adapter.test();
    if (!test.ok) return answer(test.error === undefined ? 'unreachable' : classOfAdapterError(test.error, ipv6Only), scheme);
    const version = shortVersion(test.serverVersion);
    let catalog: Catalog;
    try {
      const queries = await provider.createQueryEngine({ role: 'data', endpoint, poolMax: 1, statementTimeoutMs: CHECK_STATEMENT_TIMEOUT_MS });
      hold(() => queries.destroy());
      catalog = await readCatalog(queries, scheme, parsed);
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      const permission = error instanceof AdapterError ? error.code === 'PERMISSION' : code === '42501' || (typeof code === 'string' && /ACCESS_DENIED/.test(code));
      return answer(permission ? 'no-permission' : error instanceof AdapterError ? classOfAdapterError(error, ipv6Only) : 'unreachable', scheme, { version });
    }
    const extra = { version, tables: catalog.tables, schemas: catalog.schemas };
    if (catalog.more) return answer('too-many', scheme, extra);
    if (catalog.tables.length === 0) {
      if (scheme === 'mysql' && parsed.database !== null && catalog.schemas.length === 0) return answer('no-database', scheme, extra);
      return answer(catalog.hidden ? 'no-permission' : 'empty', scheme, extra);
    }
    return answer('ok', scheme, extra);
  })();
  const result = await withDeadline(
    work.catch(() => answer('unreachable', engine)),
    deadline,
    () => answer('unreachable', engine),
  );
  finished = true;
  await Promise.all(closers.map((close) => settle(close)));
  return result;
}
