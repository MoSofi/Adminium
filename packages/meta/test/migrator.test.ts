import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ALL_MIGRATIONS,
  META_TABLE_NAMES,
  MigrationChecksumDriftError,
  UnknownMigrationError,
  applyMigrations,
  migrationChecksum,
  migrationStatus,
  type MetaMigration,
} from '../src/index.js';
import { TEST_DIALECTS, listTables, type TestDb } from './helpers/db.js';

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`migrator [${dialect.name}]`, () => {
    let t: TestDb;

    beforeEach(async () => {
      t = await dialect.make();
    });
    afterEach(async () => {
      await t.destroy();
    });

    it('applies all migrations cleanly and creates every BRIEF §6 table', async () => {
      const { applied } = await applyMigrations(t.meta.db, { dialect: t.meta.dialect });
      expect(applied).toEqual(ALL_MIGRATIONS.map((m) => m.name));

      const tables = await listTables(t.meta);
      for (const name of META_TABLE_NAMES) {
        expect(tables).toContain(name);
      }
      // Dashboards are pages rows, never a physical table (§3 catalog note).
      expect(tables).not.toContain('adminium_dashboards');
    });

    it('is idempotent — the second run applies nothing', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect });
      const second = await applyMigrations(t.meta.db, { dialect: t.meta.dialect });
      expect(second.applied).toEqual([]);
    });

    it('records name, checksum, and version in the ledger', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, version: '9.9.9' });
      const rows = await t.meta.db
        .selectFrom('adminium_migrations')
        .selectAll()
        .orderBy('name', 'asc')
        .execute();
      expect(rows.map((r) => r.name)).toEqual(ALL_MIGRATIONS.map((m) => m.name));
      for (const [i, migration] of ALL_MIGRATIONS.entries()) {
        expect(rows[i]?.checksum).toBe(migrationChecksum(migration));
        expect(rows[i]?.adminiumVersion).toBe('9.9.9');
        expect(rows[i]?.appliedAt).toBeGreaterThan(0);
      }
    });

    it('detects checksum drift on a modified applied migration', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect });
      const tampered: MetaMigration[] = ALL_MIGRATIONS.map((m, i) =>
        i === 0 ? { name: m.name, up: async () => undefined } : m,
      );
      await expect(
        applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: tampered }),
      ).rejects.toThrow(MigrationChecksumDriftError);
      await expect(
        applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: tampered }),
      ).rejects.toThrow(/0001_core_auth/);
    });

    it('aborts on unknown ledger rows (database migrated by a newer Adminium)', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect });
      const older = ALL_MIGRATIONS.slice(0, 2);
      await expect(
        applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: older }),
      ).rejects.toThrow(UnknownMigrationError);
    });

    it('applies only the pending tail when new migrations appear', async () => {
      const firstTwo = ALL_MIGRATIONS.slice(0, 2);
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: firstTwo });
      const { applied } = await applyMigrations(t.meta.db, { dialect: t.meta.dialect });
      expect(applied).toEqual(ALL_MIGRATIONS.slice(2).map((m) => m.name));
    });

    it('reports status per migration', async () => {
      const firstTwo = ALL_MIGRATIONS.slice(0, 2);
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: firstTwo });
      const status = await migrationStatus(t.meta.db, { dialect: t.meta.dialect });
      expect(status).toHaveLength(ALL_MIGRATIONS.length);
      expect(status.filter((s) => s.applied).map((s) => s.name)).toEqual(firstTwo.map((m) => m.name));
      expect(status.every((s) => s.known)).toBe(true);
      expect(status.every((s) => !s.drift)).toBe(true);
    });

    it('rejects out-of-order or duplicate migration lists', async () => {
      const reversed = [...ALL_MIGRATIONS].reverse();
      await expect(
        applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: reversed }),
      ).rejects.toThrow(/out of order/);
    });
  });
}
