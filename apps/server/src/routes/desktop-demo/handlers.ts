/**
 * The demo database — seed the file, register the connection (11-electron.md §6
 * step 2 card 4, task 11-T08).
 *
 * ─── WHY THE SEED SCRIPT IS LOADED BY PATH ───────────────────────────────────
 *
 * `demo-seed.mjs` lives in `apps/desktop/resources/`, and `@adminium/server` may
 * not import `@adminium/desktop` — the dependency arrow points the other way
 * (.dependency-cruiser.cjs, rule `desktop-shell-only`), and it points that way
 * because self-host and Docker run this same server with no desktop package
 * within a mile of them. So the shell TELLS the server where the script is
 * (`ADMINIUM_DEMO_SEED_SCRIPT`, §2.2's env block) and the server imports that
 * path at runtime. `compose.ts` already loads `@adminium/widgets` by file path
 * for the same boundary reason; this is that pattern, not a new one.
 *
 * ─── WHY THE SERVER OPENS THE FILE, NOT THE SCRIPT ───────────────────────────
 *
 * §2.1: "The server is the only data owner." The script is a pure description of
 * a schema and its rows; the `better-sqlite3` handle it writes through is opened
 * here, by the process that owns every other database handle in the app. That
 * also keeps the script free of module resolution — see its header.
 */

import BetterSqlite3 from 'better-sqlite3';
import { mkdir, rename, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { AppError } from '../../errors.js';
import type { ConnectionManager } from '../../connections/manager.js';

/** §6: "creates `<dataDir>/databases/demo.sqlite`". Both halves are spec'd. */
export const DEMO_DATABASE_DIR = 'databases';
export const DEMO_DATABASE_FILE = 'demo.sqlite';

/** What `demo-seed.mjs` exports. Structural — the script is plain JS. */
export interface DemoSeeder {
  createDemoDatabase(input: {
    file: string;
    Database: typeof BetterSqlite3;
  }): Record<string, number>;
}

/** Rows-per-table, as the script reports them. */
export type DemoSeedCounts = Record<string, number>;

export interface DemoDatabaseResult {
  connectionId: string;
  name: string;
  file: string;
  seeded: boolean;
  rows: DemoSeedCounts;
}

export interface DemoDatabaseDeps {
  manager: ConnectionManager;
  /** `ADMINIUM_DATA_DIR` — the demo lands under it (§2.2/§6). */
  dataDir: string;
  /** Absolute path to `demo-seed.mjs` (`ADMINIUM_DEMO_SEED_SCRIPT`). */
  seedScriptPath: string;
  /**
   * Test seam. Production leaves it out and gets {@link importDemoSeeder}, which
   * imports {@link DemoDatabaseDeps.seedScriptPath} — the suites point it at the
   * REAL script rather than replacing it, because a fake seeder would test the
   * plumbing and not the fixture the whole task exists to produce.
   */
  loadSeeder?: ((scriptPath: string) => Promise<DemoSeeder>) | undefined;
}

/**
 * `import()` the seed script. The `file://` URL is required, not cosmetic: an
 * absolute Windows path (`C:\…`) is not a valid ESM specifier and throws
 * `ERR_UNSUPPORTED_ESM_URL_SCHEME`, which would make this route fail on exactly
 * one of the three platforms §10 ships.
 */
export async function importDemoSeeder(scriptPath: string): Promise<DemoSeeder> {
  const module: unknown = await import(pathToFileURL(scriptPath).href);
  const seeder = module as Partial<DemoSeeder>;
  if (typeof seeder.createDemoDatabase !== 'function') {
    throw new AppError(
      500,
      'INTERNAL',
      `The demo seed script at ${scriptPath} does not export createDemoDatabase().`,
    );
  }
  return seeder as DemoSeeder;
}

/** `<dataDir>/databases/demo.sqlite`, absolute. */
export function demoDatabaseFile(dataDir: string): string {
  return join(resolve(dataDir), DEMO_DATABASE_DIR, DEMO_DATABASE_FILE);
}

/** §6: "registered in `adminium_connections` as `sqlite:<absolute path>`". */
export function demoDsn(file: string): string {
  return `sqlite:${file}`;
}

/**
 * Create the demo database and register it.
 *
 * THREE STATES, because §6 promises the connection is "deletable afterwards from
 * Data Connections … nothing special" — and deleting a connection does not
 * delete the file behind it. So:
 *
 *   1. A connection already points at the demo file ⇒ 409. The wizard sends the
 *      user to the connection it already has; re-seeding underneath a live
 *      connection would silently discard whatever they had done to it.
 *   2. The file exists but no connection does (they deleted it and came back)
 *      ⇒ adopt the file as-is. NOT re-seeded: the app never destroys data the
 *      user could have edited (§9's ethos — even `restore` only moves data
 *      aside), and a demo they had been playing in is exactly that.
 *   3. Neither ⇒ seed, then register.
 *
 * State 2 is the one worth having: without it, deleting the demo connection
 * leaves the user permanently unable to make another (the file is in the way and
 * nothing in the UI removes it), which is a dead end reachable by one click on a
 * button the wizard offers.
 */
export async function createDemoDatabaseHandler(
  deps: DemoDatabaseDeps,
  input: { name: string; actorId: string | null },
): Promise<DemoDatabaseResult> {
  const file = demoDatabaseFile(deps.dataDir);
  const dsn = demoDsn(file);

  const existing = await findDemoConnection(deps.manager, dsn);
  if (existing !== null) {
    throw new AppError(
      409,
      'CONFLICT',
      'The demo database is already connected. Delete it from Data Connections to start over.',
      { connectionId: existing },
    );
  }

  let seeded = false;
  let rows: DemoSeedCounts = {};
  if (!existsSync(file)) {
    rows = await seedDemoFile(deps, file);
    seeded = true;
  }

  // The same probe `POST /connections` runs, for the same reasons: it decides
  // `readOnly` and it is what `enforceMetaPlacement` reads. A demo file cannot
  // BE the meta store (§2.1 puts that at `<dataDir>/meta.db`), but the check is
  // cheap and asserting placement here rather than assuming it means the day
  // someone changes either path, this fails loudly instead of quietly sharing.
  const summary = await deps.manager.testDsn('sqlite', dsn);
  if (summary.ok) deps.manager.enforceMetaPlacement(dsn, summary);

  const connection = await deps.manager.connections.create({
    name: input.name,
    engine: 'sqlite',
    sourceKind: 'dsn',
    introspectDsn: dsn,
    // One role: `POST /connections` stores `null` when data and introspect are
    // the same string, and Data Connections renders whichever is set.
    dataDsn: null,
    readOnly: summary.readOnly,
    settings: {},
    status: summary.ok ? 'connected' : 'error',
    createdBy: input.actorId,
  });
  await deps.manager.connections.recordTestResult(connection.id, {
    ok: summary.ok,
    latencyMs: summary.latencyMs,
    error: summary.error?.message ?? null,
    readOnly: summary.readOnly,
  });

  return { connectionId: connection.id, name: connection.name, file, seeded, rows };
}

/**
 * Seed the demo database so that `demo.sqlite` only ever exists COMPLETE.
 *
 * ─── WHY THIS IS NOT `createDemoDatabase({ file })` ──────────────────────────
 *
 * `new Database(file)` CREATES THE FILE ON OPEN — before the schema, before the
 * row transaction. Seeding straight into `demo.sqlite` therefore published an
 * empty database the instant the seeder started, and left it there for good if
 * anything went wrong in the ~800 ms that followed: the app quits mid-seed, the
 * disk fills, or `journal_mode = WAL` fails because dataDir is on a network or
 * synced share (the exact placement 11-T03's sync-folder detection exists to
 * warn about).
 *
 * Nothing removed that file, and state 2 above adopts any `demo.sqlite` it finds
 * BY DESIGN — so the wreckage was claimed as "a demo the user had been playing
 * in" on every subsequent click, forever. Reproduced against the real route: a
 * 0-byte demo.sqlite returns 201 `{seeded:false, rows:{}}`, `testDsn` says ok
 * (an empty file is a valid 0-table SQLite database), the connection registers
 * as 'connected', and `generate` then produces 0 pages from 0 tables. The button
 * becomes a permanent success-returning no-op — the same dead end state 2 was
 * added to prevent, reached by one click on a button the wizard offers.
 *
 * ─── THE FIX: A TEMP FILE AND A RENAME ──────────────────────────────────────
 *
 * `rename` is atomic and same-directory, so `demo.sqlite` goes from absent to
 * fully-seeded with no state in between that `existsSync` can observe. A crash
 * mid-seed leaves only `demo.sqlite.<uuid>.partial`, which state 2 does not look
 * for and the next attempt simply ignores. A try/catch alone could not deliver
 * that: it does not run when the process is killed, which is the case that
 * matters most here.
 *
 * The seeder closes its handle in a `finally` and `wal_checkpoint(TRUNCATE)`s on
 * the way out, so a clean close leaves no `-wal`/`-shm` beside the temp file.
 * The cleanup removes them anyway — an UNCLEAN close is exactly when they exist,
 * and that is exactly the path this function is here for.
 */
async function seedDemoFile(deps: DemoDatabaseDeps, file: string): Promise<DemoSeedCounts> {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.partial`;
  try {
    const loadSeeder = deps.loadSeeder ?? importDemoSeeder;
    const seeder = await loadSeeder(deps.seedScriptPath);
    const rows = seeder.createDemoDatabase({ file: temp, Database: BetterSqlite3 });
    await rename(temp, file);
    return rows;
  } catch (error) {
    // Best effort, and it must not mask the real failure: the user needs to know
    // the disk filled, not that we then failed to tidy up after it.
    await Promise.all(
      [temp, `${temp}-wal`, `${temp}-shm`].map((path) => rm(path, { force: true }).catch(() => undefined)),
    );
    throw error;
  }
}

/** The connection id whose introspect/data DSN is the demo file, if any. */
async function findDemoConnection(
  manager: ConnectionManager,
  dsn: string,
): Promise<string | null> {
  for (const connection of await manager.connections.list()) {
    if (connection.engine !== 'sqlite') continue;
    const dsns = await manager.connections.getDsns(connection.id);
    if (dsns?.introspectDsn === dsn || dsns?.dataDsn === dsn) return connection.id;
  }
  return null;
}
