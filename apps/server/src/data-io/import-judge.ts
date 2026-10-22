// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What an import would do with each line of its file: the one judge the
 * `import-run` job and the preview (`GET /imports/:id/preview`) both ask.
 *
 * A line is NEW (a row would be made of it), HERE (it matches a row its
 * requester reaches: an `upsert` would update that row, a `skip` leaves it
 * as it is), or REFUSED, with the reason. The job asks, then writes; the
 * preview asks and writes nothing. Both are held to the same rules because
 * they are the same lines of code:
 *
 * - WHOSE ROWS. The import is judged as the person who asked for it, as their
 *   roles stand now. An `upsert` matches among the rows their update reaches,
 *   a `skip` among the rows their read reaches. A match value held by a row
 *   outside that reach is refused (`ALREADY_EXISTS`) in words that name
 *   nothing of the row: the database would have refused the insert anyway,
 *   since somebody held to some rows matches only on a column no two rows
 *   share.
 * - WHO MAY MATCH AT ALL. A line called HERE or NEW says whether a value is
 *   in the table. So an import that matches (`skip`, `upsert`) is opened
 *   only for a requester who holds the table's `read`, as their roles stand
 *   now, and never on a column they see masked: refused whole (403), for the
 *   preview and the run alike.
 * - A KEY THAT IS TAKEN. A line that would be a new row, whose key (a
 *   one-column primary key, when the file brings it) is already a row's, is
 *   refused `ALREADY_EXISTS` whoever's that row is: the database would refuse
 *   the insert, and says no more than this does.
 * - WHAT A ROW NAMES. For somebody held to some rows, each link names a row
 *   they reach and each staff column a person the table lets them name.
 * - THE TABLE'S RULES, through the write service's fill and check. A line
 *   that becomes a row is a create by the person who brought the file, and a
 *   line that changes one a change by them: a default, a code, a copy, a
 *   formula and a number are worked out as for any save, and a stamp is
 *   written into a column the line leaves out or empty. What a line carries
 *   is kept, and is held to what its bringer may give a new row.
 *
 * ONE DIFFERENCE, and the preview says so (`hooksNotRun`): a project's hooks
 * run only in the job. A preview that ran them would run somebody's code for
 * rows nobody wrote.
 */
import { usersRepo, type DataImport, type MetaDb } from '@adminium/meta';
import { sql, type Kysely } from 'kysely';

import type { ConnectionManager, SourceDatabase } from '../connections/manager.js';
import { tableRulesFor, type FieldIssues } from '../crud/column-rules.js';
import type { ResolvedColumn, ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import { UNMASK_PERMISSION, type Row } from '../crud/mask.js';
import { assertImportReadable, readViewOf } from '../crud/read-view.js';
import { rowLimitContextForUser, rowLimitContextOf, rowTestOf, venueDayOf } from '../crud/row-limit-context.js';
import { assertNotPrivate, writerReaches, type RowLimitContext, type RowTest } from '../crud/row-limit.js';
import { assertLinksReached, assertLinksToUnreadTables, assertStaffColumns, type LinkWriter } from '../crud/row-writes.js';
import {
  HookFailedError,
  HookRejectedError,
  bindValue,
  createWriteService,
  normalizeText,
  type CheckedRow,
  type RecordWriteService,
  type WriteContext,
  type WriteTarget,
} from '../crud/write-service.js';
import { writeStores } from '../crud/write-stores.js';
import { AppError, ForbiddenError, ValidationFailedError } from '../errors.js';
import { permissionSetAllows, resolvePermissionSet } from '../rbac/resolver.js';
import { assertImportCreatable, assertMovedFrom, assertWithinLimit, changesRow, createLimitOf, updateLimitOf, type MergedLimit } from '../rbac/update-limits.js';
import { scrubRefusal } from '../routes/data/refusal-scrub.js';
import { coerceCell } from './coerce.js';
import { loadSnapshotView } from './snapshot-view.js';

type Db = Kysely<SourceDatabase>;
type Dialect = WriteTarget['dialect'];

/**
 * An import brings in history: yesterday's bookings are not new ones for a
 * booking limit to judge, and a table that has one takes its rows here.
 */
export const HISTORY = { capacity: 'unchecked' } as const;

/** How many values one match lookup asks the database about. */
const LOOKUP_BATCH = 200;

/** What the requester is told of a match value held by a row they do not reach: nothing of the row. */
export const ALREADY_EXISTS_MESSAGE = 'A row with this value already exists.';

/** Why an import that matches is refused to somebody who does not read its table. */
export const MATCH_NEEDS_READ_MESSAGE = 'Matching lines against the rows already there needs the right to read this table.';

/**
 * Refuse (403 `TABLE_FORBIDDEN`, as a missing import grant is) an import that
 * matches its lines to stored rows for somebody who does not read the table:
 * which lines are already there is what a read of it would tell.
 */
export function assertMatchReadable(reads: boolean, mode: ImportMode, connectionId: string, tableId: string): void {
  if (mode === 'insert' || reads) return;
  throw new ForbiddenError(MATCH_NEEDS_READ_MESSAGE, 'TABLE_FORBIDDEN', { permission: `table:${connectionId}:${tableId}:read` });
}

/**
 * Refuse (403 `TABLE_FORBIDDEN`) an import that changes the rows it matches
 * for somebody who may not change a row of the table: bringing a file in
 * makes rows, and is no way round the update they do not hold.
 */
export function assertUpsertUpdates(updates: boolean, mode: ImportMode, connectionId: string, tableId: string): void {
  if (mode !== 'upsert' || updates) return;
  throw new ForbiddenError('A file that changes the rows it matches is for somebody who may change them. Bring it in leaving those rows as they are, or ask for the update.', 'TABLE_FORBIDDEN', { permission: `table:${connectionId}:${tableId}:update` });
}

export type ImportMode = 'insert' | 'upsert' | 'skip';

export interface ImportJudgeDeps {
  meta: MetaDb;
  manager: ConnectionManager;
  /** Where the rows go; the hooks and rules a row is judged by. */
  writes?: RecordWriteService | undefined;
}

/** One line of the file, its mapped cells read as their columns' types. */
export interface ImportLine {
  rowNumber: number;
  values: Record<string, unknown>;
  raw: string[];
}

/** A cell that could not be read as its column's type. */
export interface CellIssue {
  row: number;
  column: string;
  code: string;
  message: string;
  raw: string;
}

export type LineVerdict =
  /** A row would be made of it: `values` as they would be written. */
  | { status: 'new'; values: CheckedRow }
  /** It matches a row the requester reaches: `values` is what an update would write, null where the row is left as it is. */
  | { status: 'here'; before: Row; values: CheckedRow | null; earlierLine?: number }
  | { status: 'refused'; code: string; column: string; message: string };

/** A line the preview already called new, by its match value as the database compares it: a later line with the same value finds it. */
export type EarlierLines = Map<string, { line: number; values: Row }>;

export interface JudgeOptions {
  /** Whether the project's before hooks run (the job) or not (the preview, which also claims no number). */
  hooks: boolean;
  /** The preview's memory of the lines it called new; the job reads the database, where they are by then. */
  earlier?: EarlierLines | undefined;
  /** …and of their keys, by line: a later line with a key an earlier one took is refused as the database would refuse it. */
  earlierKeys?: Map<string, number> | undefined;
}

export interface MappedColumn {
  index: number;
  from: string;
  column: ResolvedColumn;
}

export interface ImportJudge {
  view: SnapshotView;
  table: ResolvedTable;
  db: Db;
  dialect: Dialect;
  writes: RecordWriteService;
  writeTarget: WriteTarget;
  context: WriteContext;
  /** Whether any hook wants this import's creates and updates, asked once. */
  hooked: { create: boolean; update: boolean };
  mode: ImportMode;
  /** The column lines are matched on; null for an import where every line is new. */
  match: ResolvedColumn | null;
  reach: RowLimitContext | null;
  /** Whether each row is judged on its own: the requester reaches only some rows, or links into a table they do not read. */
  held: boolean;
  /** The test a row passes for the requester's update to reach it, or null. */
  updateTest: RowTest | null;
  /** Whether new lines are checked a chunk at a time and written in one INSERT. */
  fast: boolean;
  /** A refusal's words, as the requester may read them. */
  told: (error: unknown) => string;
  /** The mapping, resolved against the file's header. */
  mapping: (header: readonly string[]) => MappedColumn[];
  /** One record of the file read as its mapped columns' types. */
  parse: (mapped: readonly MappedColumn[], record: readonly string[], rowNumber: number) => { line: ImportLine; issues: null } | { line: null; issues: CellIssue[] };
  /** Each line's verdict, in order. */
  lines: (items: readonly ImportLine[], opts: JudgeOptions) => Promise<LineVerdict[]>;
}

/** Resolve the mapping into (csv column index → resolved target column). */
function resolveMapping(header: readonly string[], mapping: DataImport['mapping'], view: SnapshotView, table: ResolvedTable): MappedColumn[] {
  const byName = new Map<string, number>();
  header.forEach((name, index) => byName.set(name.trim(), index));
  const out: MappedColumn[] = [];
  for (const entry of mapping.columns) {
    if (entry.to === null) continue; // "Don't import"
    // A code (a shared link's token) is Adminium's to make, never a file's to bring.
    if (table.table.columns.find((column) => column.name === entry.to)?.code !== undefined) continue;
    const index = byName.get(entry.from.trim());
    if (index === undefined) {
      throw new Error(`mapped source column ${JSON.stringify(entry.from)} is not in the file header`);
    }
    out.push({ index, from: entry.from, column: view.column(table, entry.to) });
  }
  if (out.length === 0) throw new Error('the mapping imports no columns');
  return out;
}

/** A match value as a key two lines, or a line and a stored row, are told alike by. */
const keyOf = (value: unknown): string => (value instanceof Date ? value.toISOString() : String(value));

/**
 * A value as two lines of ONE FILE are told alike by, for a column of this
 * engine. A stored row is never told by this: the database is asked, and its
 * answer is the answer. It is for the one thing the database cannot be asked,
 * a row an earlier line of the file would have made.
 *
 * Nothing in the snapshot says how a column compares text, so each engine is
 * taken at what it does unless told otherwise: MySQL holds `ABC`, `abc` and
 * `àbc` to be one (case and accents; a binary column apart); Postgres and
 * SQLite hold them to be three (a `citext` column apart). A column made to
 * compare the other way (`COLLATE NOCASE`, a `_bin` collation) is judged by
 * its engine's habit here, and by the database itself when the import runs.
 */
function sameAs(dialect: Dialect, column: ResolvedColumn | null, dbType: string | undefined): (value: unknown) => string {
  const type = (dbType ?? '').toLowerCase();
  const loose = column !== null && column.textish && (dialect === 'mysql' ? !/binary|blob/.test(type) : dialect === 'postgres' ? type.includes('citext') : false);
  if (!loose) return keyOf;
  return (value) => (typeof value === 'string' ? value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase() : keyOf(value));
}

/** A row the table's rules refused: its field and the reason. */
function refusedBy(fieldIssues: FieldIssues | null): LineVerdict {
  const [column, issue] = Object.entries(fieldIssues ?? {})[0] ?? ['', null];
  const code = issue?.code ?? 'invalid';
  return { status: 'refused', code: 'REFUSED', column, message: column === '' ? `the value was refused (${code})` : `${column}: ${code}` };
}

/**
 * Open the judge of one import: its table, its requester as their roles
 * stand NOW, and everything that refuses the import as a whole (a read-only
 * connection, a private table, a column the requester may not bring in, a
 * match column two rows could share for somebody held to some rows).
 * `actorId` is who the writes are made as; nobody for a file nobody asked for.
 */
export async function openImportJudge(deps: ImportJudgeDeps, row: DataImport, actorId: string | undefined): Promise<ImportJudge> {
  const connection = await deps.manager.mustFind(row.connectionId);
  if (connection.readOnly) {
    throw new Error('This connection is read-only — Adminium never writes to it.');
  }
  const view = await loadSnapshotView(deps.meta, row.connectionId);
  const table = view.table(row.tableName);
  if (table.readOnly) throw new Error(`Table ${table.id} is read-only.`);
  assertNotPrivate(table, 'no file is brought in to it');

  const data = await deps.manager.data(row.connectionId);
  const db = data.db as Db;
  const dialect = data.dialect;
  const writes = deps.writes ?? createWriteService(writeStores(deps.meta));
  const writeTarget: WriteTarget = { connectionId: row.connectionId, view, table, db: data.db, dialect };
  // Who the lines are written as, by the name a save of theirs is stamped with (`rbac/principal.ts`).
  const importer = actorId === undefined ? null : await usersRepo(deps.meta).findById(actorId);
  const context: WriteContext = {
    origin: 'import',
    hops: 0,
    actor: actorId === undefined ? { kind: 'system', id: null, label: 'system' } : { kind: 'user', id: actorId, label: importer?.name || importer?.email || actorId },
    request: null,
    // Each line is its bringer's create or change: a stamp fills what the line leaves out (`crud/decide.ts`).
    stamps: 'left-out',
  };
  /**
   * The columns Adminium fills by itself: a stamp, a default. An empty cell
   * under one that must hold a value is a cell left out, for the rule to fill,
   * and not a line to refuse.
   */
  const rules = tableRulesFor(writeTarget);
  const filledByRule = new Set([...(rules?.stamps ?? []).map((stamp) => stamp.column), ...(rules?.fills ?? []).filter((fill) => fill.kind !== 'none').map((fill) => fill.column)]);
  const defaulted = defaultedColumns(view, table);
  // Hooks judge rows one at a time, so a table with any hook for this import
  // is written row by row. Asked once: the hooks in force when the import
  // started decide how the whole file is written.
  const hooked = {
    create: (await writes.wants('before', 'create', writeTarget, context)) || (await writes.wants('after', 'create', writeTarget, context)),
    update: (await writes.wants('before', 'update', writeTarget, context)) || (await writes.wants('after', 'update', writeTarget, context)),
  };

  const mode: ImportMode = row.options.mode ?? 'insert';
  const matchColumn = mode === 'insert' ? null : (row.options.matchColumn ?? null);
  if (mode !== 'insert' && matchColumn === null) {
    throw new Error(`${mode} mode requires options.matchColumn`);
  }
  const match = matchColumn === null ? null : view.column(table, matchColumn);
  // As the person who asked reads the table, again now: a role narrowed since the import was made is held to it.
  let readView: SnapshotView | null = null;
  /*
   * WHOSE ROWS. The import writes as the person who asked for it, as their
   * roles stand now: somebody held to some rows of the table (`crud/row-
   * limit.ts`) changes only rows they reach, names in a staff column only
   * people the table lets them name, and links only to rows they reach. For
   * them every row is written on its own, so each is judged; and a line
   * is matched on a column no two rows share, or a row they cannot see could
   * be the one that matched.
   */
  let reach: RowLimitContext | null = null;
  /** The requester as a link is judged by, where the file's table links into one they do not read and that says whose its rows are. */
  let writer: LinkWriter | null = null;
  /** What the requester's role may change in a row that is already here: a matched line is that change, judged as a PATCH is. */
  let updateLimit: MergedLimit | null = null;
  if (row.requestedBy !== null) {
    const permissions = await resolvePermissionSet(deps.meta, { kind: 'user', id: row.requestedBy, label: row.requestedBy });
    updateLimit = updateLimitOf(permissions, row.connectionId, table.id);
    reach = await rowLimitContextOf(deps.meta, permissions, row.connectionId, view.model);
    const unread = view.model.relations.some((relation) => {
      if (relation.through !== null || relation.from.tableId !== table.id) return false;
      const target = view.model.tables.find((candidate) => candidate.id === relation.to.tableId);
      return target !== undefined && (target.belongs !== undefined || target.private === true) && !permissionSetAllows(permissions, `table:${row.connectionId}:${target.id}:read`);
    });
    if (unread) {
      const requester = row.requestedBy;
      writer = { reads: (tableId) => permissionSetAllows(permissions, `table:${row.connectionId}:${tableId}:read`), userId: requester, today: () => venueDayOf(deps.meta, row.connectionId) };
    }
    // Asked again now: a read taken away since the import was made ends its matching, for the preview and the run.
    assertMatchReadable(permissionSetAllows(permissions, `table:${row.connectionId}:${table.id}:read`), mode, row.connectionId, table.id);
    // …and an update taken away ends its changing of rows.
    assertUpsertUpdates(permissionSetAllows(permissions, `table:${row.connectionId}:${table.id}:update`), mode, row.connectionId, table.id);
    readView = readViewOf(view, permissions);
    const canReadPii = permissionSetAllows(permissions, UNMASK_PERMISSION) || permissionSetAllows(permissions, `table:${row.connectionId}:${table.id}:read_pii`);
    assertImportReadable(readView, table.id, row.mapping.columns, matchColumn, updateLimitOf(permissions, row.connectionId, table.id)?.writable ?? null, canReadPii);
    assertImportCreatable(createLimitOf(permissions, row.connectionId, table.id), table.id, row.mapping.columns);
  } else {
    // Nobody asked for it: it changes no row of a table that says whose its rows are, as a file nobody asked for holds none.
    reach = await rowLimitContextForUser(deps.meta, null, row.connectionId, view.model);
  }
  // Each row judged on its own: for somebody held to some rows of the table, and for somebody whose rows would link into a table they do not read.
  const held = (reach !== null && writerReaches(reach, table.id) !== null) || writer !== null;
  const updateTest = rowTestOf(reach, table.id, 'update');
  // A line left alone when its row is here changes nothing: it is matched among the rows the requester reads.
  const matchTest = mode === 'skip' ? rowTestOf(reach, table.id, 'read') : updateTest;
  /**
   * The table's key, when it is one column and not the column lines are
   * matched on (a matched key is already looked for). A line that would be a
   * new row is looked for by it, when the file brings it. A key of several
   * columns is left to the database, which refuses the insert.
   */
  const keyColumn = table.primaryKey.length === 1 && table.primaryKey[0] !== match?.name ? table.primaryKey[0]! : null;
  const dbTypeOf = (name: string | null): string | undefined => table.table.columns.find((column) => column.name === name)?.dbType;
  /** A match value, and a key, as two lines of one file are told alike by. */
  const matchKey = sameAs(dialect, match, dbTypeOf(match?.name ?? null));
  const keyKey = sameAs(dialect, keyColumn === null ? null : (table.columns.get(keyColumn) ?? null), dbTypeOf(keyColumn));
  if (held && match !== null && !(match.isPrimaryKey || table.table.columns.find((column) => column.name === match.name)?.isUnique === true)) {
    throw new ValidationFailedError(`Rows of ${table.name} are matched on a column no two rows share (its key, or a unique column): ${match.name} is neither.`, { matchColumn: match.name });
  }

  /** What one row names, judged for a requester who reaches only some rows: nothing for anybody else (a file brought in as history keeps what it names). */
  const judge = async (values: Row, before: Row | null): Promise<void> => {
    if (!held) return;
    await assertLinksReached(reach, db, table.id, values, before);
    if (writer !== null) await assertLinksToUnreadTables(view.model, row.connectionId, writer, db, table.id, values, before);
    await assertStaffColumns(reach, deps.meta, db, view.model, table.id, values, before, { connectionId: row.connectionId });
  };

  /**
   * A refused row's words, as the person who asked may read them: a role that
   * reads the table only in part is told a refusal as the data routes tell it
   * (no value of a column it may not read), and the database's own words
   * (which may quote a stored value) not at all.
   */
  const told = (error: unknown): string => {
    if (readView === null || !readView.readLimited) return error instanceof Error ? error.message : String(error);
    if (!(error instanceof AppError)) return 'the database refused the row';
    return (scrubRefusal(error, readView, readView.table(table.id)) as AppError).message;
  };
  /** A line something threw for: a hook's no, a hook that broke, or anything else as the database's. */
  const thrown = (error: unknown): LineVerdict => ({
    status: 'refused',
    code: error instanceof HookRejectedError ? 'REJECTED' : error instanceof HookFailedError ? 'HOOK_FAILED' : 'DB_ERROR',
    column: '',
    message: told(error),
  });

  type Found = { kind: 'reached'; row: Row } | { kind: 'unreached' } | { kind: 'none' } | { kind: 'failed'; error: unknown };

  /**
   * The stored rows these values name in a column: within the requester's
   * reach, or (the reach test left out) anywhere in the table.
   *
   * One value is asked for with `=`, as the job asks. Several are asked for
   * with one `IN` a batch, and a row that comes back is told to the value
   * that is its very text. A value no row was told to is NOT thereby absent:
   * the database may hold it equal to a row spelled another way (`ABC` and
   * `abc` in a column compared without case, `1.0` and `1`). An `IN` that
   * finds nothing says so for every value in it, since it compares as `=`
   * does; so the values left over are asked for again, in halves, until a
   * half finds nothing or is one value asked for with `=`. A file whose
   * lines are new, or here under their own spelling, costs one question a
   * batch; each value the database matches its own way costs a few more.
   */
  const among = async (column: string, values: readonly unknown[], within: boolean): Promise<(Row | undefined)[]> => {
    const one = async (value: unknown): Promise<Row | undefined> => {
      let query = db.selectFrom(table.id).selectAll().where((eb) => eb(db.dynamic.ref(column), '=', value));
      if (within && matchTest !== null) query = query.where(matchTest(db, table.name));
      return (await query.limit(1).executeTakeFirst()) as Row | undefined;
    };
    if (values.length === 1) return [await one(values[0])];
    const byKey = new Map<string, Row>();
    const asked = new Map<string, unknown>();
    for (const value of values) asked.set(keyOf(value), value);
    const settle = async (keys: readonly string[]): Promise<void> => {
      if (keys.length === 0) return;
      if (keys.length === 1) {
        const found = await one(asked.get(keys[0]!));
        if (found !== undefined) byKey.set(keys[0]!, found);
        return;
      }
      let query = db
        .selectFrom(table.id)
        .selectAll()
        .where(sql.ref(column), 'in', keys.map((key) => asked.get(key)) as never);
      if (within && matchTest !== null) query = query.where(matchTest(db, table.name));
      const rows = (await query.execute()) as Row[];
      if (rows.length === 0) return;
      const these = new Set(keys);
      for (const found of rows) {
        const key = keyOf(found[column]);
        if (these.has(key) && !byKey.has(key)) byKey.set(key, found);
      }
      const left = keys.filter((key) => !byKey.has(key));
      if (left.length < keys.length) {
        await settle(left);
        return;
      }
      // Rows matched, and none by its own text (a number the driver hands back written another way, say).
      // Where about as many rows matched as values were asked, each value is asked for alone…
      if (rows.length * 2 >= left.length) {
        for (const key of left) await settle([key]);
        return;
      }
      // …and where few did, which values they answer is found by asking for fewer at a time.
      const half = left.length >> 1;
      await settle(left.slice(0, half));
      await settle(left.slice(half));
    };
    const unique = [...asked.keys()];
    for (let at = 0; at < unique.length; at += LOOKUP_BATCH) await settle(unique.slice(at, at + LOOKUP_BATCH));
    return values.map((value) => byKey.get(keyOf(value)));
  };

  /** What each match value finds: a row the requester reaches, a row they do not, or nothing. */
  const find = async (column: string, values: readonly unknown[]): Promise<Found[]> => {
    if (values.length === 0) return [];
    const ask = async (asked: readonly unknown[]): Promise<Found[]> => {
      const reached = await among(column, asked, true);
      const out: Found[] = reached.map((found) => (found === undefined ? { kind: 'none' } : { kind: 'reached', row: found }));
      // Only somebody held to some rows can match a row outside them; for anybody else nothing found is nothing there.
      if (matchTest === null) return out;
      const missing = out.flatMap((found, index) => (found.kind === 'none' ? [index] : []));
      if (missing.length === 0) return out;
      const anywhere = await among(column, missing.map((index) => asked[index]), false);
      missing.forEach((index, n) => {
        if (anywhere[n] !== undefined) out[index] = { kind: 'unreached' };
      });
      return out;
    };
    try {
      return await ask(values);
    } catch (error) {
      if (values.length === 1) return [{ kind: 'failed', error }];
    }
    // A lookup the database refused for the batch: each value asked for alone, so one bad value costs one line.
    const out: Found[] = [];
    for (const value of values) {
      try {
        out.push((await ask([value]))[0]!);
      } catch (error) {
        out.push({ kind: 'failed', error });
      }
    }
    return out;
  };

  /**
   * A row as the table's rules left it, judged again for a requester who
   * reaches only some rows: null when nothing refuses it, or when the rules
   * wrote nothing the line did not bring.
   */
  const judgedAgain = async (values: Row, brought: Row, before: Row | null): Promise<LineVerdict | null> => {
    if (!held || !Object.keys(values).some((column) => !Object.prototype.hasOwnProperty.call(brought, column) || values[column] !== brought[column])) return null;
    try {
      await judge(values, before);
      return null;
    } catch (error) {
      return thrown(error);
    }
  };

  /** A line whose row is here: left alone, or judged as the update it would be. */
  const hereOf = async (item: ImportLine, before: Row, earlierLine: number | undefined, opts: JudgeOptions): Promise<LineVerdict> => {
    const earlier = earlierLine === undefined ? {} : { earlierLine };
    if (mode === 'skip') return { status: 'here', before, values: null, ...earlier };
    try {
      // The columns the role may change, and the rows it may change them in: a value sent back as it stands is no change.
      try {
        assertWithinLimit(updateLimit, table.id, item.values, before);
        if (changesRow(item.values, before)) assertMovedFrom(updateLimit, table.id, before, item.values);
      } catch (error) {
        if (!(error instanceof AppError) || error.code !== 'COLUMN_FORBIDDEN') throw error;
        const column = String((error.details as { column?: unknown } | undefined)?.column ?? '');
        return { status: 'refused', code: 'COLUMN_FORBIDDEN', column, message: error.message };
      }
      await judge(item.values, before);
      if (!opts.hooks && hooked.update) {
        // No hook runs for a preview: the row is filled and checked as a hook-less write would be.
        const checked = await writes.check('update', writeTarget, context, [item.values], { ...HISTORY, quote: true, stored: [before] });
        const values = checked.rows[0];
        if (values === null || values === undefined) return refusedBy(checked.issues[0] ?? null);
        return (await judgedAgain(values, item.values, before)) ?? { status: 'here', before, values, ...earlier };
      }
      // Prepared against the row as it is: a formula over it (a line's
      // amount, when only its qty is in the file) reads the stored inputs.
      const [prepared] = await writes.beforeEach('update', writeTarget, context, [{ values: item.values, record: before }], opts.hooks ? HISTORY : { ...HISTORY, quote: true });
      if (prepared === undefined || prepared.issues !== null) return refusedBy(prepared?.issues ?? null);
      return (await judgedAgain(prepared.values, item.values, before)) ?? { status: 'here', before, values: prepared.values, ...earlier };
    } catch (error) {
      return thrown(error);
    }
  };

  /**
   * The lines, among `indexes`, whose key is already a row's: looked for
   * anywhere in the table, the requester's reach left out (a key that is
   * taken is taken whoever's the row is). A lookup the database refuses says
   * nothing: the line goes on, and the insert says what is wrong with it.
   */
  const taken = async (items: readonly ImportLine[], indexes: readonly number[]): Promise<Set<number>> => {
    const out = new Set<number>();
    if (keyColumn === null) return out;
    const keyed = indexes.filter((index) => items[index]!.values[keyColumn] !== undefined && items[index]!.values[keyColumn] !== null);
    if (keyed.length === 0) return out;
    let stored: (Row | undefined)[];
    try {
      stored = await among(keyColumn, keyed.map((index) => items[index]!.values[keyColumn]), false);
    } catch {
      stored = [];
      for (const index of keyed) stored.push(await among(keyColumn, [items[index]!.values[keyColumn]], false).then((found) => found[0], () => undefined));
    }
    keyed.forEach((index, n) => {
      if (stored[n] !== undefined) out.add(index);
    });
    return out;
  };
  const keyTaken = (): LineVerdict => ({ status: 'refused', code: 'ALREADY_EXISTS', column: keyColumn ?? '', message: ALREADY_EXISTS_MESSAGE });

  const lines = async (items: readonly ImportLine[], opts: JudgeOptions): Promise<LineVerdict[]> => {
    const out: (LineVerdict | undefined)[] = items.map(() => undefined);
    const found: (Found | undefined)[] = items.map(() => undefined);
    if (match !== null) {
      const asked: number[] = [];
      for (const [index, item] of items.entries()) {
        const value = item.values[match.name];
        if (value === undefined || value === null) {
          // An unmapped/empty match cell must never reach the driver: `= NULL`
          // matches nothing (silent duplicate insert) or throws per driver.
          out[index] = { status: 'refused', code: 'BAD_MATCH', column: match.name, message: `the ${mode === 'upsert' ? 'upsert match' : 'match'} column ${match.name} has no value` };
        } else asked.push(index);
      }
      // Every line is asked of the database first: a row that is stored is the row a line matches, whatever an earlier line of the file was.
      const answers = await find(match.name, asked.map((index) => items[index]!.values[match.name]));
      asked.forEach((index, n) => (found[index] = answers[n]));
    }
    /** Whether an earlier line of this file (a preview's memory) would have made the row this line matches. */
    const madeEarlier = (index: number): boolean => match !== null && found[index]?.kind === 'none' && opts.earlier?.has(matchKey(items[index]!.values[match.name])) === true;

    // The lines that would be new rows, and of those the ones whose key is taken.
    const fresh: number[] = [];
    for (const index of items.keys()) {
      if (out[index] !== undefined || madeEarlier(index)) continue;
      const at = found[index];
      if (at === undefined || at.kind === 'none') fresh.push(index);
    }
    const clash = await taken(items, fresh);

    // A new row: what it names, before anything is copied from a row it links to.
    const unchecked: number[] = [];
    for (const [index, item] of items.entries()) {
      if (out[index] !== undefined) continue;
      if (madeEarlier(index)) continue; // an earlier line of this file made its row: judged below
      const at = found[index];
      if (at?.kind === 'failed') out[index] = thrown(at.error);
      else if (at?.kind === 'unreached') out[index] = { status: 'refused', code: 'ALREADY_EXISTS', column: match?.name ?? '', message: ALREADY_EXISTS_MESSAGE };
      else if (at?.kind === 'reached') out[index] = await hereOf(item, at.row, undefined, opts);
      else if (clash.has(index)) out[index] = keyTaken();
      else {
        try {
          await judge(item.values, null);
          if (opts.hooks && hooked.create) {
            const [prepared] = await writes.beforeEach('create', writeTarget, context, [{ values: item.values }], HISTORY);
            out[index] = prepared === undefined || prepared.issues !== null ? refusedBy(prepared?.issues ?? null) : ((await judgedAgain(prepared.values, item.values, null)) ?? { status: 'new', values: prepared.values });
          } else unchecked.push(index);
        } catch (error) {
          out[index] = thrown(error);
        }
      }
    }
    /*
     * THE RULES, FOR ROWS NO HOOK STEP FILLS AND CHECKS.
     *
     * No hook wants these writes, so `beforeEach` never runs for them. A rule
     * placed inside the hook step would therefore never fire for a hook-less
     * import — which is most imports. `check()` is the fill and the check
     * without the hooks, and the branded rows it returns are the only thing
     * `insertRows` accepts.
     */
    const check = async (indexes: readonly number[]): Promise<void> => {
      const checked = await writes.check('create', writeTarget, context, indexes.map((index) => items[index]!.values), opts.hooks ? HISTORY : { ...HISTORY, quote: true });
      for (const [n, index] of indexes.entries()) {
        const values = checked.rows[n];
        out[index] = values === null || values === undefined ? refusedBy(checked.issues[n] ?? null) : { status: 'new', values };
        // What a rule wrote into the row (a stamp that copies a column into the one saying whose the row is) is judged as what the line brought was.
        if (values !== null && values !== undefined) out[index] = (await judgedAgain(values, items[index]!.values, null)) ?? out[index];
      }
    };
    if (fast) {
      if (unchecked.length > 0) await check(unchecked);
    } else {
      // Rows written one at a time are checked one at a time: what stops one stops only that one.
      for (const index of unchecked) {
        try {
          await check([index]);
        } catch (error) {
          out[index] = thrown(error);
        }
      }
    }

    /*
     * WHAT THE EARLIER LINES OF THE FILE WOULD HAVE MADE (a preview's memory;
     * the job reads the database, where those rows are by then). In the
     * file's order, for the lines no stored row answered:
     *
     *  - a line whose match value an earlier new line had is here, judged
     *    against that line as it was typed;
     *  - a line that would be new, with the key of an earlier new line, is
     *    refused as the database would refuse the second of them.
     */
    if (opts.earlier !== undefined || opts.earlierKeys !== undefined) {
      for (const [index, item] of items.entries()) {
        const value = match === null ? null : item.values[match.name];
        if (match !== null && opts.earlier !== undefined && value !== undefined && value !== null && found[index]?.kind === 'none') {
          const first = opts.earlier.get(matchKey(value));
          if (first !== undefined) {
            out[index] = await hereOf(item, first.values, first.line, opts);
            continue;
          }
        }
        if (out[index]?.status !== 'new') continue;
        const key = keyColumn === null ? null : item.values[keyColumn];
        if (opts.earlierKeys !== undefined && key !== undefined && key !== null) {
          if (opts.earlierKeys.has(keyKey(key))) {
            out[index] = keyTaken();
            continue;
          }
          opts.earlierKeys.set(keyKey(key), item.rowNumber);
        }
        if (match !== null && opts.earlier !== undefined && value !== undefined && value !== null) opts.earlier.set(matchKey(value), { line: item.rowNumber, values: (out[index] as { values: Row }).values });
      }
    }
    return out.map((verdict, index) => verdict ?? thrown(new Error(`row ${items[index]!.rowNumber} was not judged`)));
  };

  const fast = mode === 'insert' && !hooked.create && !held;

  return {
    view,
    table,
    db,
    dialect,
    writes,
    writeTarget,
    context,
    hooked,
    mode,
    match,
    reach,
    held,
    updateTest,
    fast,
    told,
    mapping: (header) => resolveMapping(header, row.mapping, view, table),
    parse(mapped, record, rowNumber) {
      const values: Record<string, unknown> = {};
      const issues: CellIssue[] = [];
      for (const target of mapped) {
        const raw = record[target.index] ?? '';
        if (raw.trim() === '' && !target.column.nullable && filledByRule.has(target.column.name)) continue;
        // An empty cell under a column with a default says nothing: a new row takes the default (a blank "may be e-mailed" is no), a row already there keeps its value.
        if (raw.trim() === '' && defaulted.has(target.column.name)) continue;
        const result = coerceCell(raw, target.column);
        if (!result.ok) {
          issues.push({ row: rowNumber, column: target.column.name, code: result.code, message: result.message, raw });
          continue;
        }
        values[target.column.name] = bindValue(dialect, result.value);
      }
      // Each cell as its column keeps it (a customer number upper case, without spaces or dashes): what a line
      // is matched on, and told apart from an earlier line by, is the value its row would hold.
      return issues.length > 0 ? { line: null, issues } : { line: { rowNumber, values: normalizeText(rules, values), raw: [...record] }, issues: null };
    },
    lines,
  };
}

/**
 * The columns of a table that have a default: the database's own, or a fill
 * Adminium writes (a literal, the moment, a value read from elsewhere). An
 * empty cell of a brought file under one is left out of its line rather than
 * refused as "required" or stored empty.
 */
export function defaultedColumns(view: SnapshotView, table: ResolvedTable): Set<string> {
  const rules = tableRulesFor({ view, table });
  return new Set([
    ...(rules?.fills ?? []).filter((fill) => fill.kind !== 'none').map((fill) => fill.column),
    ...table.table.columns.filter((column) => column.default !== null && column.default !== undefined && !column.isGenerated).map((column) => column.name),
  ]);
}
