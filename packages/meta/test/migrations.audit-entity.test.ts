// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0016 backfill (30-record-pages.md WS-A): audit rows written BEFORE the
 * entity columns existed get their denormalized keys derived from the stored
 * RecordRef JSON, so pre-existing per-record activity shows up on day one —
 * and rows whose entity this reader cannot parse stay NULL rather than
 * failing the wave. Runs the real migration list split at 0015/0016 on every
 * available dialect.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ALL_MIGRATIONS, applyMigrations } from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const T0 = 1_750_000_000_000;

const PRE_0016 = ALL_MIGRATIONS.filter((m) => m.name < '0016_audit_entity');

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`0016_audit_entity backfill [${dialect.name}]`, () => {
    let t: TestDb;

    beforeEach(async () => {
      t = await dialect.make();
    });
    afterEach(async () => {
      await t.destroy();
    });

    it('backfills entity keys from stored refs; unparseable refs stay NULL', async () => {
      // The filter must end exactly where 0016 begins. This asserted "0016 is
      // the LAST migration", which stopped being true — and started failing —
      // the moment 0017 landed, though nothing about this test was wrong.
      expect(PRE_0016.at(-1)?.name).toBe('0015_connection_tenant_config');
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: PRE_0016 });

      // Rows written by the pre-0016 schema — raw inserts, since today's repo
      // would write columns that do not exist yet.
      const base = {
        actorKind: 'user',
        actorId: 'usr_x',
        actorLabel: 'Ava Reyes',
        category: 'data',
        action: 'record.update',
        connectionId: 'conn_x',
        changes: null,
        ip: null,
        userAgent: null,
        requestId: null,
      };
      const legacy = t.meta.db.insertInto('adminium_audit_log');
      await legacy
        .values([
          {
            ...base,
            id: 'aud_legacy_single',
            createdAt: T0,
            entity: JSON.stringify({
              connectionId: 'conn_x',
              table: 'public.invoices',
              pk: { id: 42 },
              label: '42',
            }),
          },
          {
            ...base,
            id: 'aud_legacy_composite',
            createdAt: T0 + 1,
            entity: JSON.stringify({
              connectionId: 'conn_x',
              table: 'public.invoice_items',
              pk: { invoice_id: 42, line: 3 },
              label: '[42,3]',
            }),
          },
          // Valid JSON, not a RecordRef — representable on every dialect
          // (postgres jsonb would reject malformed JSON at insert).
          { ...base, id: 'aud_legacy_broken', createdAt: T0 + 2, entity: '"not-a-ref"' },
          { ...base, id: 'aud_legacy_none', createdAt: T0 + 3, entity: null },
        ] as never)
        .execute();

      await applyMigrations(t.meta.db, { dialect: t.meta.dialect });

      const rows = await t.meta.db
        .selectFrom('adminium_audit_log')
        .select(['id', 'entityTable', 'entityId'])
        .execute();
      const byId = new Map(rows.map((row) => [row.id, row]));
      expect(byId.get('aud_legacy_single')).toMatchObject({
        entityTable: 'public.invoices',
        entityId: '42',
      });
      expect(byId.get('aud_legacy_composite')).toMatchObject({
        entityTable: 'public.invoice_items',
        entityId: '[42,3]',
      });
      expect(byId.get('aud_legacy_broken')).toMatchObject({ entityTable: null, entityId: null });
      expect(byId.get('aud_legacy_none')).toMatchObject({ entityTable: null, entityId: null });
    });
  });
}
