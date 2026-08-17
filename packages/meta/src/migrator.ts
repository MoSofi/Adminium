// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Adminium-owned migration runner (07-meta-store.md §4).
 *
 * - Up-only, append-only, sequential migrations (src/migrations/).
 * - `adminium_migrations` ledger (name PK, checksum, applied_at, duration_ms,
 *   adminium_version) — created with CREATE TABLE IF NOT EXISTS, the only DDL
 *   outside migration files.
 * - Checksum drift detection: an applied migration whose contents changed
 *   aborts with the migration name and remedy.
 * - Unknown ledger rows (database migrated by a newer Adminium) abort with an
 *   upgrade message.
 * - Transactional per migration on PostgreSQL/SQLite (transactional DDL); on
 *   MySQL the ledger row is written immediately after the last statement and
 *   every DDL statement is individually re-runnable (ifNotExists guards).
 * - Serialized across processes by a per-dialect advisory lock (migrate-lock.ts)
 *   so two replicas booting together cannot both enter the pending set.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { sql, type Kysely } from 'kysely';

import { columnHelpers, type MetaDialect } from './columns.js';
import { withMigrationLock, type MigrationLockOptions } from './migrate-lock.js';
import { ALL_MIGRATIONS, type MetaMigration } from './migrations/index.js';
import type { MetaDB } from './schema/tables.js';

/**
 * Package version recorded in the ledger, read from package.json at module
 * load — the same trick `apps/server/src/version.ts` uses, and for the same
 * reason: the relative hop works from both `src/` (vitest/tsx) and `dist/`
 * (compiled) because both sit one level below the package root.
 *
 * It was a hardcoded `'0.0.0'`, which meant `adminium_migrations.adminium_version`
 * — the column whose whole job is telling support which build touched a meta
 * store — recorded a version that never shipped. Neither production caller
 * passes `version`, so the literal was what every row got.
 */
export const META_PACKAGE_VERSION: string = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

const LEDGER = 'adminium_migrations';

export class MigrationChecksumDriftError extends Error {
  override name = 'MigrationChecksumDriftError';
  constructor(readonly migrationName: string) {
    super(
      `Migration "${migrationName}" was modified after it was applied to this database. ` +
        'Restore the original migration file or ship a new compensating migration — applied migrations are never edited.',
    );
  }
}

export class UnknownMigrationError extends Error {
  override name = 'UnknownMigrationError';
  constructor(readonly migrationName: string) {
    super(
      `The migration ledger contains "${migrationName}", which this Adminium version does not know. ` +
        'This database was migrated by a newer Adminium — upgrade the app.',
    );
  }
}

export class MigrationOrderError extends Error {
  override name = 'MigrationOrderError';
}

/**
 * SHA-256 over the migration name + its compiled `up` body. Editing an applied
 * migration changes the digest, tripping drift detection on the next boot.
 */
export function migrationChecksum(migration: MetaMigration): string {
  return createHash('sha256').update(`${migration.name}\n${migration.up.toString()}`).digest('hex');
}

export interface MigratorOptions {
  dialect: MetaDialect;
  /** Override the built-in list — tests only. */
  migrations?: readonly MetaMigration[];
  /** Version stamped into the ledger; defaults to {@link META_PACKAGE_VERSION}. */
  version?: string;
  /** Clock override — tests only. */
  now?: () => number;
  /**
   * Advisory-lock settings for the pass, or `false` to run unlocked — for a
   * caller that already holds the lock, or a test that wants the raw runner.
   */
  lock?: Omit<MigrationLockOptions, 'dialect'> | false;
  /**
   * Set when `db` is already inside a transaction the caller opened (the
   * SQLite lock is). Suppresses the per-migration transaction: SQLite has no
   * nested `BEGIN`, and the pass is already atomic as a whole.
   */
  inTransaction?: boolean;
}

export interface ApplyResult {
  /** Names applied by this call, in order (empty ⇒ already up to date). */
  applied: string[];
}

export interface MigrationStatusEntry {
  name: string;
  applied: boolean;
  appliedAt: number | null;
  /** True when the ledger checksum no longer matches the file. */
  drift: boolean;
  /** False for ledger rows this Adminium version does not know. */
  known: boolean;
}

function orderedMigrations(migrations: readonly MetaMigration[]): readonly MetaMigration[] {
  const names = new Set<string>();
  let prev = '';
  for (const m of migrations) {
    if (names.has(m.name)) throw new MigrationOrderError(`duplicate migration name: ${m.name}`);
    if (m.name <= prev) {
      throw new MigrationOrderError(`migrations out of order: "${m.name}" after "${prev}"`);
    }
    names.add(m.name);
    prev = m.name;
  }
  return migrations;
}

async function ensureLedger(db: Kysely<MetaDB>, dialect: MetaDialect): Promise<void> {
  const c = columnHelpers(dialect);
  await db.schema
    .createTable(LEDGER)
    .ifNotExists()
    .addColumn('name', c.str(120), (col) => col.primaryKey())
    .addColumn('checksum', c.str(64), (col) => col.notNull())
    .addColumn('applied_at', c.ts, (col) => col.notNull())
    .addColumn('duration_ms', c.int, (col) => col.notNull())
    .addColumn('adminium_version', c.str(20), (col) => col.notNull())
    .execute();
}

/** SQLite enforces FKs per connection; must run before any FK-dependent work (§2.2). */
export async function enableSqliteForeignKeys(db: Kysely<MetaDB>): Promise<void> {
  await sql`PRAGMA foreign_keys = ON`.execute(db);
}

interface LedgerValidation {
  appliedNames: Set<string>;
}

async function readAndValidateLedger(
  db: Kysely<MetaDB>,
  migrations: readonly MetaMigration[],
): Promise<LedgerValidation> {
  const rows = await db.selectFrom(LEDGER).selectAll().execute();
  const byName = new Map(migrations.map((m) => [m.name, m] as const));
  for (const row of rows) {
    const migration = byName.get(row.name);
    if (!migration) throw new UnknownMigrationError(row.name);
    if (migrationChecksum(migration) !== row.checksum) {
      throw new MigrationChecksumDriftError(row.name);
    }
  }
  return { appliedNames: new Set(rows.map((r) => r.name)) };
}

/**
 * Apply all pending migrations, in order. Idempotent: already-applied
 * migrations are skipped via the ledger.
 *
 * Concurrent runners are serialized by the advisory lock (migrate-lock.ts),
 * held on one pinned connection for the whole pass — the ledger PK alone only
 * defends PostgreSQL/SQLite, where it shares a transaction with the DDL, and
 * MySQL is exactly the dialect where it does not. Pass `lock: false` to opt
 * out; a lock wait is bounded and fails with {@link MigrationLockTimeoutError}
 * rather than hanging a container boot.
 */
export async function applyMigrations(db: Kysely<MetaDB>, options: MigratorOptions): Promise<ApplyResult> {
  // `db.connection()` cannot pin anything on a handle that is already a
  // transaction, and an outer transaction is itself a serialization point.
  if (options.lock === false || options.inTransaction === true || db.isTransaction) {
    return applyMigrationsUnlocked(db, options);
  }
  return withMigrationLock(db, { dialect: options.dialect, ...options.lock }, (locked, ctx) =>
    applyMigrationsUnlocked(locked, { ...options, lock: false, inTransaction: ctx.inTransaction }),
  );
}

async function applyMigrationsUnlocked(
  db: Kysely<MetaDB>,
  options: MigratorOptions,
): Promise<ApplyResult> {
  const migrations = orderedMigrations(options.migrations ?? ALL_MIGRATIONS);
  const now = options.now ?? Date.now;
  const version = options.version ?? META_PACKAGE_VERSION;
  const dialect = options.dialect;

  // Kept for unlocked callers: inside the SQLite lock's transaction the pragma
  // is a no-op, which is why the lock runs it before its BEGIN (migrate-lock.ts).
  if (dialect === 'sqlite') await enableSqliteForeignKeys(db);
  await ensureLedger(db, dialect);
  const { appliedNames } = await readAndValidateLedger(db, migrations);

  const c = columnHelpers(dialect);
  const applied: string[] = [];

  for (const migration of migrations) {
    if (appliedNames.has(migration.name)) continue;
    const startedAt = now();
    const ledgerRow = () => ({
      name: migration.name,
      checksum: migrationChecksum(migration),
      appliedAt: now(),
      durationMs: Math.max(0, now() - startedAt),
      adminiumVersion: version,
    });

    if (dialect === 'mysql' || options.inTransaction === true) {
      // MySQL: no transactional DDL, so statements are individually re-runnable
      // (ifNotExists) and the ledger row lands right after the last one.
      // `inTransaction`: the caller already opened one (the SQLite lock does),
      // and SQLite has no nested BEGIN.
      await migration.up(db as unknown as Kysely<unknown>, c);
      await db.insertInto(LEDGER).values(ledgerRow()).execute();
    } else {
      await db.transaction().execute(async (trx) => {
        await migration.up(trx as unknown as Kysely<unknown>, c);
        await trx.insertInto(LEDGER).values(ledgerRow()).execute();
      });
    }
    applied.push(migration.name);
  }

  return { applied };
}

/** Ledger vs file status for `adminium migrate --status`. */
export async function migrationStatus(
  db: Kysely<MetaDB>,
  options: MigratorOptions,
): Promise<MigrationStatusEntry[]> {
  const migrations = orderedMigrations(options.migrations ?? ALL_MIGRATIONS);
  await ensureLedger(db, options.dialect);
  const rows = await db.selectFrom(LEDGER).selectAll().execute();
  const ledger = new Map(rows.map((r) => [r.name, r] as const));
  const known = new Set(migrations.map((m) => m.name));

  const entries: MigrationStatusEntry[] = migrations.map((m) => {
    const row = ledger.get(m.name);
    return {
      name: m.name,
      applied: row !== undefined,
      appliedAt: row?.appliedAt ?? null,
      drift: row !== undefined && migrationChecksum(m) !== row.checksum,
      known: true,
    };
  });
  for (const row of rows) {
    if (!known.has(row.name)) {
      entries.push({ name: row.name, applied: true, appliedAt: row.appliedAt, drift: false, known: false });
    }
  }
  return entries;
}
