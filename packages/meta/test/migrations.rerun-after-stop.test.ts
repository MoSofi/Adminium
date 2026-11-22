// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN UPGRADE THAT STOPS PART WAY FINISHES ON THE NEXT START. MySQL has no
 * transactional DDL, so a wave stopped just before its ledger row keeps every
 * statement it ran, and the next start runs all of them again. Each wave of
 * this release is stopped at that worst moment, from a store as 0.3.70 left
 * it, and must then finish.
 */
import type { KyselyPlugin } from 'kysely';
import { describe, expect, it } from 'vitest';

import { ALL_MIGRATIONS, applyMigrations } from '../src/index.js';
import { TEST_DIALECTS } from './helpers/db.js';

const WAVES = ['0100_connected_accounts', '0101_calendar_feeds', '0102_calendar_sync', '0103_email_changes', '0104_connect_link_address', '0105_revoke_stopped_keys', '0106_owner_row_limits_pending'];

/** Stops the run at the wave's ledger row: every statement of the wave has run. */
function stopAtLedgerRow(): KyselyPlugin {
  return {
    transformQuery: ({ node }) => {
      if (node.kind === 'InsertQueryNode' && JSON.stringify(node.into).includes('adminium_migrations')) throw new Error('the process stopped here');
      return node;
    },
    transformResult: async ({ result }) => result,
  };
}

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`an upgrade stopped part way [${dialect.name}]`, () => {
    for (const wave of WAVES) {
      it(`${wave} finishes on the next start`, async () => {
        const t = await dialect.make();
        try {
          const { meta } = t;
          await applyMigrations(meta.db, { dialect: meta.dialect, migrations: ALL_MIGRATIONS.filter((m) => m.name < wave) });
          const upToWave = ALL_MIGRATIONS.filter((m) => m.name <= wave);
          await expect(applyMigrations(meta.db.withPlugin(stopAtLedgerRow()), { dialect: meta.dialect, migrations: upToWave })).rejects.toThrow('the process stopped here');
          const { applied } = await applyMigrations(meta.db, { dialect: meta.dialect, migrations: upToWave });
          expect(applied).toEqual([wave]);
        } finally {
          await t.destroy();
        }
      }, 120_000);
    }
  });
}
