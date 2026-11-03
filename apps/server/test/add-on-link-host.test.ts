// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN APP BINDS AN ADD-ON BY A LINK INTO ITS TABLE, AND THE ADD-ON SEES THAT TABLE.
 *
 * An app's order line names the design it was made from with a column that
 * links into the add-on's own table (`addOnLink`). That makes the line's
 * table one that hands the add-on rows, as a posting or a price rule does:
 * the add-on's pages list it among their hosts (`via: 'link'`) and its tab
 * shows on its records. A table of the app with no such link is not one, and
 * a link into some other add-on does not count for this one.
 */
import { rolesRepo, usersRepo } from '@adminium/meta';
import type { AddOnManifest } from '@adminium/manifest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { handedInOf, hostTablesOf } from '../src/add-ons/host-tables.js';
import { recordTabsFor, type RecordTabsAsker } from '../src/add-ons/record-tabs.js';
import { loadAddOnInstalls } from '../src/apps/table-ref.js';
import { loadSnapshotView } from '../src/data-io/snapshot-view.js';
import { ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from './auth-helpers.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { LEGS } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Doc = Record<string, unknown>;
const IDENTITY = { manifestVersion: 1, publisher: { id: 'adminium', name: 'Adminium' }, license: 'MIT', description: { key: 'd', fallback: 'd' } };
const pk = { ref: 'id', type: 'int', role: 'pk' } as const;

/** A shop whose lines name a design of the kit, and whose notes name nothing of it. */
const SHOP: Doc = {
  ...IDENTITY,
  kind: 'app',
  key: 'shop',
  name: 'Shop',
  version: '0.3.0',
  categories: ['commerce'],
  compatibility: { minAdminiumVersion: '0.3.18' },
  pages: [{ ref: 'shop-lines', template: 'page-crud', title: { key: 't', fallback: 'Lines' }, nav: { group: 'manage', icon: 'list', order: 1 }, bindings: { main: 'lines' } }],
  frontends: [{ side: 'staff', kind: 'none' }],
  addOns: { suggests: [{ key: 'kit', range: '>=1.0.0', reason: { 'en-US': 'Designs.' } }, { key: 'other', range: '>=1.0.0', reason: { 'en-US': 'Other.' } }] },
  requiredSchema: {
    prefixed: true,
    tables: [
      { ref: 'lines', columns: [pk, { ref: 'name', type: 'text', maxLength: 80, nullable: true }, { ref: 'design_id', type: 'int', nullable: true, rules: { addOnLink: { addOn: 'kit', table: 'designs' } } }] },
      { ref: 'notes', columns: [pk, { ref: 'text', type: 'text', maxLength: 80, nullable: true }] },
      // Linked into another add-on: that one's host, not the kit's.
      { ref: 'tags', columns: [pk, { ref: 'other_id', type: 'int', nullable: true, rules: { addOnLink: { addOn: 'other', table: 'things' } } }] },
    ],
  },
};

/** The kit: its designs, and a tab listing a record's designs wherever a table hands it rows. */
const KIT: Doc = {
  ...IDENTITY,
  kind: 'add-on',
  key: 'kit',
  name: 'Kit',
  version: '1.0.0',
  categories: ['data'],
  compatibility: { minAdminiumVersion: '0.3.18' },
  addOn: {
    attaches: [{ app: 'shop', range: '*' }],
    connect: { kind: 'none' },
    recordTabs: [{ id: 'designs', label: { key: 'kit.tab', fallback: 'Designs' }, table: 'designs', match: { table: 'source_table', row: 'source_row' }, on: 'linked', columns: ['name'] }],
  },
  requiredSchema: {
    prefixed: true,
    tables: [
      {
        ref: 'designs',
        columns: [
          pk,
          { ref: 'name', type: 'text', maxLength: 80 },
          { ref: 'source_table', type: 'text', maxLength: 128, nullable: true, rules: { tableRef: true } },
          { ref: 'source_row', type: 'text', maxLength: 64, nullable: true },
        ],
      },
    ],
  },
  pages: [{ ref: 'kit-designs', template: 'page-crud', title: { key: 't', fallback: 'Designs' }, nav: { group: 'manage', icon: 'box', order: 1 }, bindings: { main: 'designs' } }],
};

describe.each(LEGS)("an app's link into an add-on's table makes its table one of the add-on's hosts — %s", (dialect, available) => {
  let h: Harness;
  let served: Served;
  let cookie: string;
  const idOf = async (name: string) => (await loadSnapshotView(h.meta, h.connectionId, { lists: true })).model.tables.find((table) => table.name === name)!.id;

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageApp(SHOP);
    expect((await h.install('shop', '0.3.0')).statusCode).toBe(200);
    await h.stageAddOn(KIT, { bundled: true });
    const added = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'kit', version: '1.0.0', attachTo: ['shop'] } });
    expect(added.statusCode, added.body).toBe(200);
    served = await servePublic(h as never, null, { ADMINIUM_DATA_DIR: h.dataDir });
    const user = await usersRepo(h.meta).create({ email: 'boss@link.dev', name: 'Boss', passwordHash: await adminPasswordHash() });
    await rolesRepo(h.meta).assignToUser(user.id, (await rolesRepo(h.meta).findBySlug('super-admin'))!.id);
    const login = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: '10.3.0.1', payload: { email: 'boss@link.dev', password: ADMIN_PASSWORD } });
    cookie = sessionCookie(login.headers['set-cookie']);
  }, 240_000);
  afterAll(async () => {
    if (!available) return;
    await served?.close();
    await h?.close();
  });

  it.skipIf(!available)('the host list names the linking table, by the link way, and no other table of the app', async () => {
    const view = await loadSnapshotView(h.meta, h.connectionId, { lists: true });
    const manifest = KIT as unknown as AddOnManifest;
    expect(hostTablesOf(view, 'kit', manifest)).toEqual([{ id: await idOf('shop_lines'), via: 'link' }]);
    expect([...handedInOf(view, 'kit', manifest)].map(([id, ways]) => [id, [...ways]])).toEqual([[await idOf('shop_lines'), ['bound']]]);
    // Another add-on's link is that add-on's: the tags table hands the kit nothing.
    expect(hostTablesOf(view, 'other', { ...manifest, key: 'other' } as AddOnManifest)).toEqual([{ id: await idOf('shop_tags'), via: 'link' }]);
  });

  it.skipIf(!available)("the add-on's page is told of it through the kit", async () => {
    const res = await served.composed.app.inject({ method: 'GET', url: '/api/v1/add-ons/kit/kit', headers: { cookie } });
    expect(res.statusCode, res.body).toBe(200);
    const hosts = (res.json() as { hosts: Doc[] }).hosts;
    expect(hosts.map((host) => ({ id: host['id'], via: host['via'] }))).toEqual([{ id: await idOf('shop_lines'), via: 'link' }]);
  });

  it.skipIf(!available)("the add-on's tab shows on the linking table's records, and on no other of the app's", async () => {
    const installs = await loadAddOnInstalls(h.meta, async () => (await loadSnapshotView(h.meta, h.connectionId, { lists: true })).model as never);
    const everything: RecordTabsAsker = { can: async () => true, permissions: { superAdmin: true } };
    const view = await loadSnapshotView(h.meta, h.connectionId, { lists: true });
    const lines = await recordTabsFor(h.meta, installs, everything, view, await idOf('shop_lines'));
    expect(lines?.map((tab) => [tab.addOn, tab.id, tab.mode])).toEqual([['kit', 'designs', 'list']]);
    expect(await recordTabsFor(h.meta, installs, everything, view, await idOf('shop_notes'))).toBeUndefined();
  });
});
