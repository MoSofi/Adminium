// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0017 (29-app-surfaces.md D10 / 29-T15): `app_key` lands on
 * `adminium_public_keys`. Keys minted before the wave carry NULL — an unbound
 * key, which the `surface-config.json` lookup must skip — and the split-run
 * proves the alter is additive on a table that already holds rows. Runs the
 * real migration list split at 0016/0017 on every available dialect.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ALL_MIGRATIONS, applyMigrations, publicKeysRepo, publicScopesRepo } from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const T0 = 1_750_000_000_000;

const PRE_0017 = ALL_MIGRATIONS.filter((m) => m.name < '0017_surface_binding');

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`0017_surface_binding [${dialect.name}]`, () => {
    let t: TestDb;

    beforeEach(async () => {
      t = await dialect.make();
    });
    afterEach(async () => {
      await t.destroy();
    });

    it('adds app_key; pre-wave keys stay NULL (unbound), post-wave keys bind', async () => {
      // Ends exactly where 0017 begins — not "0017 is last", which is a claim
      // about the tail of the list that every later wave invalidates.
      expect(PRE_0017.at(-1)?.name).toBe('0016_audit_entity');
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: PRE_0017 });

      /*
       * Scaffolding for the scope's FK, inserted raw for the same reason the
       * key below is: today's `connectionsRepo.create` writes `timezone_source`
       * (wave 0018), a column this pre-0017 schema will not have for two more
       * waves. Only the columns with no default are supplied.
       */
      const connectionId = 'con_pre0017';
      await t.meta.db
        .insertInto('adminium_connections')
        .values({
          id: connectionId,
          name: 'src',
          engine: 'postgres',
          sourceKind: 'dsn',
          settings: '{}',
          createdAt: T0,
          updatedAt: T0,
        } as never)
        .execute();
      const scope = await publicScopesRepo(t.meta).create(
        {
          connectionId,
          side: 'customer',
          name: 'portal',
          timezone: 'Europe/London',
          document: JSON.stringify({ version: 1 }),
        },
        T0,
      );
      // A key minted by the PRE-0017 schema — raw insert, since today's repo
      // writes a column that does not exist yet.
      await t.meta.db
        .insertInto('adminium_public_keys')
        .values({
          id: 'pbk_pre0017',
          name: 'legacy',
          prefix: 'adm_pub_legacy00',
          tokenHash: 'h'.repeat(64),
          tokenEncrypted: 'sealed',
          scopeId: scope.id,
          side: 'customer',
          origins: '[]',
          expiresAt: null,
          revokedAt: null,
          lastUsedAt: null,
          createdBy: null,
          createdAt: T0,
          updatedAt: T0,
        } as never)
        .execute();

      await applyMigrations(t.meta.db, { dialect: t.meta.dialect });

      const repo = publicKeysRepo(t.meta);
      const legacy = await repo.findById('pbk_pre0017');
      expect(legacy?.appKey).toBeNull();
      // An unbound key never answers a surface lookup.
      expect(await repo.newestLiveByApp('legacy', 'customer', T0 + 1)).toBeNull();

      const bound = await repo.create(
        {
          name: 'bound',
          prefix: 'adm_pub_bound000',
          tokenHash: 'h'.repeat(64),
          tokenEncrypted: 'sealed',
          scopeId: scope.id,
          side: 'customer',
          appKey: 'clients',
        },
        T0 + 2,
      );
      expect((await repo.newestLiveByApp('clients', 'customer', T0 + 3))?.id).toBe(bound.id);
    });
  });
}
