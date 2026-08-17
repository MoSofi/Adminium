// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Test harness for the Postgres adapter suites.
 *
 * Everything is probe-gated (the standing rule: CI without a local Postgres
 * stays green until service containers land). Two independent probes:
 *
 * - `psqlAvailable` — a `psql` client can reach 127.0.0.1:5432. Enables the
 *   psql-executor suites, which exercise the full introspection pipeline
 *   WITHOUT the `pg` driver by wrapping every catalog query in `json_agg`.
 * - `pgDriverAvailable` — the `pg` package is importable (it is a declared
 *   dependency, but suites must not explode before `pnpm install` ran).
 *
 * Test databases are named `adminium_test_adapter_<rand>` and always
 * dropped in afterAll.
 */
import { execFile, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import type { CatalogExecutor } from '../src/introspect.js';

const run = promisify(execFile);

export const PG_HOST = process.env['ADMINIUM_TEST_PG_HOST'] ?? '127.0.0.1';
export const PG_PORT = process.env['ADMINIUM_TEST_PG_PORT'] ?? '5432';
export const MAINTENANCE_DB = 'postgres';

export const NORTHWIND_SQL_PATH = fileURLToPath(
  new URL('../fixtures/northwind.sql', import.meta.url),
);
export const ENGINE_FIXTURE_PATH = fileURLToPath(
  new URL('../../engine/test/fixtures/northwind.model.json', import.meta.url),
);

function findPsql(): string | null {
  const candidates = [
    process.env['ADMINIUM_TEST_PSQL'],
    'psql',
    '/opt/homebrew/opt/postgresql@16/bin/psql',
    '/usr/lib/postgresql/16/bin/psql',
  ];
  for (const candidate of candidates) {
    if (candidate === undefined) continue;
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore' });
      return candidate;
    } catch {
      // keep looking
    }
  }
  return null;
}

export const PSQL = findPsql();

function probePsql(): boolean {
  if (PSQL === null) return false;
  try {
    execFileSync(
      PSQL,
      ['-h', PG_HOST, '-p', PG_PORT, '-X', '-d', MAINTENANCE_DB, '-tAc', 'SELECT 1'],
      { stdio: 'ignore', timeout: 5_000 },
    );
    return true;
  } catch {
    return false;
  }
}

/** True when a local Postgres is reachable through psql. */
export const psqlAvailable = probePsql();

/** True when the pg driver package resolves (post-install). */
export async function pgDriverAvailable(): Promise<boolean> {
  try {
    await import('pg');
    return true;
  } catch {
    return false;
  }
}

export interface PsqlOptions {
  db?: string;
  user?: string;
}

/** Run a statement through psql (`-tA`, ON_ERROR_STOP) and return stdout. */
export async function psql(sql: string, opts: PsqlOptions = {}): Promise<string> {
  if (PSQL === null) throw new Error('psql binary not found');
  const args = ['-h', PG_HOST, '-p', PG_PORT, '-X', '-v', 'ON_ERROR_STOP=1', '-tA'];
  if (opts.user !== undefined) args.push('-U', opts.user);
  args.push('-d', opts.db ?? MAINTENANCE_DB, '-c', sql);
  const { stdout } = await run(PSQL, args, { maxBuffer: 64 * 1024 * 1024 });
  return stdout.trim();
}

export async function psqlFile(path: string, db: string): Promise<void> {
  if (PSQL === null) throw new Error('psql binary not found');
  await run(
    PSQL,
    ['-h', PG_HOST, '-p', PG_PORT, '-X', '-v', 'ON_ERROR_STOP=1', '-q', '-d', db, '-f', path],
    { maxBuffer: 64 * 1024 * 1024 },
  );
}

export function testDatabaseName(): string {
  return `adminium_test_adapter_${randomBytes(4).toString('hex')}`;
}

export async function createTestDatabase(loadNorthwind: boolean): Promise<string> {
  const db = testDatabaseName();
  await psql(`CREATE DATABASE ${db}`);
  if (loadNorthwind) await psqlFile(NORTHWIND_SQL_PATH, db);
  return db;
}

export async function dropTestDatabase(db: string): Promise<void> {
  await psql(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
}

/**
 * A `CatalogExecutor` backed by psql: wraps each catalog query in
 * `json_agg` so rows come back as JSON. Counts statements so budget tests
 * (≤ 12 statements — 05 §10) can assert on `count`.
 */
export function psqlExecutor(db: string, user?: string): CatalogExecutor & { count(): number } {
  let statements = 0;
  const executor = async (sql: string): Promise<Record<string, unknown>[]> => {
    statements += 1;
    const wrapped = `SELECT COALESCE(json_agg(t), '[]'::json) FROM (${sql}\n) t`;
    const options: PsqlOptions = user === undefined ? { db } : { db, user };
    const output = await psql(wrapped, options);
    return JSON.parse(output) as Record<string, unknown>[];
  };
  return Object.assign(executor, { count: () => statements });
}

export function dsnFor(db: string, user?: string): string {
  const auth = user === undefined ? '' : `${user}@`;
  return `postgres://${auth}${PG_HOST}:${PG_PORT}/${db}`;
}

// ---------------------------------------------------------------------------
// Model normalization for fixture comparison
// ---------------------------------------------------------------------------

interface AnyRecord {
  [key: string]: unknown;
}

const byString = (key: string) => (a: AnyRecord, b: AnyRecord) => {
  const ka = String(a[key] ?? '');
  const kb = String(b[key] ?? '');
  return ka < kb ? -1 : ka > kb ? 1 : 0;
};

/**
 * Scrub the volatile fields (the same set the canonical snapshot hash strips
 * — 05 §9: introspectedAt/stats.durationMs/warnings/rowCountEstimate/
 * activity/sizeBytes) plus the run-specific identity fields, and order every
 * array deterministically. Applied to BOTH the live model and the shared
 * engine fixture before deep-equality.
 */
export function normalizeModel(model: unknown): AnyRecord {
  const clone = structuredClone(model) as AnyRecord;
  clone['name'] = 'northwind';
  clone['source'] = { kind: 'live', connectionId: 'normalized' };
  clone['introspectedAt'] = 'normalized';
  clone['warnings'] = [];
  const stats = clone['stats'] as AnyRecord;
  stats['durationMs'] = 0;

  const tables = clone['tables'] as AnyRecord[];
  tables.sort(byString('id'));
  for (const table of tables) {
    table['rowCountEstimate'] = null;
    table['rowCountExact'] = false;
    table['sizeBytes'] = null;
    table['activity'] = null;
    (table['columns'] as AnyRecord[]).sort((a, b) => Number(a['ordinal']) - Number(b['ordinal']));
    (table['indexes'] as AnyRecord[]).sort(byString('name'));
    (table['uniques'] as AnyRecord[]).sort(byString('name'));
    (table['checks'] as AnyRecord[]).sort(byString('name'));
  }
  (clone['relations'] as AnyRecord[]).sort(byString('id'));
  (clone['enums'] as AnyRecord[]).sort(byString('id'));
  return clone;
}

export function loadEngineFixture(): AnyRecord {
  return JSON.parse(readFileSync(ENGINE_FIXTURE_PATH, 'utf8')) as AnyRecord;
}
