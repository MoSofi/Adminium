/**
 * Upgrade path from the RELEASED build (M15: "no test opens a meta store from
 * an older released build"). The fixture is an untouched sqlite meta store
 * produced by the published `@adminiumjs/adminium@0.1.0` CLI (`adminium
 * migrate` on a clean directory — migrations 0001–0010).
 *
 * Like migration-checksums.test.ts, and for the same reason, the migrator runs
 * in a CHILD PROCESS — plain node importing the built @adminium/meta dist. The
 * ledger checksum hashes the loading runtime's emitted function text, so
 * running `applyMigrations` in-process under vitest would re-hash every
 * migration differently and report drift that no real install ever sees (and
 * would keep passing if the real, shipped value drifted). `applyMigrations`
 * re-hashes applied migrations on every call and throws
 * MigrationChecksumDriftError on mismatch, so plain-node success against the
 * released ledger IS the no-drift proof.
 *
 * Regenerate the fixture only when the released baseline moves:
 *   ADMINIUM_SECRET=a-sufficiently-long-test-secret \
 *   ADMINIUM_META_URL=sqlite:$PWD/meta.db ADMINIUM_DATA_DIR=$PWD \
 *   npx -y @adminiumjs/adminium@<released> migrate
 */

import { execFileSync } from 'node:child_process';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const FIXTURE = fileURLToPath(new URL('./fixtures/meta-0.1.0-sqlite.db', import.meta.url));

/** The 0.1.0 ledger's final migration; anything after it was added post-release. */
const RELEASED_TAIL = '0010_llm_prompt_version_width';

interface ChildReport {
  status: { name: string; applied: boolean; drift: boolean; known: boolean }[];
  firstApplied: string[];
  secondApplied: string[];
}

/** Open the store and migrate the way PRODUCTION does: plain node on dist. */
function migrateOnDist(dbPath: string): ChildReport {
  const require = createRequire(import.meta.url);
  const metaEntry = require.resolve('@adminium/meta');
  const kyselyEntry = require.resolve('kysely');
  const sqliteEntry = require.resolve('better-sqlite3');
  const script = `
    const { Kysely, SqliteDialect } = await import(${JSON.stringify(kyselyEntry)});
    const BetterSqlite3 = (await import(${JSON.stringify(sqliteEntry)})).default;
    const meta = await import(${JSON.stringify(metaEntry)});
    const db = new Kysely({
      dialect: new SqliteDialect({ database: new BetterSqlite3(${JSON.stringify(dbPath)}) }),
    });
    const status = await meta.migrationStatus(db, { dialect: 'sqlite' });
    const first = await meta.applyMigrations(db, { dialect: 'sqlite' });
    const second = await meta.applyMigrations(db, { dialect: 'sqlite' });
    await db.destroy();
    process.stdout.write(JSON.stringify({
      status: status.map(({ name, applied, drift, known }) => ({ name, applied, drift, known })),
      firstApplied: first.applied,
      secondApplied: second.applied,
    }));
  `;
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    cwd: dirname(metaEntry),
  });
  return JSON.parse(stdout) as ChildReport;
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'adminium-upgrade-'));
  await copyFile(FIXTURE, join(dir, 'meta.db'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('meta store upgrade from released 0.1.0', () => {
  it('opens, verifies, and migrates the released store; idempotent', () => {
    const report = migrateOnDist(join(dir, 'meta.db'));

    // The released ledger reads clean under the production runtime: all ten
    // rows applied, none drifted, none unknown to this version.
    const released = report.status.filter((entry) => entry.name <= RELEASED_TAIL);
    expect(released.map((entry) => entry.name)).toContain('0001_core_auth');
    expect(released).toHaveLength(10);
    for (const entry of released) {
      expect(entry, `${entry.name} should be applied/clean in the 0.1.0 ledger`).toMatchObject({
        applied: true,
        drift: false,
        known: true,
      });
    }

    // Only migrations added AFTER the release may apply on top — the released
    // set must never re-run. (Today that list is empty; when 0011 lands this
    // clause starts asserting the real upgrade.)
    for (const name of report.firstApplied) {
      expect(name > RELEASED_TAIL, `${name} shipped in 0.1.0 and must not re-apply`).toBe(true);
    }
    expect(report.secondApplied).toEqual([]);
  });
});
