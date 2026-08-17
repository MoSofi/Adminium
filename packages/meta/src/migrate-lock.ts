/**
 * Per-dialect advisory lock around the migration pass (07-meta-store.md §4).
 *
 * WHY IT EXISTS. `docker compose pull && docker compose up -d` with more than
 * one replica — or a PM2 cluster, or a rolling fleet deploy — boots several
 * Adminium processes against one meta store at the same time, and every one of
 * them runs the migration pass. The runner is idempotent per migration, but
 * only PostgreSQL and SQLite are actually defended: there the ledger INSERT
 * shares a transaction with the DDL, so a second runner entering the same
 * pending migration collides on the ledger primary key and rolls back.
 * MySQL has no transactional DDL — `migrator.ts` runs `migration.up()` bare and
 * writes the ledger row after it — so two runners can both enter the same
 * migration, and a crash between the last statement and the ledger insert
 * leaves a migration applied-but-unrecorded that the next boot re-applies.
 * One lock, held for the whole pass, is what closes that.
 *
 * WHY THE CONNECTION IS PINNED. All three mechanisms are SESSION-scoped, not
 * statement-scoped: `pg_advisory_lock`, `GET_LOCK` and SQLite's RESERVED lock
 * belong to the connection that took them. On a pooled Kysely the acquire and
 * the release can land on different pooled connections, which unlocks nothing
 * and protects nothing — the classic `GET_LOCK` footgun. So every branch here
 * runs inside `db.connection()`, which binds one connection for the whole
 * callback, and hands that same pinned handle to the caller's work.
 *
 * SELF-HEALING. A process that dies mid-migration does not wedge the next boot:
 * PostgreSQL releases session advisory locks when the backend goes away, MySQL
 * releases `GET_LOCK` when the connection drops, and SQLite's file lock dies
 * with the process. There is no stale-lock table to clean up by hand.
 *
 * NOT RE-ENTRANT. Taking the lock twice on one handle is not supported and not
 * needed — the only holder is the migration pass. `applyMigrations` therefore
 * passes `lock: false` to the inner pass it wraps rather than nesting.
 */

import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import { sql, type Kysely } from 'kysely';

import type { MetaDialect } from './columns.js';
import type { MetaDB } from './schema/tables.js';

/**
 * Fixed 64-bit PostgreSQL advisory-lock key: the first 8 bytes of
 * sha256('adminium:migrations') read as a big-endian signed int64
 * (0xf15280bf1fc422eb). Advisory locks live in a per-database namespace shared
 * by every session, which is exactly the scope we want — two Adminium
 * deployments in two databases of one cluster do not block each other.
 *
 * The value is hardcoded rather than derived at runtime because it is a wire
 * constant: it must be byte-identical across versions, and greppable when an
 * operator is staring at `pg_locks`.
 */
export const PG_MIGRATION_LOCK_KEY = -1057641404118588693n;

/**
 * MySQL `GET_LOCK` names are SERVER-wide, not schema-scoped, so a fixed name
 * would make two Adminium schemas on one MySQL server serialize against each
 * other. The current schema is folded into the name instead. Names are capped
 * at 64 characters since MySQL 5.7, hence the digest rather than the raw
 * schema name.
 */
export const MYSQL_MIGRATION_LOCK_PREFIX = 'adminium_migrate_';

/**
 * How long a boot waits for another process's migration pass before giving up.
 * Bounded on purpose: a container that hangs forever on a lock is worse than
 * one that exits with a message a restart can retry. Two minutes covers an
 * honest pass on a large meta store; operators of very large ones raise it.
 */
export const DEFAULT_MIGRATION_LOCK_TIMEOUT_MS = 120_000;

/** Gap between acquisition attempts while waiting. */
const LOCK_POLL_INTERVAL_MS = 250;

/** SQLite's busy signals, as better-sqlite3 surfaces them. */
const SQLITE_BUSY = /SQLITE_BUSY|database is locked|database table is locked/i;

export class MigrationLockTimeoutError extends Error {
  override name = 'MigrationLockTimeoutError';
  constructor(
    readonly dialect: MetaDialect,
    readonly timeoutMs: number,
  ) {
    super(
      `Timed out after ${timeoutMs}ms waiting for the ${dialect} migration lock. ` +
        'Another Adminium process is applying migrations to this meta store — let it finish and retry, ' +
        'or raise the lock timeout if this store legitimately takes longer to migrate.',
    );
  }
}

/** Emitted once per pass, the first time the lock is not immediately free. */
export interface MigrationLockWait {
  dialect: MetaDialect;
  timeoutMs: number;
}

export interface MigrationLockOptions {
  dialect: MetaDialect;
  /** Wait bound; defaults to {@link DEFAULT_MIGRATION_LOCK_TIMEOUT_MS}. */
  timeoutMs?: number;
  /**
   * Called once when the lock is contended, so an operator watching
   * `docker compose logs` knows why the boot is slow. Defaults to a
   * `console.warn` — this package has no logger to inject.
   */
  onWait?: (wait: MigrationLockWait) => void;
}

export interface MigrationLockContext {
  /**
   * True when the lock itself opened a transaction on the pinned connection
   * (SQLite only). The work inside must not open another — SQLite has no
   * nested `BEGIN`.
   */
  inTransaction: boolean;
}

function warnOnWait(wait: MigrationLockWait): void {
  console.warn(
    `[adminium/meta] waiting for the ${wait.dialect} migration lock — another Adminium process is ` +
      `migrating this meta store (giving up after ${Math.round(wait.timeoutMs / 1000)}s)`,
  );
}

/**
 * Poll `attempt` until it reports success or the deadline passes. Polling
 * rather than a blocking `pg_advisory_lock` / `GET_LOCK(name, timeout)` keeps
 * all three dialects on one code path and one bound, and gives us a place to
 * emit the "still waiting" line.
 */
async function acquire(
  attempt: () => Promise<boolean>,
  dialect: MetaDialect,
  timeoutMs: number,
  onWait: (wait: MigrationLockWait) => void,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let warned = false;
  for (;;) {
    if (await attempt()) return;
    if (!warned) {
      warned = true;
      onWait({ dialect, timeoutMs });
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new MigrationLockTimeoutError(dialect, timeoutMs);
    await sleep(Math.min(LOCK_POLL_INTERVAL_MS, remaining));
  }
}

const NOT_IN_TRANSACTION: MigrationLockContext = { inTransaction: false };

async function withPostgresLock<T>(
  db: Kysely<MetaDB>,
  timeoutMs: number,
  onWait: (wait: MigrationLockWait) => void,
  run: (db: Kysely<MetaDB>, ctx: MigrationLockContext) => Promise<T>,
): Promise<T> {
  await acquire(
    async () => {
      const { rows } = await sql<{
        ok: boolean;
      }>`select pg_try_advisory_lock(${sql.lit(PG_MIGRATION_LOCK_KEY)}) as ok`.execute(db);
      return rows[0]?.ok === true;
    },
    'postgres',
    timeoutMs,
    onWait,
  );
  try {
    return await run(db, NOT_IN_TRANSACTION);
  } finally {
    // A failing unlock means the session is already broken, and a dead session
    // releases its advisory locks anyway — never mask the real error with it.
    await sql`select pg_advisory_unlock(${sql.lit(PG_MIGRATION_LOCK_KEY)})`
      .execute(db)
      .catch(() => undefined);
  }
}

async function mysqlLockName(db: Kysely<MetaDB>): Promise<string> {
  const { rows } = await sql<{ dbname: string | null }>`select database() as dbname`.execute(db);
  // A pool opened on a bare DSN has no schema selected; the migration pass
  // would fail on its first statement anyway, so any stable name will do.
  const schema = rows[0]?.dbname ?? '';
  return MYSQL_MIGRATION_LOCK_PREFIX + createHash('sha256').update(schema).digest('hex').slice(0, 16);
}

async function withMysqlLock<T>(
  db: Kysely<MetaDB>,
  timeoutMs: number,
  onWait: (wait: MigrationLockWait) => void,
  run: (db: Kysely<MetaDB>, ctx: MigrationLockContext) => Promise<T>,
): Promise<T> {
  const name = await mysqlLockName(db);
  await acquire(
    async () => {
      // GET_LOCK returns 1 acquired, 0 timed out, NULL on error.
      const { rows } = await sql<{ ok: number | null }>`select get_lock(${name}, 0) as ok`.execute(db);
      return Number(rows[0]?.ok ?? 0) === 1;
    },
    'mysql',
    timeoutMs,
    onWait,
  );
  try {
    return await run(db, NOT_IN_TRANSACTION);
  } finally {
    await sql`select release_lock(${name})`.execute(db).catch(() => undefined);
  }
}

async function withSqliteLock<T>(
  db: Kysely<MetaDB>,
  timeoutMs: number,
  onWait: (wait: MigrationLockWait) => void,
  run: (db: Kysely<MetaDB>, ctx: MigrationLockContext) => Promise<T>,
): Promise<T> {
  // `PRAGMA foreign_keys` is a no-op inside a transaction, so the pragma the
  // runner relies on (enableSqliteForeignKeys) has to land BEFORE the BEGIN —
  // otherwise the whole pass, and the rest of the process's life on this
  // connection, would run with foreign keys off.
  await sql`PRAGMA foreign_keys = ON`.execute(db);

  await acquire(
    async () => {
      try {
        // RESERVED immediately, rather than deferred BEGIN's "upgrade on first
        // write" — this is SQLite's advisory lock.
        await sql`BEGIN IMMEDIATE`.execute(db);
        return true;
      } catch (error) {
        if (error instanceof Error && SQLITE_BUSY.test(error.message)) return false;
        throw error;
      }
    },
    'sqlite',
    timeoutMs,
    onWait,
  );

  try {
    const result = await run(db, { inTransaction: true });
    await sql`COMMIT`.execute(db);
    return result;
  } catch (error) {
    await sql`ROLLBACK`.execute(db).catch(() => undefined);
    throw error;
  }
}

/**
 * Run `run` while holding the meta store's migration lock, on a connection
 * pinned for the lock's whole lifetime. The lock is always released — on
 * success, on failure, and by the database itself if the process dies.
 *
 * `run` receives the PINNED handle and must use it for every statement:
 * work sent to the original pooled handle is not covered by the lock (and, on
 * SQLite, not part of the lock's transaction).
 */
export async function withMigrationLock<T>(
  db: Kysely<MetaDB>,
  options: MigrationLockOptions,
  run: (db: Kysely<MetaDB>, ctx: MigrationLockContext) => Promise<T>,
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_MIGRATION_LOCK_TIMEOUT_MS;
  const onWait = options.onWait ?? warnOnWait;
  return db.connection().execute(async (pinned) => {
    switch (options.dialect) {
      case 'postgres':
        return withPostgresLock(pinned, timeoutMs, onWait, run);
      case 'mysql':
        return withMysqlLock(pinned, timeoutMs, onWait, run);
      case 'sqlite':
        return withSqliteLock(pinned, timeoutMs, onWait, run);
    }
  });
}
