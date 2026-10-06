// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A FOLDER APP THAT NEEDS AN ADD-ON WITH TABLES OF ITS OWN — the acceptance
 * run through a project folder: under `adminium dev` the add-on is installed
 * first, in the app's own database, with its tables under its own prefix,
 * its page and its roles, and connected to the app; a server started over the
 * same folder afterwards (`adminium start`) finds everything as it is and
 * changes nothing. On every engine this run can reach.
 */
import { manifestsRepo, pagesRepo, rolesRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { ENGINES } from './app-install-harness.js';
import { stockKitManifest } from './fixtures/stock-kit/index.js';
import { folderHarness, type FolderHarness } from './folder-app-harness.js';

const IDENTITY = { encrypt: (v: string) => v, decrypt: (v: string) => v };

let h: FolderHarness;
afterEach(async () => {
  await h?.close();
});

for (const [dialect, available] of ENGINES) {
  describe(`a folder app that needs an add-on — ${dialect}`, { timeout: 180_000 }, () => {
    it.skipIf(!available)('dev installs the add-on first, in the app\'s database; a start over the same folder changes nothing', async () => {
      h = await folderHarness(dialect, { mode: 'dev', addOns: true });
      await h.harness.stageAddOn!(stockKitManifest());
      await h.newApp('repairs');
      h.put('apps/repairs/manifest/add-ons.json', { requires: [{ key: 'stock-kit', range: '>=1.0.0', reason: { 'en-US': 'Parts are kept in stock.' } }] });

      expect((await h.sync())[0], h.lines.warn.join('\n')).toMatchObject({ key: 'repairs', state: 'installed' });
      expect(h.lines.warn).toEqual([]);
      const manifests = manifestsRepo(h.harness.meta, IDENTITY);
      const addOn = (await manifests.findByKey('stock-kit'))!;
      // Installed like an app, where the app is, and connected to it.
      expect(addOn.row).toMatchObject({ kind: 'add-on', status: 'installed', version: '1.0.0', connectionId: h.harness.connectionId });
      expect(addOn.attachments.filter((attachment) => attachment.attachedTo === 'repairs').map((attachment) => attachment.disabledAt)).toEqual([null]);
      // Its tables under its own prefix, beside the app's; its seedless tables empty.
      expect(Number((await h.harness.rows('SELECT COUNT(*) AS n FROM stock_kit_items'))[0]!['n'])).toBe(0);
      expect(Number((await h.harness.rows('SELECT COUNT(*) AS n FROM stock_kit_takes'))[0]!['n'])).toBe(0);
      expect(Number((await h.harness.rows('SELECT COUNT(*) AS n FROM repairs_items'))[0]!['n'])).toBeGreaterThan(0);
      // Its generated page and its roles are this server's.
      const pages = (await pagesRepo(h.harness.meta).listAll()).map((page) => page.slug);
      expect(pages).toEqual(expect.arrayContaining(['stock-kit-items', 'repairs-items']));
      const roles = (await rolesRepo(h.harness.meta).list()).filter((role) => role.appKey === 'stock-kit').map((role) => role.slug).sort();
      expect(roles).toEqual(['stock-kit-manager', 'stock-kit-reader']);
      // A write its rules refuse is refused: the capped balance is the add-on's rule, written at its install.
      await h.harness.run(`INSERT INTO stock_kit_items (name, opening, taken, "left") VALUES ('Brake pad', 5, 0, 5)`.replace(/"left"/, dialect === 'mysql' ? '`left`' : '"left"'));

      // `adminium start` over the same folder: nothing to do, nothing made twice.
      const tablesBefore = (await manifests.findByKey('stock-kit'))!.row.updatedAt;
      expect(await h.restart({ mode: 'server' }).reconcile()).toEqual([{ key: 'repairs', state: 'unchanged', hash: expect.any(String) }]);
      const after = (await manifests.findByKey('stock-kit'))!;
      expect(after.row).toMatchObject({ status: 'installed', version: '1.0.0' });
      expect(after.row.updatedAt).toBe(tablesBefore);
      expect(Number((await h.harness.rows('SELECT COUNT(*) AS n FROM stock_kit_items'))[0]!['n'])).toBe(1);
      expect((await rolesRepo(h.harness.meta).list()).filter((role) => role.appKey === 'stock-kit')).toHaveLength(2);
    });

    it.skipIf(!available)('a server refuses to bring an add-on the folder\'s app needs and that is not here, and says which', async () => {
      h = await folderHarness(dialect, { mode: 'server', addOns: true });
      await h.newApp('repairs');
      h.put('apps/repairs/manifest/add-ons.json', { requires: [{ key: 'stock-kit', range: '>=1.0.0', reason: { 'en-US': 'Parts are kept in stock.' } }] });
      const [result] = await h.sync();
      expect(result?.state).not.toBe('installed');
      expect(`${result?.message ?? ''} ${h.lines.warn.join(' ')}`).toContain('stock-kit');
      expect(await manifestsRepo(h.harness.meta, IDENTITY).findByKey('stock-kit')).toBeNull();
    });
  });
}
