// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE INSTALLS WHOSE STORED ROW LIMITS ARE STILL TO BE SORTED. An upgrade lists
 * every install there is; a new store lists none; and a run stopped part way
 * and run again leaves what was sorted since off the list.
 */
import { describe, expect, it } from 'vitest';

import { ALL_MIGRATIONS, applyMigrations, manifestsRepo, settingsRepo } from '../src/index.js';
import { up as listOnce } from '../src/migrations/0106_owner_row_limits_pending.js';
import { TEST_DIALECTS } from './helpers/db.js';

const WAVE = '0106_owner_row_limits_pending';
const KEY = 'system.ownerRowLimitsPending' as const;
const CRYPTO = { encrypt: (value: string) => value, decrypt: (value: string) => value };

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`the installs to sort [${dialect.name}]`, () => {
    it('an upgrade lists every install, and a second run keeps what was sorted since', async () => {
      const t = await dialect.make();
      try {
        const { meta } = t;
        await applyMigrations(meta.db, { dialect: meta.dialect, migrations: ALL_MIGRATIONS.filter((m) => m.name < WAVE) });
        const repo = manifestsRepo(meta, CRYPTO as never);
        const one = await repo.install({ manifestKey: 'shop', version: '1.0.0', kind: 'app', source: 'file', document: {} });
        const two = await repo.install({ manifestKey: 'desk', version: '1.0.0', kind: 'app', source: 'file', document: {} });

        expect((await applyMigrations(meta.db, { dialect: meta.dialect })).applied).toContain(WAVE);
        expect([...(await settingsRepo(meta).get(KEY))].sort()).toEqual([one.row.id, two.row.id].sort());

        await settingsRepo(meta).set(KEY, [two.row.id]);
        await listOnce(meta.db as never);
        expect(await settingsRepo(meta).get(KEY)).toEqual([two.row.id]);
      } finally {
        await t.destroy();
      }
    });

    it('a new store lists nothing', async () => {
      const t = await dialect.make();
      try {
        await applyMigrations(t.meta.db, { dialect: t.meta.dialect });
        expect(await settingsRepo(t.meta).get(KEY)).toEqual([]);
      } finally {
        await t.destroy();
      }
    });
  });
}
