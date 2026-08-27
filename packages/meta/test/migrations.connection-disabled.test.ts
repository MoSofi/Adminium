// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0019 (`disabled_at`): the pause flag lands on `adminium_connections`,
 * rows that predate the wave come back enabled (NULL = serving, no backfill),
 * and `setDisabled` round-trips WITHOUT disturbing `status` — the property the
 * whole two-column design exists for. Runs the real migration list split at
 * 0018/0019 on every available dialect.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ALL_MIGRATIONS, applyMigrations, connectionsRepo } from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const T0 = 1_750_000_000_000;

const PRE_0019 = ALL_MIGRATIONS.filter((m) => m.name < '0019_connection_disabled');

/** Repos never see key material — the round-trip is all these tests need. */
const crypto = { encrypt: (v: string) => `enc:${v}`, decrypt: (v: string) => v.slice(4) };

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`0019_connection_disabled [${dialect.name}]`, () => {
    let t: TestDb;

    beforeEach(async () => {
      t = await dialect.make();
    });
    afterEach(async () => {
      await t.destroy();
    });

    it('adds disabled_at; pre-wave rows read as enabled and pausing leaves status alone', async () => {
      // Ends exactly where 0019 begins — not "0019 is last", which is a claim
      // about the tail of the list that every later wave invalidates.
      expect(PRE_0019.at(-1)?.name).toBe('0018_connection_timezone_source');
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: PRE_0019 });

      // Raw insert: today's `connectionsRepo.create` writes `disabled_at`, a
      // column this pre-0019 schema does not have yet.
      await t.meta.db
        .insertInto('adminium_connections')
        .values({
          id: 'con_pre0019',
          name: 'legacy',
          engine: 'postgres',
          sourceKind: 'dsn',
          introspectDsnEncrypted: 'enc:postgres://legacy',
          settings: '{}',
          status: 'error',
          lastError: 'connection timed out',
          createdAt: T0,
          updatedAt: T0,
        } as never)
        .execute();

      await applyMigrations(t.meta.db, { dialect: t.meta.dialect });

      const repo = connectionsRepo(t.meta, crypto);
      const legacy = await repo.findById('con_pre0019');
      // No backfill, and none is needed: every row that predates the wave was
      // serving, which is exactly what NULL means.
      expect(legacy?.disabledAt).toBeNull();
      expect(legacy?.disabled).toBe(false);

      // Pausing a FAILING connection is the case the two-column split is for:
      // the health reading has to survive the pause so resuming does not hand
      // back a clean slate nobody earned.
      const paused = await repo.setDisabled('con_pre0019', true, T0 + 1000);
      expect(paused?.disabled).toBe(true);
      expect(paused?.disabledAt).toBe(T0 + 1000);
      expect(paused?.status).toBe('error');
      expect(paused?.lastError).toBe('connection timed out');

      // Idempotent: a second pause keeps the ORIGINAL instant, so "paused 3
      // days ago" is the age of the pause and not of the last click.
      const again = await repo.setDisabled('con_pre0019', true, T0 + 99_000);
      expect(again?.disabledAt).toBe(T0 + 1000);

      const resumed = await repo.setDisabled('con_pre0019', false, T0 + 2000);
      expect(resumed?.disabled).toBe(false);
      expect(resumed?.disabledAt).toBeNull();
      expect(resumed?.status).toBe('error');
    });

    it('creates new connections enabled, and reports nothing for an unknown id', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect });
      const repo = connectionsRepo(t.meta, crypto);

      const created = await repo.create(
        { name: 'prod', engine: 'postgres', introspectDsn: 'postgres://prod' },
        T0,
      );
      expect(created.disabled).toBe(false);
      expect(created.disabledAt).toBeNull();

      expect(await repo.setDisabled('con_missing', true, T0)).toBeNull();
    });
  });
}
