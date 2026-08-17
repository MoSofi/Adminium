/**
 * The two guards that belong between `docker compose pull && up -d` and the
 * first migration statement: take a snapshot, and refuse to run against a store
 * that is NEWER than this build.
 *
 * ─── 1. Snapshot, but only when there is something to snapshot ───────────────
 *
 * `firstRun` is documented "safe to run at every boot" and is in fact run at
 * every boot, so a snapshot hooked to it unconditionally writes an archive every
 * time the container restarts — and a container that restarts hourly fills its
 * volume with copies of a database nothing changed. That is the same failure
 * this guard exists to prevent, arriving from the other direction. The trigger
 * is therefore PENDING WORK, read from the ledger before anything is applied: no
 * pending migrations, no snapshot. A store whose ledger is EMPTY is skipped for
 * the opposite reason — a fresh install has nothing to lose, and `createBackup`
 * refuses an unmigrated store anyway ("there is nothing here to restore").
 *
 * What lands is a real §9 archive (`backup-service.ts`), rotated to
 * {@link DEFAULT_AUTO_BACKUP_KEEP} so upgrade #100 does not keep upgrade #1's
 * copy. It carries the whole meta store plus every LOCAL SQLite source database,
 * which is why an upgrade boot can pause: that is a copy of real data, and the
 * alternative is an archive that omits it.
 *
 * ─── 2. Why the Postgres/MySQL path is a refusal, not a fallback ─────────────
 *
 * `createBackup` is a SQLite writer. `snapshotSqliteFile` opens better-sqlite3
 * on the meta file directly and `discoverSources` only dumps `engine ===
 * 'sqlite'`, so against a Postgres or MySQL meta store there is no file to copy
 * and nothing it produces would be a backup of the store being migrated.
 *
 * The obvious substitute is `exportZip`, and it is the wrong one — dangerous in
 * the specific way `backup/snapshot.ts` names as the worst a backup can have,
 * invisible until the restore. Its own header lists what it carries (settings,
 * roles, connections, pages, views, snapshots, overrides) and what it does not:
 * users, sessions, API keys, webhooks. Restore that bundle and you get an
 * instance with every page intact, the `system.superAdminCreatedAt` claim row
 * present — settings travel — and NO USERS: the first-run wizard is already
 * claimed, so nobody can log in and nobody can be created. It would be named
 * "backup", it would sit in `backups/`, and it would be unrecoverable. Adminium
 * does not write it. It says, loudly, that it is not taking a snapshot, and
 * prints the `pg_dump`/`mysqldump` line that takes one.
 *
 * The refusal does NOT stop the boot: an unattended `up -d` would trade a data
 * risk for a certain outage, and nothing inside the container can clear the
 * refusal anyway. A snapshot FAILURE is the opposite case — there the protection
 * was promised and could not be delivered — so that one stops the migration and
 * exits {@link EXIT_CONFIG} (see the CLI commands).
 *
 * ─── 3. The downgrade guard ──────────────────────────────────────────────────
 *
 * A ledger row this build does not know means the database was migrated by a
 * NEWER Adminium — someone rolled the image back. The migrator already refuses
 * (`UnknownMigrationError`), but only once `applyMigrations` reaches it, and the
 * CLI flattened that into a generic exit 1. Detecting it HERE, from the status
 * read the snapshot decision needs anyway, costs nothing and lets both front
 * doors die with the same named message and the same actionable exit code.
 */

import { join, resolve } from 'node:path';

import { migrationStatus, type MetaDb } from '@adminium/meta';

import { dsnCryptoFromSecret } from '../connections/crypto.js';
import { sqlitePathFromUrl, type MetaEngine, type MetaUrlSource } from '../meta/store.js';
import {
  BACKUPS_DIR,
  DEFAULT_AUTO_BACKUP_KEEP,
  createBackup,
  rotateBackupsOnDisk,
} from './backup-service.js';

export interface PreMigrationOptions {
  meta: MetaDb;
  /** Decides whether a snapshot is possible at all — see the header. */
  engine: MetaEngine;
  /** The DSN the store was opened with; the SQLite file path comes out of it. */
  metaUrl: string;
  /** Which layer supplied that DSN — only used to word the manual dump command. */
  source: MetaUrlSource;
  /** `ADMINIUM_DATA_DIR` — `backups/`'s parent. */
  dataDir: string;
  /** `ADMINIUM_SECRET` — decrypts source DSNs so local SQLite files are found. */
  secret: string;
  /** Rotation depth; defaults to {@link DEFAULT_AUTO_BACKUP_KEEP}. */
  keep?: number | undefined;
  now?: (() => number) | undefined;
}

/** A ledger row this build does not have, and the build that wrote it. */
export interface NewerMigration {
  name: string;
  /** `adminium_migrations.adminiumVersion`, i.e. which build applied it. */
  appliedBy: string | null;
}

/**
 * What the guard did. Every branch is a value rather than a thrown error: the
 * two that end a boot do so with a CLI exit code, which is the caller's
 * vocabulary, not this module's.
 */
export type PreMigrationOutcome =
  /** The store is ahead of this build. Nothing was read further, nothing ran. */
  | { kind: 'downgrade'; newer: NewerMigration[] }
  /** Ledger empty — a fresh install, with nothing to lose. */
  | { kind: 'fresh'; pending: string[] }
  /** Every known migration already applied; this is an ordinary restart. */
  | { kind: 'up-to-date' }
  /** `sqlite::memory:` — a store that dies with the process cannot be restored. */
  | { kind: 'ephemeral'; pending: string[] }
  | { kind: 'snapshot'; pending: string[]; path: string; bytes: number; removed: string[] }
  /** Postgres/MySQL: no snapshot taken, and said so. See the header. */
  | { kind: 'no-snapshot'; pending: string[]; engine: 'postgres' | 'mysql'; command: string }
  /** The snapshot was possible, was attempted, and failed. Migrations must not run. */
  | { kind: 'failed'; pending: string[]; dir: string; error: Error };

/**
 * Read the ledger and, when an upgrade is actually about to happen, snapshot the
 * meta store. Applies nothing itself — the caller runs `firstRun`/`applyMigrations`
 * after acting on the outcome.
 */
export async function guardPreMigration(opts: PreMigrationOptions): Promise<PreMigrationOutcome> {
  const entries = await migrationStatus(opts.meta.db, { dialect: opts.meta.dialect });

  // Ahead of this build ⇒ stop before anything else, including the snapshot: a
  // backup written by a binary that cannot read the schema is not a rescue.
  const unknownNames = entries.filter((entry) => !entry.known).map((entry) => entry.name);
  if (unknownNames.length > 0) {
    return { kind: 'downgrade', newer: await readAppliedBy(opts.meta, unknownNames) };
  }

  const pending = entries.filter((entry) => !entry.applied).map((entry) => entry.name);
  if (pending.length === 0) return { kind: 'up-to-date' };
  if (!entries.some((entry) => entry.applied)) return { kind: 'fresh', pending };

  if (opts.engine !== 'sqlite') {
    return {
      kind: 'no-snapshot',
      pending,
      engine: opts.engine,
      command: manualDumpCommand(opts.engine, opts.metaUrl, opts.source),
    };
  }

  const metaPath = sqlitePathFromUrl(opts.metaUrl);
  if (metaPath === ':memory:') return { kind: 'ephemeral', pending };

  const dataDir = resolve(opts.dataDir);
  try {
    const result = await createBackup({
      meta: opts.meta,
      crypto: dsnCryptoFromSecret(opts.secret),
      dataDir,
      metaPath: resolve(metaPath),
      // No Electron shell here: there is no `config.json` to describe, and §9
      // says a missing member is honest where an invented one is not.
      redactedConfig: null,
      destination: 'auto',
      ...(opts.now === undefined ? {} : { now: opts.now }),
    });
    // Rotate AFTER the write, never before: a sweep that ran first would delete
    // the oldest archive to make room for one that then failed to appear.
    const rotated = await rotateBackupsOnDisk(dataDir, opts.keep ?? DEFAULT_AUTO_BACKUP_KEEP);
    return {
      kind: 'snapshot',
      pending,
      path: result.path,
      bytes: result.bytes,
      removed: rotated.removed,
    };
  } catch (error) {
    return {
      kind: 'failed',
      pending,
      dir: join(dataDir, BACKUPS_DIR),
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/** The version stamp of each unknown ledger row — "applied by 0.4.0" is the fix. */
async function readAppliedBy(meta: MetaDb, names: string[]): Promise<NewerMigration[]> {
  try {
    const rows = await meta.db
      .selectFrom('adminium_migrations')
      .select(['name', 'adminiumVersion'])
      .where('name', 'in', names)
      .execute();
    const byName = new Map(rows.map((row) => [row.name, row.adminiumVersion] as const));
    return names.map((name) => ({ name, appliedBy: byName.get(name) ?? null }));
  } catch {
    // The refusal must not depend on one more query succeeding — the names
    // alone are already enough to act on.
    return names.map((name) => ({ name, appliedBy: null }));
  }
}

/**
 * The dump command to print. It never contains a password: with the DSN in the
 * environment the shell expands the variable, and when it came from the
 * bootstrap file (or a `--meta-url` flag) there is no variable to name, so the
 * placeholder says so rather than echoing credentials into a log.
 */
export function manualDumpCommand(
  engine: 'postgres' | 'mysql',
  metaUrl: string,
  source: MetaUrlSource,
): string {
  const dsn = source === 'env' ? '"$ADMINIUM_META_URL"' : '"<your meta DSN>"';
  if (engine === 'postgres') {
    return `pg_dump ${dsn} > adminium-pre-upgrade.sql`;
  }
  return `mysqldump --single-transaction ${mysqlDatabaseName(metaUrl)} > adminium-pre-upgrade.sql`;
}

/** `mysqldump` takes a database name, not a URL — dig it out, credentials-free. */
function mysqlDatabaseName(metaUrl: string): string {
  try {
    const path = new URL(metaUrl).pathname.replace(/^\//, '');
    return path === '' ? '<database>' : path;
  } catch {
    return '<database>';
  }
}

/** Lines to print, and whether they are a warning rather than progress. */
export interface PreMigrationReport {
  lines: string[];
  warn: boolean;
}

/** What the operator is told. Silent for the three "nothing to protect" cases. */
export function describePreMigration(outcome: PreMigrationOutcome): PreMigrationReport {
  if (outcome.kind === 'snapshot') {
    const lines = [
      `Snapshotted the meta store to ${outcome.path} before applying ` +
        `${String(outcome.pending.length)} pending migration(s).`,
    ];
    if (outcome.removed.length > 0) {
      lines.push(`Rotated out ${String(outcome.removed.length)} older snapshot(s).`);
    }
    return { lines, warn: false };
  }

  if (outcome.kind === 'no-snapshot') {
    return {
      warn: true,
      lines: [
        `${String(outcome.pending.length)} pending meta migration(s), and Adminium cannot ` +
          `snapshot a ${outcome.engine} meta store itself.`,
        'It will not write a config export in place of one: that bundle carries settings,',
        'roles, connections and pages, but NOT users, sessions, API keys or webhooks —',
        'restoring it would leave an install nobody can log in to.',
        '',
        'Take a real backup first:',
        `  ${outcome.command}`,
        '',
        'Migrations are being applied now. Stop the container and restore that dump if this',
        'upgrade goes wrong.',
      ],
    };
  }

  return { lines: [], warn: false };
}

/** A refusal the CLI turns into a `CliError` — message plus its `hint` block. */
export interface PreMigrationRefusal {
  message: string;
  hint: string;
}

/**
 * The downgrade message. Named and specific because the generic version of this
 * ("migration ledger contains X") reads like corruption, when the actual event
 * is an image rollback and the actual remedy is picking a version.
 */
export function downgradeRefusal(newer: NewerMigration[], dataDir: string): PreMigrationRefusal {
  const rows = newer.map((entry) =>
    entry.appliedBy === null
      ? `  ${entry.name}`
      : `  ${entry.name} (applied by Adminium ${entry.appliedBy})`,
  );
  const wroteIt = newer.find((entry) => entry.appliedBy !== null)?.appliedBy ?? null;
  return {
    message:
      'This database was migrated by a NEWER Adminium than the one running — refusing to touch it.',
    hint:
      'Its migration ledger contains entries this build does not have:\n' +
      `${rows.join('\n')}\n` +
      '\n' +
      'Migrations are up-only: an older build cannot un-apply them, and running against a\n' +
      'schema from the future corrupts rows it cannot read. Either:\n' +
      `  • run the newer build again${wroteIt === null ? '' : ` (Adminium ${wroteIt})`} — it is the one this store matches, or\n` +
      `  • restore the snapshot taken before that upgrade, from ${join(resolve(dataDir), BACKUPS_DIR)}.`,
  };
}

/**
 * The snapshot was possible and did not happen, so the migration does not
 * happen either. Both ways out are named: fix the volume, or take the risk
 * deliberately with `--skip-migrate` after backing up by hand.
 */
export function snapshotFailureRefusal(
  outcome: Extract<PreMigrationOutcome, { kind: 'failed' }>,
): PreMigrationRefusal {
  return {
    message: `Could not write the pre-migration snapshot to ${outcome.dir} — not applying migrations.`,
    hint:
      `${outcome.error.message}\n` +
      '\n' +
      `${String(outcome.pending.length)} migration(s) are pending, and an upgrade that cannot be\n` +
      'undone is not one to run blind. Either:\n' +
      `  • make ${outcome.dir} a writable directory — a full or read-only volume is the\n` +
      '    usual cause, and so is a file sitting where the folder should be, or\n' +
      '  • take a backup yourself, boot with `adminium start --skip-migrate`, and run\n' +
      '    `adminium migrate` once the volume is fixed.',
  };
}
