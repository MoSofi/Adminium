// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Regression guard for the CI mysql-leg failure (ER_NO_DB_ERROR ×102): the
 * dialect harness used to pool straight to TEST_MYSQL_URL, and CI's DSN is
 * server-level with no database path (`mysql://root:root@127.0.0.1:3306`,
 * ci.yml) — so no schema was ever selected and the first migration statement
 * died. The harness now provisions a per-test database and connects with it
 * selected (test/helpers/db.ts). These tests pin the URL/naming plumbing that
 * runs on every pg/mysql `make()`, without needing a live server.
 */
import { describe, expect, it } from 'vitest';

import {
  TEST_DIALECTS,
  listTables,
  postgresAdminUrl,
  resetMetaDb,
  testDatabaseName,
  urlWithDatabase,
} from './helpers/db.js';

import { firstRun, rolesRepo, settingsRepo } from '../src/index.js';

describe('dialect harness database provisioning', () => {
  it('appends a database to CI’s bare mysql DSN (the ER_NO_DB_ERROR case)', () => {
    expect(urlWithDatabase('mysql://root:root@127.0.0.1:3306', 'adminium_test_meta_ab12cd34')).toBe(
      'mysql://root:root@127.0.0.1:3306/adminium_test_meta_ab12cd34',
    );
  });

  it('appends a database to a bare postgres DSN symmetrically', () => {
    expect(urlWithDatabase('postgres://root:root@127.0.0.1:5432', 'adminium_test_meta_ab12cd34')).toBe(
      'postgres://root:root@127.0.0.1:5432/adminium_test_meta_ab12cd34',
    );
  });

  it('replaces an existing database path instead of nesting under it', () => {
    expect(urlWithDatabase('mysql://u:p@db.internal:3306/prexisting', 'adminium_test_meta_1')).toBe(
      'mysql://u:p@db.internal:3306/adminium_test_meta_1',
    );
  });

  it('preserves credentials, port, and query parameters', () => {
    expect(
      urlWithDatabase('postgres://user:secret@10.0.0.9:5433/old?sslmode=disable', 'fresh_db'),
    ).toBe('postgres://user:secret@10.0.0.9:5433/fresh_db?sslmode=disable');
  });

  it('admin-connects a bare postgres DSN to the postgres maintenance database', () => {
    // node-postgres would otherwise default the database to the connecting
    // user's name, which typically does not exist ("database ava/root does
    // not exist"); mysql needs no such fallback.
    expect(postgresAdminUrl('postgres://root:root@127.0.0.1:5432')).toBe(
      'postgres://root:root@127.0.0.1:5432/postgres',
    );
    expect(postgresAdminUrl('postgres://u:p@db.internal:5432/existing?sslmode=disable')).toBe(
      'postgres://u:p@db.internal:5432/existing?sslmode=disable',
    );
  });

  it('generates unique, plainly-quotable database names with the meta prefix', () => {
    const names = new Set(Array.from({ length: 64 }, () => testDatabaseName()));
    expect(names.size).toBe(64);
    for (const name of names) {
      expect(name).toMatch(/^adminium_test_meta_[0-9a-f]{8}$/);
    }
  });

  it('gates the pg/mysql legs on their TEST_*_URL env vars', () => {
    const byName = new Map(TEST_DIALECTS.map((d) => [d.name, d]));
    expect(byName.get('sqlite')?.available).toBe(true);
    expect(byName.get('postgres')?.available).toBe(Boolean(process.env.TEST_POSTGRES_URL));
    expect(byName.get('mysql')?.available).toBe(Boolean(process.env.TEST_MYSQL_URL));
  });
});

/**
 * The reset is what lets a suite provision ONE database per file instead of
 * one per test, so it has to leave exactly the state a fresh `firstRun` does:
 * no rows the last test wrote, the schema untouched, and the ledger intact —
 * an emptied ledger would re-run every migration and give back the cost the
 * whole arrangement exists to avoid.
 */
for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`resetMetaDb [${dialect.name}]`, () => {
    it('empties what a test wrote, keeps the schema, and leaves the ledger alone', async () => {
      const t = await dialect.make();
      try {
        await firstRun(t.meta);
        const schema = await listTables(t.meta);
        const seededRoles = (await rolesRepo(t.meta).list()).length;
        expect(seededRoles).toBeGreaterThan(0);

        await settingsRepo(t.meta).set('branding.appName', 'written by a test', { at: 1000 });
        expect(await settingsRepo(t.meta).get('branding.appName')).toBe('written by a test');

        await resetMetaDb(t.meta);

        // The write is gone and the seeded rows went with it — `firstRun` is
        // what puts them back, which is exactly what the per-file harness
        // re-runs after every reset.
        expect(await settingsRepo(t.meta).get('branding.appName')).not.toBe('written by a test');
        expect((await rolesRepo(t.meta).list()).length).toBe(0);

        // The schema survived, so no migration has to be re-applied...
        expect(await listTables(t.meta)).toEqual(schema);
        // ...and `firstRun` re-seeds without re-migrating.
        const { appliedMigrations, createdRoles } = await firstRun(t.meta);
        expect(appliedMigrations).toEqual([]);
        expect(createdRoles.length).toBe(seededRoles);
      } finally {
        await t.destroy();
      }
    });
  });
}
