// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0079: the values an app's deployment-wide part replaced, on every
 * available dialect. A store from before the wave upgrades as it was; the
 * first record keeps what was there (or that nothing was), a later one only
 * what was written; a string value reads back as a string; and the rows go
 * with the install.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ALL_MIGRATIONS, applyMigrations, appInstanceUndoRepo, manifestsRepo } from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const T0 = 1_750_000_000_000;
const PRE_0079 = ALL_MIGRATIONS.filter((m) => m.name < '0079_app_instance_undo');
const crypto = { encrypt: (v: string) => v, decrypt: (v: string) => v };
const SHOP = { manifestKey: 'corner-shop', version: '1.0.0', kind: 'app' as const, source: 'file', document: { kind: 'app', key: 'corner-shop', version: '1.0.0' } };

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`0079_app_instance_undo [${dialect.name}]`, () => {
    let t: TestDb;

    beforeEach(async () => {
      t = await dialect.make();
    });
    afterEach(async () => {
      await t.destroy();
    });

    it('upgrades a store with an install, and keeps the first value replaced', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: PRE_0079 });
      const installed = await manifestsRepo(t.meta, crypto).install(SHOP, T0);
      expect((await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS })).applied[0]).toBe('0079_app_instance_undo');

      const repo = appInstanceUndoRepo(t.meta);
      expect(await repo.list(installed.row.id)).toEqual([]);
      // A name that reads like a number stays a string; nothing set stays nothing.
      await repo.put({ manifestId: installed.row.id, kind: 'setting', item: 'branding.appName', before: { value: '2048' }, applied: 'Fernhill' }, T0 + 1);
      await repo.put({ manifestId: installed.row.id, kind: 'word', item: 'en_US:common:nav.home', before: null, applied: '' }, T0 + 1);
      await repo.put({ manifestId: installed.row.id, kind: 'setting', item: 'branding.logoFileId', before: { value: null }, applied: 'file_x' }, T0 + 1);
      // An update writes again: the first before stays.
      await repo.put({ manifestId: installed.row.id, kind: 'setting', item: 'branding.appName', before: { value: 'Fernhill' }, applied: 'Fernhill & Co' }, T0 + 2);

      const rows = await repo.list(installed.row.id);
      expect(rows.map((row) => [row.kind, row.item, row.before, row.applied, row.createdAt, row.updatedAt])).toEqual([
        ['setting', 'branding.appName', { value: '2048' }, 'Fernhill & Co', T0 + 1, T0 + 2],
        ['setting', 'branding.logoFileId', { value: null }, 'file_x', T0 + 1, T0 + 1],
        ['word', 'en_US:common:nav.home', null, '', T0 + 1, T0 + 1],
      ]);

      await repo.remove(installed.row.id, 'word', 'en_US:common:nav.home');
      expect((await repo.list(installed.row.id)).map((row) => row.item)).toEqual(['branding.appName', 'branding.logoFileId']);
    });

    it('holds an email and a long item, and refuses an item longer than its column', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
      const installed = await manifestsRepo(t.meta, crypto).install(SHOP, T0);
      const repo = appInstanceUndoRepo(t.meta);
      const content = { subject: 'Reset', preheader: '', blocks: [{ id: 'a', block: 'email.text', data: { text: 'Hi' } }], footer: '', isBuiltinCopy: true };
      await repo.put({ manifestId: installed.row.id, kind: 'email', item: 'password-reset/en_US', before: { value: content }, applied: { ...content, subject: 'New' } }, T0);
      const long = `en_US:common:${'k'.repeat(300)}`;
      await repo.put({ manifestId: installed.row.id, kind: 'word', item: long, before: null, applied: 'x' }, T0);
      const [email, word] = await repo.list(installed.row.id);
      expect(email).toMatchObject({ before: { value: content }, applied: { ...content, subject: 'New' } });
      expect(word!.item).toBe(long);
      await expect(repo.put({ manifestId: installed.row.id, kind: 'word', item: 'w'.repeat(321), before: null, applied: 'x' })).rejects.toThrow('longer than its column');
    });

    it('goes with the install, and one install never sees another\'s', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
      const shop = await manifestsRepo(t.meta, crypto).install(SHOP, T0);
      const desk = await manifestsRepo(t.meta, crypto).install({ ...SHOP, manifestKey: 'desk', document: { kind: 'app', key: 'desk', version: '1.0.0' } }, T0);
      const repo = appInstanceUndoRepo(t.meta);
      await repo.put({ manifestId: shop.row.id, kind: 'locale', item: 'de_DE', before: null, applied: true }, T0);
      await repo.put({ manifestId: desk.row.id, kind: 'locale', item: 'de_DE', before: { value: true }, applied: false }, T0);
      await manifestsRepo(t.meta, crypto).uninstall(shop.row.id);
      expect(await repo.list(shop.row.id)).toEqual([]);
      expect(await repo.list(desk.row.id)).toHaveLength(1);
    });
  });
}
