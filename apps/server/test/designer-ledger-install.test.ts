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
import { parseDatabaseModel } from '@adminium/engine';
import { manifestsRepo, overridesRepo, snapshotsRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { loadDecider } from '../src/add-ons/decide.js';
import { keepAddOnInstalls } from '../src/apps/table-ref.js';
import { loadSnapshotView } from '../src/data-io/snapshot-view.js';
import type { WriteContext, WriteTarget } from '../src/crud/write-context.js';
import { createWriteService } from '../src/crud/write-service.js';
import { writeStores } from '../src/crud/write-stores.js';
import { normalizeWriteValue } from '../src/crud/write-values.js';
import { createLedgerRuntime } from '../src/ledgers/registry.js';
import { ledgerParts } from '../src/project/apps/ledger-parts.js';
import { ENGINES } from './app-install-harness.js';
import { LEDGER_KIT_SERVER, ledgerKitFiles, ledgerKitManifest } from './fixtures/ledger-kit/index.js';
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

    it.skipIf(!available)('a table first made with a plain number for its link, then given the rule by an update: its line posts', async () => {
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
      // (The starter is written for this checkout's own version; the folder here is built for 0.3.18.)
      h.edit('apps/repairs/manifest/app.json', (app) => ({ ...app, compatibility: { ...(app['compatibility'] as object), minAdminiumVersion: '0.3.18' } }));
      // First as a model writes it before it knows the word for a link, with no rule and no add-on.
      const table = made.table as { columns: Record<string, unknown>[]; postings: unknown[] };
      h.put('apps/repairs/manifest/tables/item_parts.json', {
        ...table,
        columns: table.columns.filter((column) => column['ref'] !== 'account_id').map((column) => (column['ref'] === 'item_id' ? { ...column, type: 'int' } : column)),
        postings: undefined,
      });
      expect((await h.sync())[0], [...h.lines.warn, ...h.lines.log].join('\n')).toMatchObject({ key: 'repairs', state: 'installed' });

      // Then what the tool writes, on the app that is already there.
      h.put('apps/repairs/manifest/tables/item_parts.json', made.table);
      h.put('apps/repairs/manifest/add-ons.json', { requires: [{ key: made.addOn.key, range: made.addOn.range, reason: { 'en-US': 'Ledger kit keeps the units this app\'s parts use.' } }] });
      h.edit('apps/repairs/manifest/app.json', (app) => ({ ...app, compatibility: { ...(app['compatibility'] as object), minAdminiumVersion: '0.3.18' } }));
      h.edit('apps/repairs/manifest/roles.json', (roles) => (roles as unknown as Record<string, unknown>[]).map((role) => ({ ...role, tables: made.grants.map((grant) => ({ addOn: 'ledger-kit', table: grant.table, actions: ['read'], ...(grant.readable.length === 0 ? {} : { limit: { readable: grant.readable } }) })) })));
      const again = await h.sync();
      expect(again[0], [...h.lines.warn, ...h.lines.log].join('\n')).toMatchObject({ key: 'repairs' });
      expect(h.lines.warn).toEqual([]);

      // A write service wired as the server wires one, over the database as it now is.
      const { harness } = h;
      const view = await loadSnapshotView(harness.meta, harness.connectionId, { lists: true });
      const { db, dialect: engine } = await harness.manager.data(harness.connectionId);
      const target = (name: string): WriteTarget => ({ connectionId: harness.connectionId, view, table: view.table(view.model.tables.find((candidate) => candidate.name === name)!.id), db, dialect: engine, timezone: 'Europe/London' });
      const installs = keepAddOnInstalls(harness.meta, async () => parseDatabaseModel((await snapshotsRepo(harness.meta).latest(harness.connectionId))!.schema));
      const decider = loadDecider({ key: 'ledger-kit', version: '1.0.0', path: 'dist/server.js', bytes: LEDGER_KIT_SERVER });
      const writes = createWriteService({
        ...writeStores(harness.meta),
        ledgers: createLedgerRuntime({
          installs: () => installs.current(),
          refresh: () => installs.fresh(),
          decider: (key) => (key === 'ledger-kit' ? decider : null),
          versionNow: async (key) => {
            const row = await harness.meta.db.selectFrom('adminium_manifests').select(['version', 'status']).where('manifestKey', '=', key).executeTakeFirst();
            return row === undefined ? null : { version: row.version, status: row.status };
          },
        }),
      });
      const context: WriteContext = { origin: 'dashboard', hops: 0, actor: { kind: 'user', id: 'usr_ivy', label: 'Ivy' }, request: null };

      await harness.run("INSERT INTO ledger_kit_accounts (name, opening, taken, balance) VALUES ('Brake pads', 10, 0, 10)");
      const account = Number((await harness.rows('SELECT id FROM ledger_kit_accounts'))[0]!['id']);
      const item = Number((await harness.rows('SELECT id FROM repairs_items'))[0]!['id']);
      const parts = target('repairs_item_parts');
      const values = { item_id: item, account_id: account, qty: '2' };
      await writes.create({ target: parts, values: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, normalizeWriteValue(parts.table.columns.get(k)!, v)])), context, announce: async () => undefined });
      expect(Number((await harness.rows('SELECT taken FROM ledger_kit_accounts'))[0]!['taken'])).toBe(0);
      await writes.update({ target: target('repairs_items'), pk: { id: item }, values: { status: 'done' }, context, announce: async () => undefined });
      // The job is done: the two units its part used are taken.
      expect(Number((await harness.rows('SELECT taken FROM ledger_kit_accounts'))[0]!['taken'])).toBe(2);
    });
  });
}
