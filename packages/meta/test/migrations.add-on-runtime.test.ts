// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Waves 0020 + 0021 (the add-on runtime's meta surface, 26 §4).
 *
 * What these actually have to prove, beyond "the columns appeared":
 *
 *  - **0020 ALTERs.** `adminium_manifests` has shipped since 0006 and three
 *    planning documents said it had not. A test that only ran the full list
 *    would pass either way, so this one splits at 0019/0020 and asserts a row
 *    written against the PRE-wave schema survives the migration — which is only
 *    meaningful if the table was already there.
 *  - **The join table resolves O3.** An add-on attached to two hosts is one
 *    manifest row and two attachment rows, so the shipped
 *    `uq_adminium_manifests_manifest_key` stays true and the credential FK stays
 *    unambiguous. Both are asserted by trying to violate them.
 *  - **The cascades are real.** MySQL silently discards an inline column-level
 *    `REFERENCES`, so "the FK exists" is a claim that has to be tested by
 *    deleting a parent, on every dialect — not read off the migration source.
 *  - **D5's shape is enforceable.** Deleting a credential leaves the manifest
 *    and its attachments intact; that is the whole of "disconnect keeps data".
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ALL_MIGRATIONS, applyMigrations } from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const T0 = 1_750_000_000_000;

const PRE_0020 = ALL_MIGRATIONS.filter((m) => m.name < '0020_manifests_add_on');

/** A manifest row as 0006's schema allows it — no `kind` column yet. */
const legacyManifest = {
  id: 'mft_pre0020',
  manifestKey: 'northline-shop',
  version: '1.0.0',
  source: 'marketplace',
  manifest: '{"kind":"app"}',
  status: 'installed',
  installedAt: T0,
  updatedAt: T0,
};

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`0020 + 0021 add-on runtime [${dialect.name}]`, () => {
    let t: TestDb;

    beforeEach(async () => {
      t = await dialect.make();
    });
    afterEach(async () => {
      await t.destroy();
    });

    /** Applies everything up to but not including 0020, then inserts a row. */
    async function withLegacyRow(): Promise<void> {
      expect(PRE_0020.at(-1)?.name).toBe('0019_connection_disabled');
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: PRE_0020 });
      await t.meta.db.insertInto('adminium_manifests').values(legacyManifest as never).execute();
    }

    it('ALTERs a table that already exists, keeping the row that was in it', async () => {
      await withLegacyRow();
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });

      const row = await t.meta.db
        .selectFrom('adminium_manifests')
        .selectAll()
        .where('id', '=', 'mft_pre0020')
        .executeTakeFirstOrThrow();
      expect(row.manifestKey).toBe('northline-shop');
      // The default is what a pre-wave row MEANT: adminium_manifests was
      // introduced for installed micro-SaaS apps, so an unlabelled row is one.
      expect(row.kind).toBe('app');
      // Left alone rather than dropped (17 defers licences by name).
      expect(row.licenseKeyEncrypted).toBeNull();
    });

    it('lets one add-on attach to two hosts without a second manifest row', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
      await t.meta.db
        .insertInto('adminium_manifests')
        .values({ ...legacyManifest, id: 'mft_pers', manifestKey: 'personalizer', kind: 'add-on' } as never)
        .execute();

      // The personalizer really does declare two hosts (printing + maker) —
      // this is O3's case, and the whole reason the join table exists.
      for (const host of ['printing', 'maker']) {
        await t.meta.db
          .insertInto('adminium_manifest_attachments')
          .values({
            id: `mat_${host}`,
            manifestId: 'mft_pers',
            attachedTo: host,
            createdAt: T0,
          } as never)
          .execute();
      }

      const rows = await t.meta.db
        .selectFrom('adminium_manifest_attachments')
        .selectAll()
        .where('manifestId', '=', 'mft_pers')
        .execute();
      expect(rows).toHaveLength(2);
      // NULL = enabled, per 0019's discipline.
      expect(rows.every((r) => r.disabledAt === null)).toBe(true);
      // And exactly one manifest row, so the shipped unique index is untouched.
      const manifests = await t.meta.db
        .selectFrom('adminium_manifests')
        .selectAll()
        .where('manifestKey', '=', 'personalizer')
        .execute();
      expect(manifests).toHaveLength(1);
    });

    it('refuses the same (manifest, host) pair twice', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
      await t.meta.db
        .insertInto('adminium_manifests')
        .values({ ...legacyManifest, id: 'mft_ds', manifestKey: 'design-studio', kind: 'add-on' } as never)
        .execute();
      const attach = { id: 'mat_1', manifestId: 'mft_ds', attachedTo: 'printing', createdAt: T0 };
      await t.meta.db.insertInto('adminium_manifest_attachments').values(attach as never).execute();
      await expect(
        t.meta.db
          .insertInto('adminium_manifest_attachments')
          .values({ ...attach, id: 'mat_2' } as never)
          .execute(),
      ).rejects.toThrow();
    });

    it('cascades attachments and credentials when a manifest is uninstalled', async () => {
      // The MySQL trap this exists for: an inline column-level REFERENCES is
      // parsed and silently discarded, so the only way to know a cascade is
      // real is to delete a parent and look.
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
      await t.meta.db
        .insertInto('adminium_manifests')
        .values({ ...legacyManifest, id: 'mft_dhl', manifestKey: 'shipping-dhl', kind: 'add-on' } as never)
        .execute();
      await t.meta.db
        .insertInto('adminium_manifest_attachments')
        .values({ id: 'mat_dhl', manifestId: 'mft_dhl', attachedTo: 'printing', createdAt: T0 } as never)
        .execute();
      await t.meta.db
        .insertInto('adminium_add_on_credentials')
        .values({
          id: 'aoc_dhl',
          manifestId: 'mft_dhl',
          kind: 'api-key',
          payload: 'enc:secret',
          createdAt: T0,
          updatedAt: T0,
        } as never)
        .execute();

      await t.meta.db.deleteFrom('adminium_manifests').where('id', '=', 'mft_dhl').execute();

      expect(await t.meta.db.selectFrom('adminium_manifest_attachments').selectAll().execute()).toEqual([]);
      expect(await t.meta.db.selectFrom('adminium_add_on_credentials').selectAll().execute()).toEqual([]);
    });

    it('holds one credential per add-on, not one per attachment', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
      await t.meta.db
        .insertInto('adminium_manifests')
        .values({ ...legacyManifest, id: 'mft_c', manifestKey: 'shipping-dhl', kind: 'add-on' } as never)
        .execute();
      const cred = {
        id: 'aoc_1',
        manifestId: 'mft_c',
        kind: 'api-key',
        payload: 'enc:one',
        createdAt: T0,
        updatedAt: T0,
      };
      await t.meta.db.insertInto('adminium_add_on_credentials').values(cred as never).execute();
      // A second connect must be an upsert, never a duplicate secret that the
      // disconnect path could miss.
      await expect(
        t.meta.db.insertInto('adminium_add_on_credentials').values({ ...cred, id: 'aoc_2' } as never).execute(),
      ).rejects.toThrow();
    });

    it('D5: deleting the credential keeps the manifest and its attachments', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
      await t.meta.db
        .insertInto('adminium_manifests')
        .values({ ...legacyManifest, id: 'mft_d5', manifestKey: 'shipping-dhl', kind: 'add-on' } as never)
        .execute();
      await t.meta.db
        .insertInto('adminium_manifest_attachments')
        .values({ id: 'mat_d5', manifestId: 'mft_d5', attachedTo: 'printing', createdAt: T0 } as never)
        .execute();
      await t.meta.db
        .insertInto('adminium_add_on_credentials')
        .values({
          id: 'aoc_d5',
          manifestId: 'mft_d5',
          kind: 'api-key',
          payload: 'enc:secret',
          createdAt: T0,
          updatedAt: T0,
        } as never)
        .execute();

      // Disconnect, as D5 defines it: the keys go, nothing else does.
      await t.meta.db.deleteFrom('adminium_add_on_credentials').where('manifestId', '=', 'mft_d5').execute();

      expect(
        await t.meta.db.selectFrom('adminium_manifests').selectAll().where('id', '=', 'mft_d5').execute(),
      ).toHaveLength(1);
      expect(
        await t.meta.db.selectFrom('adminium_manifest_attachments').selectAll().execute(),
      ).toHaveLength(1);
    });

    it('stores expiry and scopes outside the ciphertext', async () => {
      // Deciding whether to refresh must not require decrypting a token.
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
      await t.meta.db
        .insertInto('adminium_manifests')
        .values({ ...legacyManifest, id: 'mft_o', manifestKey: 'import-canva', kind: 'add-on' } as never)
        .execute();
      await t.meta.db
        .insertInto('adminium_add_on_credentials')
        .values({
          id: 'aoc_o',
          manifestId: 'mft_o',
          kind: 'oauth2',
          payload: 'enc:{"access":"a","refresh":"r"}',
          expiresAt: T0 + 3_600_000,
          scopes: '["design:read"]',
          createdAt: T0,
          updatedAt: T0,
        } as never)
        .execute();

      const row = await t.meta.db
        .selectFrom('adminium_add_on_credentials')
        .selectAll()
        .where('id', '=', 'aoc_o')
        .executeTakeFirstOrThrow();
      expect(row.expiresAt).toBe(T0 + 3_600_000);
      expect(row.kind).toBe('oauth2');
      // The secret half is opaque; nothing here can read it without the key.
      expect(row.payload.startsWith('enc:')).toBe(true);
    });
  });
}
