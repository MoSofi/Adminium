// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT POST_TO_LEDGER WRITES, INSTALLED.
 *
 * The parts the Designer's tool makes for a table that posts into an add-on's
 * ledger — the link column, the quantity, the rule, the requirement, the
 * role's grant — put in a project folder and applied as `adminium dev`
 * applies it: the add-on is installed first, the app's table is made with the
 * new columns, and the rule is stored on it. On every engine this run can
 * reach.
 */
import { manifestsRepo, overridesRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { ledgerParts } from '../src/project/apps/ledger-parts.js';
import { ENGINES } from './app-install-harness.js';
import { ledgerKitFiles, ledgerKitManifest } from './fixtures/ledger-kit/index.js';
import { folderHarness, type FolderHarness } from './folder-app-harness.js';

const IDENTITY = { encrypt: (v: string) => v, decrypt: (v: string) => v };

let h: FolderHarness;
afterEach(async () => {
  await h?.close();
});

for (const [dialect, available] of ENGINES) {
  describe(`the parts of a table that posts, installed — ${dialect}`, { timeout: 180_000 }, () => {
    it.skipIf(!available)('the app installs on the add-on, with the columns made and the rule stored on its table', async () => {
      const kit = ledgerKitManifest();
      const made = ledgerParts({
        addOn: 'ledger-kit',
        document: kit,
        ledger: 'units',
        action: 'use',
        table: { ref: 'item_parts', label: { 'en-US': 'Part used' }, labelPlural: { 'en-US': 'Parts used' }, columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'item_id', type: 'fk', references: 'items' }] },
        via: 'item_id',
        when: { post: { column: 'status', in: ['done'] }, reverse: { column: 'status', from: ['done'], in: ['open'] } },
      });
      if (!made.ok) throw new Error(made.problem);

      h = await folderHarness(dialect, { mode: 'dev', addOns: true, version: '0.3.18' });
      await h.harness.stageAddOn!(kit, ledgerKitFiles(kit));
      await h.newApp('repairs');
      // Exactly what the tool writes: the table, the requirement, the grant, the floor.
      h.put('apps/repairs/manifest/tables/item_parts.json', made.table);
      h.put('apps/repairs/manifest/add-ons.json', { requires: [{ key: made.addOn.key, range: made.addOn.range, reason: { 'en-US': 'Ledger kit keeps the units this app\'s parts use.' } }] });
      h.edit('apps/repairs/manifest/app.json', (app) => ({ ...app, compatibility: { ...(app['compatibility'] as object), minAdminiumVersion: '0.3.18' } }));
      const rolesFile = 'apps/repairs/manifest/roles.json';
      h.edit(rolesFile, (roles) => (roles as unknown as Record<string, unknown>[]).map((role) => ({ ...role, tables: made.grants.map((grant) => ({ addOn: 'ledger-kit', table: grant.table, actions: ['read'], ...(grant.readable.length === 0 ? {} : { limit: { readable: grant.readable } }) })) })));

      expect((await h.sync())[0], [...h.lines.warn, ...h.lines.log].join('\n')).toMatchObject({ key: 'repairs', state: 'installed' });
      expect(h.lines.warn).toEqual([]);

      // The add-on is here, in the app's database, connected to the app.
      const addOn = (await manifestsRepo(h.harness.meta, IDENTITY).findByKey('ledger-kit'))!;
      expect(addOn.row).toMatchObject({ kind: 'add-on', status: 'installed', connectionId: h.harness.connectionId });
      expect(addOn.attachments.filter((attachment) => attachment.attachedTo === 'repairs')).toHaveLength(1);
      // The app's table has the two columns the tool added, and takes a row that names an account by its key.
      await h.harness.run("INSERT INTO ledger_kit_accounts (name, opening) VALUES ('Brake pads', 10)");
      const account = Number((await h.harness.rows('SELECT id FROM ledger_kit_accounts'))[0]!['id']);
      const item = Number((await h.harness.rows('SELECT id FROM repairs_items'))[0]!['id']);
      await h.harness.run(`INSERT INTO repairs_item_parts (item_id, account_id, qty) VALUES (${String(item)}, ${String(account)}, 2)`);
      expect(Number((await h.harness.rows('SELECT qty FROM repairs_item_parts'))[0]!['qty'])).toBe(2);
      // The rule is stored on the app's table, as the tool wrote it.
      const stored = (await overridesRepo(h.harness.meta).listForConnection(h.harness.connectionId, { status: 'active' })).filter((row) => row.op === 'table.postings');
      // (The add-on's own tables carry rules too: the app's is the one on its parts table.)
      const mine = stored.filter((row) => row.tableName.includes('item_parts'));
      expect(mine, stored.map((row) => row.tableName).join(', ')).toHaveLength(1);
      expect((mine[0]!.value as { postings: unknown[] }).postings).toEqual([made.posting]);
    });
  });
}
