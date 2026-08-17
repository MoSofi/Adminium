// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Test harness for the SQLite adapter suites.
 *
 * SQLite needs no server — the only gate is the better-sqlite3 native
 * driver being importable (post-install, binding built). Databases are
 * temp files named `adminium_test_adapter_<rand>.db` in a per-run temp
 * directory, always removed in afterAll.
 */
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const NORTHWIND_SQL_PATH = fileURLToPath(
  new URL('../fixtures/northwind.sqlite.sql', import.meta.url),
);

/** True when the better-sqlite3 driver resolves AND its binding loads. */
export async function sqliteDriverAvailable(): Promise<boolean> {
  try {
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(':memory:');
    db.close();
    return true;
  } catch {
    return false;
  }
}

/** Per-run temp directory for database files. */
export function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'adminium-sqlite-'));
}

export function removeTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

export function testDatabasePath(dir: string): string {
  return join(dir, `adminium_test_adapter_${randomBytes(4).toString('hex')}.db`);
}

/** Create a database file, optionally loading the northwind fixture. */
export async function createTestDatabase(
  dir: string,
  loadNorthwind: boolean,
  extraSql?: string,
): Promise<string> {
  const { default: Database } = await import('better-sqlite3');
  const file = testDatabasePath(dir);
  const db = new Database(file);
  try {
    if (loadNorthwind) db.exec(readFileSync(NORTHWIND_SQL_PATH, 'utf8'));
    if (extraSql !== undefined) db.exec(extraSql);
  } finally {
    db.close();
  }
  return file;
}
