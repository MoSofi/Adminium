// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SAVING WHICH ADD-ONS AND APPS A DATABASE NEEDS, AND INSTALLING THE FILE.
 *
 * An add-on a rule's step needs is required; one only installed here or
 * attached to the dashboard is suggested, ticked; one nothing uses is left
 * out. Each from its installed version up. A catalog app that holds tables
 * here is required on the target database; an app installed from a file
 * stays with its install and is said in Check. An add-on's keys and its
 * settings' values never travel. The target refuses the file until the
 * required app is there, and then installs it. On every engine.
 */
import { addOnSettingsRepo, automationsRepo, manifestsRepo, type MetaDb } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { convertToApp } from '../src/apps/save/convert.js';
import { addOnManifest, appManifest, ENGINES } from './app-add-ons.helpers.js';
import { addOnHarness, choices, expectNoneOf, expectValid, handMadeShop, installSaved, sourceOf, withOtherParts, type Doc, type Harness } from './app-save-parts.helpers.js';

const CRYPTO = { encrypt: (v: string) => v, decrypt: (v: string) => v };

async function addOn(meta: MetaDb, key: string, version: string, opts: { connectionId?: string; attachTo?: string[]; settings?: Doc[] } = {}): Promise<string> {
  const made = await manifestsRepo(meta, CRYPTO).install({
    manifestKey: key,
    version,
    kind: 'add-on',
    source: 'file',
    ...(opts.connectionId === undefined ? {} : { connectionId: opts.connectionId, scopeKey: opts.connectionId }),
    ...(opts.attachTo === undefined ? {} : { attachTo: opts.attachTo }),
    document: addOnManifest(key, { version, addOn: { attaches: [{ app: '*' }], slots: [], ...(opts.settings === undefined ? {} : { settings: opts.settings }) } }),
  });
  return made.row.id;
}

/** A catalog app holding one table, and an app installed from a file holding another. */
const STUDIO = appManifest('studio', { requiredSchema: { tables: [{ ref: 'jobs', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'title', type: 'text', nullable: true }] }] } });
const OWN = appManifest('own-thing', {
  name: 'Own thing',
  publisher: { id: 'local', name: 'The bench' },
  requiredSchema: { tables: [{ ref: 'notes', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'body', type: 'text', nullable: true }] }] },
  frontends: [{ side: 'staff', kind: 'none' }],
});

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`saving the add-ons and apps a database needs [${dialect}]`, () => {
    const open: Harness[] = [];
    afterEach(async () => {
      for (const h of open.splice(0)) await h.close();
    });

    it('requires, suggests and apps, without keys or settings, and the target installs it once the app is there', async () => {
      const h = await handMadeShop(dialect);
      open.push(h);
      // Installed here, with a key and a setting given.
      const loyalty = await addOn(h.meta, 'loyalty', '2.1.0', { connectionId: h.connectionId, settings: [{ key: 'greeting', type: 'text', label: { 'en-US': 'Greeting' } }] });
      await manifestsRepo(h.meta, CRYPTO).setCredential(loyalty, { kind: 'api-key', secret: { apiKey: 'sk_loyalty_secret_value_0001' } });
      await addOnSettingsRepo(h.meta).patch({ manifestId: loyalty, addOnKey: 'loyalty' }, { greeting: 'Welcome back, Ada' }, [{ key: 'greeting' } as never]);
      // Attached to the dashboard, server-wide; and one nothing here uses.
      await addOn(h.meta, 'maps', '1.0.3', { attachTo: ['dashboard'] });
      await addOn(h.meta, 'unused', '3.0.0');
      // A rule's step: required.
      await addOn(h.meta, 'stock', '1.4.2');
      await automationsRepo(h.meta).create({
        connectionId: h.connectionId,
        name: 'Take stock',
        trigger: { kind: 'record', connectionId: h.connectionId, event: 'created', table: 'main.orders', watch: true } as never,
        graph: { version: 1, nodes: [{ id: 't', kind: 'trigger', title: 'Made' }, { id: 's', kind: 'action', title: 'Take', action: { kind: 'add-on.step', addOn: 'stock', step: 'take', addOnName: 'Stock', inputs: {} } }] } as never,
      });
      // A catalog app, and an app installed from a file.
      await h.stageApp(STUDIO);
      expect((await h.install('studio', '0.2.0')).statusCode).toBe(200);
      await h.stageApp(OWN);
      expect((await h.install('own-thing', '0.2.0')).statusCode).toBe(200);
      await h.introspect();

      const result = await convertToApp(await sourceOf(h), choices());
      const doc = withOtherParts(result);
      expect(doc['addOns']).toEqual({
        requires: [{ key: 'stock', range: '>=1.4.2', reason: { 'en-US': 'Used because a rule runs one of its steps.' } }],
        suggests: [
          { key: 'loyalty', range: '>=2.1.0', reason: { 'en-US': 'Used because it is installed on this database.' }, checked: true },
          { key: 'maps', range: '>=1.0.3', reason: { 'en-US': 'Used because it is attached to the dashboard.' }, checked: true },
        ],
      });
      expect(doc['apps']).toEqual({ requires: [{ publisher: 'adminium', key: 'studio', range: '>=0.2.0' }] });
      expectNoneOf(doc, ['sk_loyalty', 'Welcome back', loyalty, h.connectionId, 'own-thing', 'unused']);
      const items = result.check.map((item) => [item.group, item.code, item.item, item.field ?? '']);
      expect(items).toEqual(
        expect.arrayContaining([
          ['after', 'ADD_ON_CREDENTIALS', 'loyalty', 'credentials'],
          ['after', 'ADD_ON_SETTING', 'loyalty', 'greeting'],
          ['info', 'APP_FROM_FILE', 'Own thing', ''],
          ['info', 'APP_REQUIRED', 'Studio', ''],
        ]),
      );
      expect(result.check.find((item) => item.code === 'APP_FROM_FILE')!.message).toBe('Own thing was installed from a file. Its tables, pages and rules stay with it; save it again where it was made.');
      expectNoneOf(result.check, ['sk_loyalty', 'Welcome back']);
      expectValid(doc);

      // The target: refused until the app it needs is on that database, then installed with the required add-on attached.
      const target = await addOnHarness(dialect, { unbuiltWords: {} });
      open.push(target);
      await addOn(target.meta, 'stock', '1.4.2');
      await target.stageApp(doc);
      const refused = await target.install('corner-shop', '1.0.0');
      expect(refused.body).toContain('REQUIRED_APP_MISSING');
      await target.stageApp(STUDIO);
      expect((await target.install('studio', '0.2.0')).statusCode).toBe(200);
      await installSaved(target, doc);
      const stock = (await manifestsRepo(target.meta, CRYPTO).listByKey('stock'))[0]!;
      expect(stock.attachments.map((a) => a.attachedTo)).toContain('corner-shop');
      // No key and no setting arrived.
      expect(await target.meta.db.selectFrom('adminium_add_on_credentials').selectAll().execute()).toEqual([]);
      expect(await target.meta.db.selectFrom('adminium_add_on_settings').selectAll().execute()).toEqual([]);
    });
  });
}
