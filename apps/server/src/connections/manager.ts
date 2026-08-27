// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ConnectionManager — the three-connection privilege model at runtime
 * (01-architecture.md §3, M3-T04):
 *
 * - `introspect` — a short-lived adapter instance per introspection run,
 * - `data`      — a pooled dynamic-Kysely handle per connection (the CRUD
 *                 query port, 08-server-api.md §2.7), created lazily and
 *                 disposed on connection delete,
 * - `meta`      — the existing MetaDb; never handed to adapters.
 *
 * Meta-placement enforcement (01 §3.1): when the meta store lives in the
 * same physical database as a source's data DSN and the probed data role is
 * read-only or DDL-less, the manager refuses with `META_PLACEMENT_INVALID`
 * — the rule lives here, not only in the wizard UI. Its boot-time sibling
 * `assertMetaPrefixAvailable` refuses a meta store whose `adminium_*` namespace
 * is already occupied by somebody else (`META_PREFIX_COLLISION`).
 */

import { Kysely, type Dialect as KyselyDialect } from 'kysely';

import {
  AdapterError,
  adapterRegistry,
  type AdapterProvider,
  type AdapterRegistry,
  type CapabilityProbeResult,
  type DatabaseAdapter,
  type QueryEngine,
  type TestResult,
} from '@adminium/engine/adapter';
import type { Dialect } from '@adminium/engine';
import { connectionsRepo, type Connection, type DsnCrypto, type MetaDb } from '@adminium/meta';

import { AppError, ConnectionDisabledError, NotFoundError, ValidationFailedError } from '../errors.js';
import { guardDsn, maskDsn, MetaPlacementError, MetaPrefixCollisionError, sameDatabase } from './dsn.js';

/** Every meta table is `adminium_`-prefixed (07-meta-store.md §2.1). */
export const META_TABLE_PREFIX = 'adminium_';

/**
 * The migration ledger (`migrator.ts` `LEDGER`). Its presence is Adminium's
 * proof of ownership over the other `adminium_*` tables in a database — see
 * {@link ConnectionManager.assertMetaPrefixAvailable}.
 */
export const META_LEDGER_TABLE = 'adminium_migrations';

/** Dynamic source-DB row shape — identifiers are snapshot-validated upstream. */
export type SourceDatabase = Record<string, Record<string, unknown>>;

export interface DataHandle {
  /** Dynamic Kysely over the pooled data connection. */
  db: Kysely<SourceDatabase>;
  engine: QueryEngine;
  /** Source dialect (from the connection row) — drives per-dialect SQL compilation. */
  dialect: Dialect;
}

export interface ConnectionTestSummary {
  ok: boolean;
  latencyMs: number;
  serverVersion: string | null;
  /** The probed data/introspect role cannot write — app runs read-only. */
  readOnly: boolean;
  capabilities: CapabilityProbeResult | null;
  error: { code: string; message: string; hint: string | null } | null;
}

export interface ConnectionManagerOptions {
  meta: MetaDb;
  crypto: DsnCrypto;
  registry?: AdapterRegistry<AdapterProvider> | undefined;
  /**
   * The meta store's own DSN (env `ADMINIUM_META_URL` / bootstrap file).
   * Compared against source data DSNs for the same-db placement check;
   * null/undefined (embedded SQLite meta) can never collide.
   */
  metaDsn?: string | null | undefined;
  /** SSRF guard tuning; default blocks loopback only in production. */
  blockLoopback?: boolean | undefined;
}

/** 502-ish mapping for adapter failures surfaced through API routes. */
export function adapterErrorToAppError(error: AdapterError): AppError {
  const status = error.code === 'AUTH' || error.code === 'PERMISSION' ? 502 : 502;
  return new AppError(status, 'SOURCE_DB_UNREACHABLE', error.message, {
    adapterCode: error.code,
    hint: error.hint,
  });
}

export class ConnectionManager {
  readonly #meta: MetaDb;
  readonly #registry: AdapterRegistry<AdapterProvider>;
  readonly #metaDsn: string | null;
  readonly #blockLoopback: boolean;
  readonly connections: ReturnType<typeof connectionsRepo>;
  readonly #dataHandles = new Map<string, Promise<DataHandle>>();

  constructor(opts: ConnectionManagerOptions) {
    this.#meta = opts.meta;
    this.#registry = opts.registry ?? adapterRegistry;
    this.#metaDsn = opts.metaDsn ?? null;
    this.#blockLoopback = opts.blockLoopback ?? process.env.NODE_ENV === 'production';
    this.connections = connectionsRepo(opts.meta, opts.crypto);
  }

  get meta(): MetaDb {
    return this.#meta;
  }

  provider(engine: string): AdapterProvider {
    return this.#registry.get(engine as never);
  }

  hasAdapter(engine: string): boolean {
    return this.#registry.has(engine as never);
  }

  /** Guard + dial + test + probe one DSN with a short-lived introspect-role instance. */
  async testDsn(engine: string, dsn: string): Promise<ConnectionTestSummary> {
    guardDsn(dsn, { blockLoopback: this.#blockLoopback });
    const provider = this.provider(engine);
    let adapter: DatabaseAdapter<'introspect'> | null = null;
    try {
      // AdapterProvider.create() receives the config and owns the dial.
      adapter = await provider.create({ role: 'introspect', dsn });
      const test: TestResult = await adapter.test();
      if (!test.ok) {
        return {
          ok: false,
          latencyMs: test.latencyMs,
          serverVersion: test.serverVersion,
          readOnly: !test.canWrite,
          capabilities: null,
          error:
            test.error === undefined
              ? { code: 'UNKNOWN', message: 'connection test failed', hint: null }
              : { code: test.error.code, message: test.error.message, hint: test.error.hint },
        };
      }
      const capabilities = await adapter.probeCapabilities();
      return {
        ok: true,
        latencyMs: test.latencyMs,
        serverVersion: test.serverVersion ?? capabilities.serverVersion,
        readOnly: capabilities.currentRole.readOnly || !capabilities.privileges.canWrite,
        capabilities,
        error: null,
      };
    } catch (error) {
      if (error instanceof AdapterError) {
        return {
          ok: false,
          latencyMs: 0,
          serverVersion: null,
          readOnly: false,
          capabilities: null,
          error: { code: error.code, message: error.message, hint: error.hint },
        };
      }
      throw error;
    } finally {
      await adapter?.close().catch(() => undefined);
    }
  }

  /**
   * 01 §3.1 decision-tree rule, re-validated server-side: same-db meta
   * placement is impossible against a read-only or DDL-less data role.
   */
  enforceMetaPlacement(dataDsn: string, probe: ConnectionTestSummary): void {
    if (this.#metaDsn === null) return;
    if (!sameDatabase(this.#metaDsn, dataDsn)) return;
    const privileges = probe.capabilities?.privileges;
    const canWrite = privileges?.canWrite ?? !probe.readOnly;
    const canDDL = privileges?.canDDL ?? false;
    if (!canWrite || !canDDL) {
      throw new MetaPlacementError(
        canWrite
          ? 'This role cannot run DDL — Adminium migrations need CREATE TABLE. Choose a separate database for Adminium’s own tables.'
          : 'Your role is read-only — Adminium never writes to this database. Choose a separate database for Adminium’s own tables.',
        { placement: 'same-db', canWrite, canDDL },
      );
    }
  }

  /**
   * PRE-FLIGHT, run before the first migration touches the meta store: refuse a
   * database that already holds `adminium_*` tables Adminium did not create.
   *
   * WHY IT IS NOT THE MIGRATOR'S JOB. `applyMigrations` is up-only and
   * append-only (07-meta-store.md §4). Pointed at a database that already has,
   * say, an unrelated `adminium_users`, it applies 0001…000N fine and then dies
   * on one `CREATE TABLE` with whatever the driver says — `relation
   * "adminium_users" already exists` — having already created a dozen tables in
   * a database that was never meant to hold them. There is no down migration to
   * undo that, so the operator's only exit is cleaning up by hand. The refusal
   * has to happen while the database is still untouched.
   *
   * THE DISCRIMINATOR IS THE LEDGER, AND ONLY THE LEDGER. "Some `adminium_*`
   * tables are here" cannot distinguish a foreign install from OUR install on
   * every upgrade after the first — which is the common case, and the one this
   * check must never fire on. `adminium_migrations` is created by nothing but
   * the migrator's own `ensureLedger`, so:
   *
   *  - no `adminium_*` tables at all  → a fresh database. Proceed.
   *  - `adminium_migrations` present  → OURS. Proceed, whatever else is there:
   *    an upgrade, a re-run, or a MySQL boot that crashed part-way through the
   *    first migration (no transactional DDL there, so tables can outlive a
   *    failed run and the retry must be allowed through).
   *  - tables but NO ledger           → somebody else's `adminium_*` namespace.
   *    Refuse, and name them.
   *
   * Cheap enough to run on every boot: one introspection round-trip, no rows.
   * Kysely's introspector is the portable spelling of "list the tables" across
   * all three meta dialects; on PostgreSQL it spans every non-system SCHEMA in
   * the database, so a foreign `adminium_*` table parked in a second schema
   * refuses too. Conservative in the right direction — the message names the
   * tables, so the answer is visible rather than guessed at.
   */
  async assertMetaPrefixAvailable(): Promise<void> {
    const tables = await this.#meta.db.introspection.getTables();
    const names = tables
      .map((table) => table.name)
      .filter((name) => name.toLowerCase().startsWith(META_TABLE_PREFIX))
      .sort();
    if (names.length === 0) return;
    if (names.some((name) => name.toLowerCase() === META_LEDGER_TABLE)) return;

    // The DSN is masked: this message reaches stderr, container logs and log
    // shippers, and the meta DSN carries a password (`maskDsn` drops it).
    const where = maskDsn(this.#metaDsn);
    throw new MetaPrefixCollisionError(
      `The meta store already contains ${String(names.length)} table(s) named "${META_TABLE_PREFIX}…" ` +
        `that Adminium did not create: ${names.join(', ')}. ` +
        'Adminium owns the entire "adminium_" table namespace in its own store, and its migrations ' +
        `would collide with these — no "${META_LEDGER_TABLE}" ledger is present, so they are not ours. ` +
        'Either point ADMINIUM_META_URL at a separate database, or drop/rename those tables.',
      { tables: names, metaDsn: where, ledger: META_LEDGER_TABLE },
    );
  }

  async mustFind(connectionId: string): Promise<Connection> {
    const connection = await this.connections.findById(connectionId);
    if (connection === null) {
      throw new NotFoundError('Connection not found.', { connectionId });
    }
    return connection;
  }

  /**
   * The paused-source refusal (meta wave 0019).
   *
   * Every path that would TOUCH the source database goes through it —
   * {@link data}, {@link dataAdapter}, {@link introspectAdapter} — because a
   * pause that only greys out buttons in Studio is not a pause: scheduled
   * reports, export/import jobs, quick search, widget refreshes and the public
   * API all reach the source without a person in the loop, and none of them
   * would ever see that UI.
   *
   * Callers holding the row already (route handlers that just did `mustFind`)
   * pass it in; the rest let the manager load it. `mustFind` itself does NOT
   * refuse — Studio has to be able to read, rename and RESUME a paused
   * connection, and a find that threw would lock the door from the inside.
   */
  assertEnabled(connection: Connection): void {
    if (connection.disabled) {
      throw new ConnectionDisabledError(connection.id, connection.name);
    }
  }

  /**
   * Short-lived introspect-role adapter for one run. The caller owns the
   * lifecycle and must `close()` it (runIntrospection does).
   */
  async introspectAdapter(connectionId: string): Promise<DatabaseAdapter<'introspect'>> {
    const connection = await this.mustFind(connectionId);
    this.assertEnabled(connection);
    if (connection.sourceKind !== 'dsn') {
      throw new ValidationFailedError('Schema-file connections have no live database to introspect.', {
        connectionId,
      });
    }
    const dsns = await this.connections.getDsns(connectionId);
    if (dsns?.introspectDsn == null) {
      throw new ValidationFailedError('Connection has no introspect DSN.', { connectionId });
    }
    guardDsn(dsns.introspectDsn, { blockLoopback: this.#blockLoopback });
    const provider = this.provider(connection.engine);
    return provider.create({ role: 'introspect', dsn: dsns.introspectDsn });
  }

  /**
   * Short-lived DATA-role adapter for one run — the symmetric twin of
   * {@link introspectAdapter}, and the only way to reach the adapter methods
   * that need row access (`collectTableStats`, 06 §4.2). The caller owns the
   * lifecycle and must `close()` it. Deliberately NOT pooled alongside
   * {@link data}: that handle is a long-lived Kysely for CRUD serving, whereas
   * this is opened for one statistics pass and released.
   *
   * The DATA role, not introspect: the introspect role is schema-only by design
   * (§3), so aggregates collected over it would fail on permissions.
   */
  async dataAdapter(connectionId: string): Promise<DatabaseAdapter<'data'>> {
    const connection = await this.mustFind(connectionId);
    this.assertEnabled(connection);
    if (connection.sourceKind !== 'dsn') {
      throw new ValidationFailedError('Schema-file connections have no live database to read.', {
        connectionId,
      });
    }
    const dsns = await this.connections.getDsns(connectionId);
    if (dsns?.dataDsn == null) {
      throw new ValidationFailedError('Connection has no data DSN.', { connectionId });
    }
    guardDsn(dsns.dataDsn, { blockLoopback: this.#blockLoopback });
    const provider = this.provider(connection.engine);
    return provider.create({ role: 'data', dsn: dsns.dataDsn });
  }

  /**
   * Pooled data handle (dynamic Kysely over the data DSN); lazy + cached.
   *
   * Accepts an already-loaded row so the request paths that just called
   * {@link mustFind} — `routes/data`, the CRUD hot path — do not read the same
   * primary key twice. Callers that only hold an id pass the id.
   *
   * The paused check runs on EVERY call, ahead of the cache, and that ordering
   * is the point. The pool is process-local; a pause is a row in the meta
   * store. Checking only on a cold open would leave a warm handle in a second
   * server process happily serving a source somebody switched off — and would
   * make the pause's meaning depend on which worker answered the request.
   */
  async data(connection: string | Connection): Promise<DataHandle> {
    const row = typeof connection === 'string' ? await this.mustFind(connection) : connection;
    this.assertEnabled(row);
    const cached = this.#dataHandles.get(row.id);
    if (cached !== undefined) return cached;
    const pending = this.#openDataHandle(row);
    this.#dataHandles.set(row.id, pending);
    try {
      return await pending;
    } catch (error) {
      this.#dataHandles.delete(row.id);
      throw error;
    }
  }

  async #openDataHandle(connection: Connection): Promise<DataHandle> {
    const connectionId = connection.id;
    const dsns = await this.connections.getDsns(connectionId);
    if (dsns?.dataDsn == null) {
      throw new ValidationFailedError('Connection has no data DSN.', { connectionId });
    }
    guardDsn(dsns.dataDsn, { blockLoopback: this.#blockLoopback });
    const provider = this.provider(connection.engine);
    const engine = await provider.createQueryEngine({ role: 'data', dsn: dsns.dataDsn });
    // The engine package types the dialect opaquely; the server (which owns
    // the kysely dependency) casts at this composition boundary (05 §3).
    const db = new Kysely<SourceDatabase>({ dialect: engine.dialect as KyselyDialect });
    // `connection.engine` is validated against DIALECTS at connection create.
    return { db, engine, dialect: connection.engine as Dialect };
  }

  /** Tear down a connection's pooled handles (connection delete / DSN change). */
  async dispose(connectionId: string): Promise<void> {
    const pending = this.#dataHandles.get(connectionId);
    this.#dataHandles.delete(connectionId);
    if (pending === undefined) return;
    let handle: DataHandle;
    try {
      handle = await pending;
    } catch {
      return; // pool never opened — nothing to release
    }
    // Kysely.destroy() and QueryEngine.destroy() may share one pool — treat
    // a double-close as already-released.
    await handle.db.destroy().catch(() => undefined);
    await handle.engine.destroy().catch(() => undefined);
  }

  /** Graceful shutdown: release every pooled data handle. */
  async disposeAll(): Promise<void> {
    const ids = [...this.#dataHandles.keys()];
    await Promise.all(ids.map(async (id) => this.dispose(id)));
  }
}
