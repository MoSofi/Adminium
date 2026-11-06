// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0080: "Send as" on an email template, on every available dialect.
 *
 * - A store with templates upgrades with every one of them sending by the
 *   record (null).
 * - "Send as" is one value per key: written to every language of the
 *   family, read from any row that holds it, and a language added later
 *   reads the family's.
 * - The column holds a workspace id at full width and `server`.
 * - Deleting a workspace sets the templates that sent as it back to null,
 *   and leaves the others.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ALL_MIGRATIONS, applyMigrations, emailTemplatesRepo, TEMPLATE_SEND_AS_SERVER, workspacesRepo } from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const T0 = 1_762_000_000_000;
const PRE = ALL_MIGRATIONS.filter((m) => m.name < '0080_template_send_as');
const BODY = { subject: 'Your firing is done', blocks: [], enabled: true };

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`0080_template_send_as [${dialect.name}]`, () => {
    let t: TestDb;
    beforeEach(async () => {
      t = await dialect.make();
    });
    afterEach(async () => {
      await t.destroy();
    });

    it('upgrades a store with templates: every one sends by the record', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: PRE });
      await emailTemplatesRepo(t.meta).upsert('firing-done', 'en_US', { name: 'Firing done', ...BODY });
      expect((await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS })).applied.slice(0, 1)).toEqual(['0080_template_send_as']);
      const repo = emailTemplatesRepo(t.meta);
      expect((await repo.findByKeyLocale('firing-done', 'en_US'))?.sendAs).toBeNull();
      expect(await repo.sendAsOf('firing-done')).toBeNull();
    });

    it('is one value per key, read by a language added later, and goes back to null with its workspace', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
      const repo = emailTemplatesRepo(t.meta);
      const workspaces = workspacesRepo(t.meta);
      const kiln = await workspaces.create({ name: 'Kiln Street Pottery' }, T0);
      const coffee = await workspaces.create({ name: 'Fernhill Coffee' }, T0);
      await repo.upsert('firing-done', 'en_US', { name: 'Firing done', ...BODY });
      await repo.upsert('firing-done', 'de_DE', { name: 'Brand fertig', ...BODY });
      await repo.upsert('roast-ready', 'en_US', { name: 'Roast ready', ...BODY });

      expect(await repo.setSendAs('firing-done', kiln.id, T0 + 1)).toBe(2);
      expect(await repo.setSendAs('roast-ready', coffee.id, T0 + 1)).toBe(1);
      expect((await repo.siblings('firing-done')).map((row) => row.sendAs)).toEqual([kiln.id, kiln.id]);
      // A language added after "Send as" was set reads the family's.
      const fr = await repo.upsert('firing-done', 'fr_FR', { name: 'Cuisson terminée', ...BODY });
      expect(fr.sendAs).toBeNull();
      expect(await repo.sendAsOf('firing-done')).toBe(kiln.id);

      // `server`, and a workspace id at its full width.
      await repo.setSendAs('firing-done', TEMPLATE_SEND_AS_SERVER);
      expect(await repo.sendAsOf('firing-done')).toBe('server');
      const wide = `wsp_${'W'.repeat(36)}`;
      await repo.setSendAs('firing-done', wide);
      expect(await repo.sendAsOf('firing-done')).toBe(wide);
      await repo.setSendAs('firing-done', kiln.id);

      // Kiln goes: its template sends by the record again; Fernhill's keeps its own.
      expect(await workspaces.remove(kiln.id)).toBe(true);
      expect(await repo.sendAsOf('firing-done')).toBeNull();
      expect(await repo.sendAsOf('roast-ready')).toBe(coffee.id);
      // Back to "by the record" by hand.
      await repo.setSendAs('roast-ready', null);
      expect(await repo.sendAsOf('roast-ready')).toBeNull();
    });
  });
}
