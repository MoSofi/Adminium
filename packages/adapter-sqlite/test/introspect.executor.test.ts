// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `introspectSqlite` driven through a WRAPPED executor — the paths that a
 * healthy database cannot reach on its own (05-introspection-engine.md §4.3):
 *
 *   - the total time budget, including the two catalog queries whose failures
 *     are otherwise swallowed (`pragma_table_list`, `sqlite_stat1`) — a
 *     TIMEOUT there must NOT be mistaken for "this SQLite is old" / "no
 *     ANALYZE yet"
 *   - the SQLite < 3.37 fallback, where `pragma_table_list` does not exist and
 *     WITHOUT ROWID / STRICT are derived from the DDL instead
 *   - the row-count decision table: exact counts below the 100 MB threshold,
 *     `sqlite_stat1` estimates above it, and no counts at all when the file
 *     size is unknown
 *   - the SCHEMA-ONLY invariant (05 §10) over every statement actually issued
 *
 * The rows are real — a better-sqlite3 in-memory database answers every query
 * — so only the failure/size conditions are synthetic. Time is controlled with
 * fake timers rather than the wall clock, so the budget assertions are exact.
 */
import type BetterSqlite3 from 'better-sqlite3';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AdapterError } from '@adminium/engine/adapter';

import {
  introspectSqlite,
  EXACT_COUNT_MAX_FILE_BYTES,
  MASTER_SQL,
  INDEX_COLUMNS_SQL,
  TABLE_LIST_SQL,
  type CatalogExecutor,
  type CatalogRow,
  type IntrospectContext,
} from '../src/introspect.js';

import { sqliteDriverAvailable } from './harness.js';

const driverReady = await sqliteDriverAvailable();

const FIXTURE_SQL = `
  CREATE TABLE rowid_pk (id INTEGER PRIMARY KEY, label TEXT);
  CREATE TABLE no_rowid (id INTEGER PRIMARY KEY, label TEXT) WITHOUT ROWID;
  INSERT INTO rowid_pk (label) VALUES ('a'), ('b'), ('c');
  INSERT INTO no_rowid VALUES (1, 'x'), (2, 'y');
`;

const SMALL_FILE: IntrospectContext = {
  connectionId: 'c1',
  databaseName: 'fixture',
  fileSizeBytes: 4096,
};
const BIG_FILE: IntrospectContext = {
  ...SMALL_FILE,
  fileSizeBytes: EXACT_COUNT_MAX_FILE_BYTES + 1,
};
const UNKNOWN_SIZE: IntrospectContext = { ...SMALL_FILE, fileSizeBytes: null };

type RecordingExecutor = CatalogExecutor & { calls: string[] };

/** Run every statement against `db`, recording it; `hooks` inject conditions. */
function execOver(
  db: BetterSqlite3.Database,
  hooks: { failOn?: (sql: string) => Error | null; after?: (sql: string) => void } = {},
): RecordingExecutor {
  const calls: string[] = [];
  const exec = async (sql: string): Promise<CatalogRow[]> => {
    calls.push(sql);
    const failure = hooks.failOn?.(sql) ?? null;
    if (failure !== null) throw failure;
    const rows = db.prepare(sql).all() as CatalogRow[];
    hooks.after?.(sql);
    return rows;
  };
  return Object.assign(exec, { calls });
}

const countStatements = (calls: readonly string[]): string[] =>
  calls.filter((sql) => sql.includes('count(*)'));

describe.skipIf(!driverReady)('introspectSqlite through a wrapped executor', () => {
  let plain: BetterSqlite3.Database;
  let analyzed: BetterSqlite3.Database;

  beforeAll(async () => {
    const { default: Database } = await import('better-sqlite3');
    plain = new Database(':memory:');
    plain.exec(FIXTURE_SQL);
    analyzed = new Database(':memory:');
    analyzed.exec(`${FIXTURE_SQL}\nANALYZE;`);
  });

  afterAll(() => {
    plain?.close();
    analyzed?.close();
  });

  describe('the total time budget', () => {
    beforeEach(() => {
      vi.useFakeTimers({ now: 1_700_000_000_000 });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    /** Burn the whole budget once `trigger` has been answered. */
    const overrunAfter = (db: BetterSqlite3.Database, trigger: string): RecordingExecutor =>
      execOver(db, {
        after: (sql) => {
          if (sql === trigger) vi.setSystemTime(Date.now() + 60_000);
        },
      });

    it('stops at the next statement and reports the budget it blew', async () => {
      const exec = overrunAfter(plain, MASTER_SQL);
      const failure = await introspectSqlite(exec, SMALL_FILE, { timeoutMs: 30_000 }).catch(
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(AdapterError);
      expect(failure).toMatchObject({ code: 'TIMEOUT', detail: 'timeoutMs=30000' });
      // It stopped rather than finishing the sweep: only the first statement ran.
      expect(exec.calls).toEqual([MASTER_SQL]);
    });

    it('a timeout on pragma_table_list is NOT downgraded to "SQLite < 3.37"', async () => {
      // The table_list failure path has a legitimate silent fallback; a TIMEOUT
      // must escape it instead of producing a half-built model.
      const exec = overrunAfter(plain, MASTER_SQL);
      await expect(
        introspectSqlite(exec, SMALL_FILE, { timeoutMs: 1_000 }),
      ).rejects.toMatchObject({ code: 'TIMEOUT' });
      expect(exec.calls).toContain(MASTER_SQL);
      expect(exec.calls).not.toContain(TABLE_LIST_SQL); // it threw before running
    });

    it('a timeout on sqlite_stat1 is NOT downgraded to "no ANALYZE yet"', async () => {
      const exec = overrunAfter(plain, INDEX_COLUMNS_SQL);
      await expect(
        introspectSqlite(exec, SMALL_FILE, { timeoutMs: 30_000 }),
      ).rejects.toMatchObject({ code: 'TIMEOUT' });
      // Six catalog statements ran; the exact-count sweep never started.
      expect(exec.calls).toHaveLength(6);
      expect(countStatements(exec.calls)).toEqual([]);
    });

    it('completes within a generous budget and reports its own duration', async () => {
      const exec = execOver(plain);
      const model = await introspectSqlite(exec, SMALL_FILE, { timeoutMs: 30_000 });
      expect(model.stats.durationMs).toBe(0); // the clock never moved
      expect(model.tables.map((t) => t.name)).toEqual(['no_rowid', 'rowid_pk']);
    });
  });

  describe('the SQLite < 3.37 fallback (no pragma_table_list)', () => {
    const noTableList = (db: BetterSqlite3.Database): RecordingExecutor =>
      execOver(db, {
        failOn: (sql) =>
          sql === TABLE_LIST_SQL ? new Error('no such table: pragma_table_list') : null,
      });

    it('derives WITHOUT ROWID from the DDL and says the pragma was missing', async () => {
      const model = await introspectSqlite(noTableList(plain), SMALL_FILE);
      expect(model.warnings.map((w) => w.code)).toContain('table-list-unavailable');

      // The flag is load-bearing: a rowid table's INTEGER PRIMARY KEY is
      // auto-assigned, a WITHOUT ROWID table's is not.
      const rowidPk = model.tables.find((t) => t.name === 'rowid_pk');
      const noRowid = model.tables.find((t) => t.name === 'no_rowid');
      expect(rowidPk?.columns.find((c) => c.name === 'id')?.default).toEqual({
        kind: 'autoincrement',
      });
      expect(noRowid?.columns.find((c) => c.name === 'id')?.default).toBeNull();
    });

    it('agrees with the pragma on every other part of the model', async () => {
      const withPragma = await introspectSqlite(execOver(plain), SMALL_FILE);
      const withoutPragma = await introspectSqlite(noTableList(plain), SMALL_FILE);
      expect(withoutPragma.tables).toEqual(withPragma.tables);
      expect(withoutPragma.warnings).toHaveLength(withPragma.warnings.length + 1);
    });
  });

  describe('the row-count decision table (§4.3)', () => {
    it('counts exactly below the 100 MB threshold', async () => {
      const exec = execOver(plain);
      const model = await introspectSqlite(exec, SMALL_FILE);
      expect(model.tables.find((t) => t.name === 'rowid_pk')).toMatchObject({
        rowCountEstimate: 3,
        rowCountExact: true,
      });
      expect(countStatements(exec.calls)).toHaveLength(1); // one UNION ALL sweep
    });

    it('above the threshold with no ANALYZE: no counts, and it says why', async () => {
      const exec = execOver(plain);
      const model = await introspectSqlite(exec, BIG_FILE);
      expect(model.tables.every((t) => t.rowCountEstimate === null)).toBe(true);
      expect(model.warnings.find((w) => w.code === 'counts-unavailable')?.message).toContain(
        'ANALYZE',
      );
      expect(countStatements(exec.calls)).toEqual([]);
    });

    it('above the threshold WITH ANALYZE: stat1 estimates, and no warning', async () => {
      const exec = execOver(analyzed);
      const model = await introspectSqlite(exec, BIG_FILE);
      expect(model.tables.find((t) => t.name === 'rowid_pk')).toMatchObject({
        rowCountEstimate: 3,
        rowCountExact: false, // an estimate is never reported as exact
      });
      expect(model.tables.find((t) => t.name === 'no_rowid')?.rowCountEstimate).toBe(2);
      expect(model.warnings.map((w) => w.code)).not.toContain('counts-unavailable');
      expect(countStatements(exec.calls)).toEqual([]);
    });

    it('an unknown file size counts nothing and warns about nothing', async () => {
      const exec = execOver(plain);
      const model = await introspectSqlite(exec, UNKNOWN_SIZE);
      expect(model.tables.every((t) => t.rowCountEstimate === null)).toBe(true);
      expect(model.warnings).toEqual([]);
      expect(countStatements(exec.calls)).toEqual([]);
    });

    it('collectRowEstimates: false skips the decision entirely', async () => {
      const exec = execOver(analyzed);
      const model = await introspectSqlite(exec, SMALL_FILE, { collectRowEstimates: false });
      expect(model.tables.every((t) => t.rowCountEstimate === null)).toBe(true);
      expect(countStatements(exec.calls)).toEqual([]);
    });
  });

  it('issues SCHEMA-ONLY statements — catalog reads plus bare COUNT(*) (05 §10)', async () => {
    const exec = execOver(plain);
    await introspectSqlite(exec, SMALL_FILE);
    expect(exec.calls.length).toBeGreaterThan(0);
    for (const statement of exec.calls.flatMap((sql) => sql.split('UNION ALL'))) {
      const readsCatalog = /sqlite_master|pragma_[a-z_]+|sqlite_stat1/.test(statement);
      // The one documented exception: `COUNT(*)` over a user table, which
      // names no column and returns no cell value.
      const isBareCount = /^\s*SELECT '[^']*' AS table_name, count\(\*\) AS n FROM "[^"]+"\s*$/.test(
        statement,
      );
      expect(readsCatalog || isBareCount).toBe(true);
      expect(statement).not.toMatch(/SELECT\s+\*/);
    }
  });
});
