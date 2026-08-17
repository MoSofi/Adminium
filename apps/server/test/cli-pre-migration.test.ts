// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The pre-migration guards (`src/backup/pre-migration.ts`) through both front
 * doors — the operation this covers is `docker compose pull && up -d`, where
 * nobody is watching and the failures are unrecoverable rather than annoying.
 *
 * The suite is built around the four claims the module makes:
 *   1. a snapshot is written when — and ONLY when — migrations are pending, so
 *      an hourly-restarting container does not fill its volume with copies of a
 *      database nothing changed;
 *   2. on Postgres/MySQL it refuses honestly instead of writing a config export
 *      that omits every user account;
 *   3. a store migrated by a NEWER Adminium stops the boot with exit 78, not a
 *      generic exit 1 that looks like every other crash;
 *   4. a snapshot that could not be written stops the migration too — the whole
 *      point was not to apply it unprotected.
 *
 * Claim 1's negative half is the one worth the setup cost: a snapshot hooked to
 * `firstRun` (which is documented "safe to run at every boot", and is run at
 * every boot) passes every positive assertion here and is itself the bug.
 */

import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ALL_MIGRATIONS,
  applyMigrations,
  createSqliteMetaDb,
  destroyMetaDb,
  initMetaDb,
  type MetaDb,
} from '@adminium/meta';

import { BACKUP_FILE_PATTERN } from '../src/backup/format.js';
import {
  describePreMigration,
  downgradeRefusal,
  guardPreMigration,
  manualDumpCommand,
} from '../src/backup/pre-migration.js';
import { runCli } from '../src/cli/run.js';
import {
  EXIT_CONFIG,
  EXIT_ERROR,
  EXIT_NOTHING_ACCEPTED,
  EXIT_OK,
  EXIT_VALIDATION_FAILED,
} from '../src/cli/exit.js';
import { defaultCliDeps } from '../src/cli/runtime.js';
import { openMetaStore, type MetaStoreHandle } from '../src/meta/store.js';
import { fakeDeps, fakeIo, fakeRuntime, TEST_SECRET } from './cli-helpers.js';

let dir: string;
let metaPath: string;
let metaUrl: string;
/** Stores opened by a test, closed for it — a leaked handle wedges the suite. */
const open: MetaStoreHandle[] = [];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'adminium-premigrate-'));
  metaPath = join(dir, 'meta.db');
  metaUrl = `sqlite:${metaPath}`;
});

afterEach(async () => {
  while (open.length > 0) await open.pop()?.close();
  await rm(dir, { recursive: true, force: true });
});

function realDeps(overrides: Record<string, string | undefined> = {}) {
  return {
    ...defaultCliDeps(),
    env: {
      ADMINIUM_SECRET: TEST_SECRET,
      ADMINIUM_META_URL: metaUrl,
      ADMINIUM_DATA_DIR: dir,
      ...overrides,
    },
    cwd: dir,
  };
}

/**
 * A store as an EXISTING install has it: every migration this build ships
 * except the last, i.e. exactly the shape `docker compose pull` produces when
 * the new image brought one along. Built with the migrator itself rather than
 * hand-written DDL, so it cannot drift from what a real upgrade sees.
 */
async function installedAtPreviousVersion(): Promise<void> {
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(metaPath) });
  await initMetaDb(meta);
  await applyMigrations(meta.db, {
    dialect: 'sqlite',
    migrations: ALL_MIGRATIONS.slice(0, -1),
  });
  await destroyMetaDb(meta);
}

/** Open the temp store the way both CLI front doors do. */
async function store(): Promise<MetaStoreHandle> {
  const handle = await openMetaStore({ metaUrl, dataDir: dir, secret: TEST_SECRET });
  open.push(handle);
  return handle;
}

/** Stamp a ledger row this build does not know — an image rolled BACK. */
async function writeFutureLedgerRow(meta: MetaDb, name: string, version: string): Promise<void> {
  await meta.db
    .insertInto('adminium_migrations')
    .values({
      name,
      checksum: 'f'.repeat(64),
      appliedAt: Date.now(),
      durationMs: 1,
      adminiumVersion: version,
    })
    .execute();
}

async function archives(): Promise<string[]> {
  const backups = join(dir, 'backups');
  if (!existsSync(backups)) return [];
  return (await readdir(backups)).filter((name) => BACKUP_FILE_PATTERN.test(name));
}

// ── 1. The snapshot, and when it must NOT happen ─────────────────────────────

describe('the pre-migration snapshot', () => {
  it('writes one before applying the migrations an upgrade brought', async () => {
    await installedAtPreviousVersion();

    const io = fakeIo();
    await expect(runCli(['migrate'], { io, deps: realDeps() })).resolves.toBe(EXIT_OK);

    expect(io.stdout()).toContain('Snapshotted the meta store to ');
    expect(await archives()).toHaveLength(1);
    // And it snapshotted BEFORE applying — the archive is worthless otherwise.
    expect(io.stdout().indexOf('Snapshotted')).toBeLessThan(io.stdout().indexOf('Applied'));
  });

  it('writes NOTHING on a fresh install — there is nothing yet to lose', async () => {
    const io = fakeIo();
    await expect(runCli(['migrate'], { io, deps: realDeps() })).resolves.toBe(EXIT_OK);

    expect(io.stdout()).toContain('Applied');
    expect(io.stdout()).not.toContain('Snapshotted');
    expect(await archives()).toHaveLength(0);
  });

  it('writes NOTHING on an ordinary restart — the volume-filling bug', async () => {
    // THE BUG THIS PINS. `firstRun` is documented "safe to run at every boot"
    // and IS run at every boot, so a snapshot hooked to it unconditionally
    // writes an archive every time the container restarts. A container that
    // restarts hourly then fills its volume with copies of a database nothing
    // changed — the same data-loss story from the other end.
    await runCli(['migrate'], { io: fakeIo(), deps: realDeps() });
    const afterFirst = await archives();

    for (let i = 0; i < 3; i += 1) {
      const io = fakeIo();
      await expect(runCli(['migrate'], { io, deps: realDeps() })).resolves.toBe(EXIT_OK);
      expect(io.stdout()).toContain('up to date');
      expect(io.stdout()).not.toContain('Snapshotted');
    }
    expect(await archives()).toEqual(afterFirst);
  });

  it('rotates, so upgrade #100 does not keep upgrade #1’s copy', async () => {
    await installedAtPreviousVersion();
    // Ten archives already there, named the way rotation orders them (by NAME).
    await mkdir(join(dir, 'backups'), { recursive: true });
    for (let i = 0; i < 10; i += 1) {
      const stamp = `2020010${String(i)}-00000${String(i)}`;
      await writeFile(join(dir, 'backups', `adminium-backup-${stamp}.zip`), 'x');
    }

    await expect(runCli(['migrate'], { io: fakeIo(), deps: realDeps() })).resolves.toBe(EXIT_OK);
    // DEFAULT_AUTO_BACKUP_KEEP is 7; the new snapshot is one of the survivors.
    expect((await archives()).length).toBeLessThanOrEqual(7);
  });

  it('the archive is a real meta snapshot, not a config bundle', async () => {
    await installedAtPreviousVersion();
    await runCli(['migrate'], { io: fakeIo(), deps: realDeps() });

    const [name] = await archives();
    const bytes = await readFile(join(dir, 'backups', name as string));
    // fflate's zip stores member paths verbatim; §9's layout is meta.db +
    // manifest.json, and neither exists in an `export-zip` bundle.
    const text = bytes.toString('latin1');
    expect(text).toContain('meta.db');
    expect(text).toContain('manifest.json');
  });

  it('an in-memory store is skipped — it cannot be restored into anyway', async () => {
    const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await initMetaDb(meta);
    await applyMigrations(meta.db, { dialect: 'sqlite', migrations: ALL_MIGRATIONS.slice(0, -1) });

    const outcome = await guardPreMigration({
      meta,
      engine: 'sqlite',
      metaUrl: 'sqlite::memory:',
      source: 'env',
      dataDir: dir,
      secret: TEST_SECRET,
    });
    await destroyMetaDb(meta);

    expect(outcome.kind).toBe('ephemeral');
    expect(await archives()).toHaveLength(0);
  });
});

// ── 2. The honest refusal on Postgres/MySQL ──────────────────────────────────

describe('a Postgres/MySQL meta store', () => {
  /**
   * The engine is a FIELD of the guard's input, so the branch is exercised by
   * passing it — no live Postgres needed to assert what Adminium refuses to do.
   * The store underneath is the real, pending-migrations one.
   */
  async function outcomeFor(engine: 'postgres' | 'mysql', url: string) {
    await installedAtPreviousVersion();
    const handle = await store();
    return guardPreMigration({
      meta: handle.meta,
      engine,
      metaUrl: url,
      source: 'env',
      dataDir: dir,
      secret: TEST_SECRET,
    });
  }

  it('is told plainly that no snapshot was taken, and how to take one', async () => {
    const outcome = await outcomeFor('postgres', 'postgres://u:p@db:5432/adminium_meta');
    expect(outcome.kind).toBe('no-snapshot');

    const report = describePreMigration(outcome);
    expect(report.warn).toBe(true);
    const text = report.lines.join('\n');
    expect(text).toContain('cannot snapshot a postgres meta store');
    expect(text).toContain('pg_dump "$ADMINIUM_META_URL"');
    // No archive appears in backups/ pretending otherwise.
    expect(await archives()).toHaveLength(0);
  });

  it('says WHICH data a config export would silently omit', async () => {
    // THE TRAP THIS PINS. `exportZip` is dialect-agnostic and looks like the
    // obvious fallback, but it carries no users, sessions, API keys or
    // webhooks — and it does carry `system.superAdminCreatedAt`, so restoring
    // one leaves an install whose first-run wizard is claimed and whose only
    // account does not exist. A backup that omits user accounts is the
    // invisible-until-restore failure `backup/snapshot.ts` calls the worst kind.
    const outcome = await outcomeFor('postgres', 'postgres://u:p@db:5432/adminium_meta');
    const text = describePreMigration(outcome).lines.join('\n');
    expect(text).toContain('NOT users, sessions, API keys or webhooks');
    expect(text).toMatch(/nobody can log in/i);
  });

  it('never echoes the DSN’s password into the log', async () => {
    const outcome = await outcomeFor('postgres', 'postgres://u:hunter2@db:5432/adminium_meta');
    const text = describePreMigration(outcome).lines.join('\n');
    expect(text).not.toContain('hunter2');
  });

  it('names the database for mysqldump, which takes no URL', async () => {
    const outcome = await outcomeFor('mysql', 'mysql://u:p@db:3306/adminium_meta');
    expect(outcome.kind === 'no-snapshot' && outcome.command).toContain(
      'mysqldump --single-transaction adminium_meta',
    );
  });

  it('does not name a variable that is not set', () => {
    // The DSN can come from `<dataDir>/adminium.json` or `--meta-url`, in which
    // case `$ADMINIUM_META_URL` expands to an empty string and the command the
    // operator pasted quietly dumps the wrong thing.
    expect(manualDumpCommand('postgres', 'postgres://u@h/db', 'bootstrap')).toContain(
      '<your meta DSN>',
    );
    expect(manualDumpCommand('postgres', 'postgres://u@h/db', 'env')).toContain(
      '$ADMINIUM_META_URL',
    );
  });
});

// ── 3. The downgrade guard ───────────────────────────────────────────────────

describe('a database migrated by a newer Adminium', () => {
  beforeEach(async () => {
    const handle = await store();
    await applyMigrations(handle.meta.db, { dialect: 'sqlite' });
    await writeFutureLedgerRow(handle.meta, '9999_from_the_future', '99.1.0');
    await handle.close();
    open.pop();
  });

  it('stops `adminium migrate` with exit 78 and both ways out', async () => {
    const io = fakeIo();
    await expect(runCli(['migrate'], { io, deps: realDeps() })).resolves.toBe(EXIT_CONFIG);

    const err = io.stderr();
    expect(err).toContain('migrated by a NEWER Adminium');
    expect(err).toContain('9999_from_the_future');
    expect(err).toContain('99.1.0'); // which build wrote it
    expect(err).toContain(join(dir, 'backups')); // where the snapshot is
    // The generic wording the migrator alone produced read like corruption.
    expect(err).not.toMatch(/^The migration ledger contains/);
  });

  it('stops `adminium start` the same way, before the server binds', async () => {
    const handle = await store();
    const deps = fakeDeps({
      env: {
        ADMINIUM_SECRET: TEST_SECRET,
        ADMINIUM_META_URL: metaUrl,
        ADMINIUM_DATA_DIR: dir,
      },
      runtime: fakeRuntime({ metaStore: handle }),
    });

    const io = fakeIo();
    await expect(runCli(['start'], { io, deps })).resolves.toBe(EXIT_CONFIG);
    expect(io.stderr()).toContain('migrated by a NEWER Adminium');
    expect(deps.startServer).not.toHaveBeenCalled();
    // The runtime is closed on the way out: `cli/index.ts` sets `process.exitCode`
    // and waits for the loop to drain, so a live pool would hang the process.
    expect(deps.runtime.close).toHaveBeenCalled();
  });

  it('takes no snapshot first — a rescue this build cannot read is not one', async () => {
    await runCli(['migrate'], { io: fakeIo(), deps: realDeps() });
    expect(await archives()).toHaveLength(0);
  });

  it('the refusal names the rows without needing their version', () => {
    const refusal = downgradeRefusal([{ name: '0014_later', appliedBy: null }], dir);
    expect(refusal.hint).toContain('0014_later');
    expect(refusal.hint).toContain('restore the snapshot');
  });
});

// ── 4. A snapshot that could not be written ──────────────────────────────────

describe('when the snapshot cannot be written', () => {
  it('refuses to migrate, with exit 78 and the two ways out', async () => {
    await installedAtPreviousVersion();
    // `<dataDir>/backups` occupied by a FILE: every mkdir under it fails
    // ENOTDIR, on every platform and as any user (a chmod would be a no-op for
    // root, which is exactly who a container runs as).
    await writeFile(join(dir, 'backups'), 'not a directory');

    const io = fakeIo();
    await expect(runCli(['migrate'], { io, deps: realDeps() })).resolves.toBe(EXIT_CONFIG);

    const err = io.stderr();
    expect(err).toContain('Could not write the pre-migration snapshot');
    expect(err).toContain('--skip-migrate');

    // AND the migration did not run: applying it unprotected is the failure the
    // snapshot exists to prevent, so a failed snapshot has to stop it.
    const handle = await store();
    const rows = await handle.meta.db.selectFrom('adminium_migrations').select('name').execute();
    expect(rows).toHaveLength(ALL_MIGRATIONS.length - 1);
  });
});

// ── The exit-code contract ───────────────────────────────────────────────────

describe('exit codes', () => {
  it('adds 78 without renumbering the published triple', () => {
    // 06 §10.4 is an API: scripts branch on 2 and 3. 78 is sysexits(3) EX_CONFIG.
    expect([EXIT_OK, EXIT_ERROR, EXIT_VALIDATION_FAILED, EXIT_NOTHING_ACCEPTED]).toEqual([
      0, 1, 2, 3,
    ]);
    expect(EXIT_CONFIG).toBe(78);
  });
});
