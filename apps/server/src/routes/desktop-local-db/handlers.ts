// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Create a local SQLite database and register it (11-electron.md §6 step 2
 * card 1, task 11-T07).
 *
 * §6: "Name → slug → creates `<dataDir>/databases/<slug>.sqlite` (WAL, §9).
 * Sub-choice: *Blank* … or *From a schema file* … translated to SQLite DDL and
 * applied; includes the 'Auto-generate placeholder entries' toggle."
 *
 * ─── WHY THE SERVER CREATES THE FILE AT ALL ──────────────────────────────────
 *
 * `adapter-sqlite` opens every handle with `fileMustExist: true` for anything but
 * `:memory:` (`packages/adapter-sqlite/src/index.ts`), which is correct — an
 * adapter that creates a database when it fails to find one turns a typo in a DSN
 * into a silently empty install. So `POST /connections` with
 * `sqlite:/…/new.sqlite` cannot be the implementation of "create a new local
 * database": it fails, and it fails for a good reason. This route is where the
 * file legitimately comes into existence, and it is desktop-only for the same
 * reason `desktop-demo` is — §2.1's "the server is the only data owner" holds,
 * and `<dataDir>` only means something under the shell.
 *
 * ─── WHY `better-sqlite3` DIRECTLY AND NOT THROUGH THE ADAPTER ───────────────
 *
 * Same answer as `desktop-demo/handlers.ts`: the adapter's contract is
 * introspect/query/mutate over an EXISTING database, and there is no `execute
 * arbitrary DDL` method on it — deliberately, since that method is the one every
 * SQL-injection review starts at. Creating a file and running a CREATE TABLE
 * script is a different act from serving a connection, so it is spelled
 * differently. `@adminium/adapter-sqlite`'s own pragma helper is reused rather
 * than a second copy of §9's four lines (see `applyDataPragmas` below).
 */

import BetterSqlite3 from 'better-sqlite3';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseDatabaseModel, type DatabaseModel, type ImportFormat, type TableModel } from '@adminium/engine';

import { AppError, ValidationFailedError } from '../../errors.js';
import type { ConnectionManager } from '../../connections/manager.js';
import { emitSqliteDdl, orderTables, quoteIdent, type DdlWarning } from './sqlite-ddl.js';
import { planPlaceholderRows } from './placeholder.js';

/** §6: `<dataDir>/databases/<slug>.sqlite`. Shared with `desktop-demo`'s copy. */
export const LOCAL_DATABASE_DIR = 'databases';

/**
 * Name → slug.
 *
 * The output alphabet is `[a-z0-9-]`, which is what makes {@link localDatabaseFile}
 * safe by construction rather than by a path check: `../../etc/passwd`,
 * `C:\evil`, and a NUL byte all reduce to hyphens, so no input can escape
 * `<dataDir>/databases/`. That is the SECOND line of defence — the name is also
 * length-capped by the Zod body — but it is the one that does not depend on
 * anybody keeping a validator in sync with a path join.
 */
export function slugFor(name: string): string {
  const slug = name
    .normalize('NFKD')
    // Strip combining marks so `Café` → `cafe` rather than `caf-`.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  // A name of only non-Latin characters (`日本語`, `العربية`) legitimately slugs
  // to nothing. Rejecting it would make the wizard's first field refuse a
  // perfectly good database name in three of the eight locales this app ships.
  return slug.length > 0 ? slug : 'database';
}

/** `<dataDir>/databases/<slug>.sqlite`, absolute. */
export function localDatabaseFile(dataDir: string, slug: string): string {
  return join(resolve(dataDir), LOCAL_DATABASE_DIR, `${slug}.sqlite`);
}

/** §6: "registered in `adminium_connections` as `sqlite:<absolute path>`". */
export function localDsn(file: string): string {
  return `sqlite:${file}`;
}

export interface LocalDatabaseResult {
  connectionId: string;
  name: string;
  slug: string;
  file: string;
  tables: string[];
  rows: Record<string, number>;
  warnings: DdlWarning[];
}

export interface LocalDatabaseDeps {
  manager: ConnectionManager;
  /** `ADMINIUM_DATA_DIR` — the database lands under it (§2.2/§6). */
  dataDir: string;
  /**
   * Parse a schema file into the engine IR. Production passes
   * `routes/schema-import`'s `parseSchemaFile` — the SAME resolver
   * `POST /schema-import/parse` uses, so the eight formats behave identically on
   * both paths and there is no second answer to "is this a valid Prisma schema".
   */
  parseSchema: (input: {
    content: string;
    format: ImportFormat | undefined;
    fileName: string | undefined;
  }) => Promise<{ model: DatabaseModel; warnings: string[] }>;
  /** Injected for the suite; see `placeholder.ts`. */
  now?: (() => Date) | undefined;
}

export interface LocalDatabaseInput {
  name: string;
  schemaFile: { content: string; format: ImportFormat | undefined; fileName: string | undefined } | undefined;
  placeholderRows: boolean;
  actorId: string | null;
}

/**
 * §9's four pragmas, applied at creation so the file is WAL from its first byte.
 *
 * They are re-applied by `adapter-sqlite`'s data role on every open, which is
 * what actually keeps them true — `journal_mode` is the only one that persists in
 * the file header; `synchronous`, `foreign_keys` and `busy_timeout` are
 * per-connection and reset to their defaults for anybody who opens the file
 * without them. Setting them here is still not redundant: `foreign_keys = ON`
 * governs THIS connection, the one that is about to run the placeholder INSERTs,
 * and without it a dangling FK would be written silently instead of rejected.
 */
function applyCreationPragmas(db: BetterSqlite3.Database): void {
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
}

export async function createLocalDatabaseHandler(
  deps: LocalDatabaseDeps,
  input: LocalDatabaseInput,
): Promise<LocalDatabaseResult> {
  const slug = slugFor(input.name);
  const file = localDatabaseFile(deps.dataDir, slug);
  const dsn = localDsn(file);

  // Two different conflicts, and collapsing them would be a lie in one
  // direction or the other: a file already here is the user's data (never
  // overwritten — §9's ethos is that the app moves data aside and never
  // destroys it), while a connection already here is a naming collision.
  if (existsSync(file)) {
    throw new AppError(
      409,
      'CONFLICT',
      `A database file named "${slug}.sqlite" already exists. Choose a different name, or open the existing file instead.`,
      { slug, file },
    );
  }
  const clash = await findConnectionForDsn(deps.manager, dsn);
  if (clash !== null) {
    throw new AppError(409, 'CONFLICT', `A connection named "${input.name}" already points at this file.`, {
      connectionId: clash,
    });
  }

  const warnings: DdlWarning[] = [];
  let tables: string[] = [];
  let rows: Record<string, number> = {};

  await mkdir(dirname(file), { recursive: true });

  // From here on the FILE EXISTS. Every failure below must remove it: a
  // half-created database left on disk means the user's retry hits the 409
  // above — a dead end reachable by one rejected CHECK constraint, with no
  // affordance anywhere in the product to clear it.
  let db: BetterSqlite3.Database;
  try {
    db = new BetterSqlite3(file);
  } catch (error) {
    throw new AppError(500, 'INTERNAL', `Could not create ${file}: ${messageOf(error)}`);
  }

  try {
    applyCreationPragmas(db);

    if (input.schemaFile !== undefined) {
      const parsed = await parseOrReject(deps, input.schemaFile);
      // The PARSER's gaps come first because they happened first: a
      // `CREATE VIEW` the SQL parser could not read never reaches the emitter,
      // so `emitSqliteDdl` cannot know it existed. Only the two lists together
      // describe what the user's file lost on the way to their database.
      warnings.push(
        ...parsed.warnings.map((message) => ({
          code: 'source-not-translated' as const,
          message,
          tableId: null,
        })),
      );
      const ddl = emitSqliteDdl(parsed.model);
      warnings.push(...ddl.warnings);
      tables = ddl.tables;

      applyDdl(db, ddl.statements);

      if (input.placeholderRows) {
        rows = seedPlaceholders(db, parsed.model, deps.now?.() ?? new Date());
      }
    }

    // §9: "`wal_checkpoint(TRUNCATE)` runs on server shutdown so `.sqlite` files
    // are self-contained at rest." The same reasoning applies the moment this
    // handle closes: the connection that opens the file next is a different
    // process' handle in dev, and a user who backs up or copies the file
    // seconds after the wizard created it should get all of it.
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch (error) {
    db.close();
    await removeQuietly(file);
    if (error instanceof AppError) throw error;
    throw new AppError(500, 'INTERNAL', `Could not build ${slug}.sqlite: ${messageOf(error)}`);
  } finally {
    if (db.open) db.close();
  }

  // The same probe `POST /connections` runs — see `desktop-demo/handlers.ts`,
  // which explains why placement is asserted rather than assumed.
  const summary = await deps.manager.testDsn('sqlite', dsn);
  if (summary.ok) deps.manager.enforceMetaPlacement(dsn, summary);

  const connection = await deps.manager.connections.create({
    name: input.name,
    engine: 'sqlite',
    sourceKind: 'dsn',
    introspectDsn: dsn,
    // One role — `POST /connections` stores null when both DSNs are the string.
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

  return { connectionId: connection.id, name: connection.name, slug, file, tables, rows, warnings };
}

async function parseOrReject(
  deps: LocalDatabaseDeps,
  schemaFile: NonNullable<LocalDatabaseInput['schemaFile']>,
): Promise<{ model: DatabaseModel; warnings: string[] }> {
  const parsed = await deps.parseSchema({
    content: schemaFile.content,
    format: schemaFile.format,
    fileName: schemaFile.fileName,
  });
  // Re-validated even though `parseSchema` already did: this handler is a write
  // boundary, and the injected parser is a seam a test can replace.
  const model = parseDatabaseModel(parsed.model);
  if (model.tables.length === 0) {
    // Mirrors `POST /schema-import/parse`'s own rejection: a parse that yields
    // zero tables is not a database, and creating an empty file for it would
    // hand the user a "success" they then cannot explain.
    throw new ValidationFailedError('The schema file contained no parseable tables.', {
      reason: 'PARSE_FAILED',
      info: { warnings: parsed.warnings },
    });
  }
  return { model, warnings: parsed.warnings };
}

/**
 * Run the DDL as ONE transaction.
 *
 * SQLite is transactional for DDL (unlike MySQL), so a rejected statement rolls
 * the whole script back and the database is empty rather than half a schema. The
 * caller then deletes the file — but the transaction is what makes that deletion
 * a tidy-up rather than the actual recovery.
 *
 * The statement text rides in the error message because there is nowhere else
 * for the user to see it: the schema file is theirs, the failure is almost always
 * in a `CHECK` expression written in another engine's dialect (`sqlite-ddl.ts`
 * documents why those are passed through), and "SQLITE_ERROR: near ')'" without
 * the statement is unactionable. It carries no row data — this database has none
 * yet.
 */
function applyDdl(db: BetterSqlite3.Database, statements: readonly string[]): void {
  const run = db.transaction((script: readonly string[]) => {
    for (const statement of script) {
      try {
        db.exec(statement);
      } catch (error) {
        throw new ValidationFailedError(
          `The schema could not be applied to SQLite: ${messageOf(error)}`,
          { reason: 'DDL_FAILED', statement },
        );
      }
    }
  });
  run(statements);
}

/** Insert the planned placeholder rows; returns rows-written per table. */
function seedPlaceholders(db: BetterSqlite3.Database, model: DatabaseModel, now: Date): Record<string, number> {
  const { order } = orderTables(model);
  const prefixed = needsPrefix(order);
  const nameOf = (table: TableModel): string => (prefixed ? `${table.schema}_${table.name}` : table.name);

  const plan = planPlaceholderRows(model, order, nameOf, { now });
  const written: Record<string, number> = {};

  const run = db.transaction(() => {
    for (const insert of plan.inserts) {
      const columns = insert.columns.map(quoteIdent).join(', ');
      const marks = insert.columns.map(() => '?').join(', ');
      const statement = db.prepare(`INSERT INTO ${quoteIdent(insert.table)} (${columns}) VALUES (${marks})`);
      for (const row of insert.rows) statement.run(row);
      written[insert.table] = insert.rows.length;
    }
  });
  run();

  return written;
}

/** Mirrors `sqlite-ddl.ts`'s rule — see `needsSchemaPrefix` there. */
function needsPrefix(tables: readonly TableModel[]): boolean {
  const seen = new Set<string>();
  for (const table of tables) {
    if (seen.has(table.name)) return true;
    seen.add(table.name);
  }
  return false;
}

/** The connection id whose introspect/data DSN is this file, if any. */
async function findConnectionForDsn(manager: ConnectionManager, dsn: string): Promise<string | null> {
  for (const connection of await manager.connections.list()) {
    if (connection.engine !== 'sqlite') continue;
    const dsns = await manager.connections.getDsns(connection.id);
    if (dsns?.introspectDsn === dsn || dsns?.dataDsn === dsn) return connection.id;
  }
  return null;
}

/**
 * Best-effort cleanup of a failed creation.
 *
 * Failure to delete is swallowed on purpose: the user is already getting the
 * REAL error (the DDL that would not apply), and replacing it with "could not
 * unlink a temp file" would hide the one message they can act on. WAL/SHM
 * siblings go too — `close()` normally removes them, but a crashed handle can
 * leave them behind, and an orphan `-wal` next to a recreated file of the same
 * name is a corruption report waiting to happen.
 */
async function removeQuietly(file: string): Promise<void> {
  const { rm } = await import('node:fs/promises');
  for (const path of [file, `${file}-wal`, `${file}-shm`]) {
    try {
      await rm(path, { force: true });
    } catch {
      // see above
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
