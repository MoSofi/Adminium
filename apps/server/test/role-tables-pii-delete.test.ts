// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN APP'S SCREENS-ONLY ROLE ON AN ADD-ON'S TABLES: PERSONAL COLUMNS,
 * REMOVING ROWS, AND A TABLE THE ADD-ON'S LEDGER WRITES.
 *
 * A maker at a workshop's screen reads a design's words (a personal column)
 * only with `read_pii` on the table, replaces a version's files (`delete`),
 * and makes a proof version on a table the add-on's ledger writes — where the
 * add-on allows an app's role to add rows and change its own columns
 * (`appGrants`), never a column the ledger's code writes. Each is given the
 * way the role's other grants on the add-on's tables are, and taken back with
 * them. A row the role adds there is its own, not the ledger's record: never
 * given what the ledger keeps (a hold's state, which its code moves, or the
 * link to a posting's receipt) — an add-on that offers it is refused, and the
 * role's grant is cut to fit. Proved through the data routes as the screens-only role itself, and
 * against a role of the same app that holds less. On every engine this run
 * can reach.
 */
import { parseDatabaseModel } from '@adminium/engine';
import { permissionsRepo, rolesRepo, snapshotsRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from './auth-helpers.js';
import { ledgerKitFiles, ledgerKitManifest } from './fixtures/ledger-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Doc = Record<string, unknown>;
const KIT = 'ledger-kit';

/**
 * The kit, whose `things` (written by its ledger: `name`) keep a personal
 * contact and a memo, and say what an app's role may hold; its `holds` (the
 * ledger adds them and moves their `state`) may be added to by an app's role.
 * `overreach` offers what the ledger keeps as well: a hold's state, and a
 * thing's link to its receipt.
 */
function kit(overreach = false): Doc {
  const doc = ledgerKitManifest() as Doc & { compatibility: Doc; requiredSchema: { tables: (Doc & { ref: string; columns: Doc[] })[] } };
  doc.compatibility = { ...doc.compatibility, minAdminiumVersion: '0.3.47' };
  doc.requiredSchema.tables = doc.requiredSchema.tables.map((table) => {
    if (table.ref === 'things') {
      return {
        ...table,
        columns: [...table.columns, { ref: 'contact', type: 'text', maxLength: 120, nullable: true, rules: { personal: true } }, { ref: 'memo', type: 'text', maxLength: 200, nullable: true }],
        appGrants: { actions: ['read', 'read_pii', 'create', 'update'], creatable: ['name', 'contact', 'memo', ...(overreach ? ['receipt_id'] : [])], writable: ['memo'] },
      };
    }
    if (table.ref === 'holds') return { ...table, appGrants: { actions: ['read', 'create'], creatable: ['account_id', 'amount', ...(overreach ? ['state'] : [])] } };
    if (table.ref === 'settings') return { ...table, appGrants: { actions: ['read', 'delete'] } };
    return table;
  });
  if (overreach) (doc as Doc)['version'] = '0.9.0';
  return doc;
}

const shop = (): Doc => ({
  kind: 'app',
  manifestVersion: 1,
  key: 'shop',
  name: 'Shop',
  version: '1.0.0',
  publisher: { id: 'adminium', name: 'Adminium' },
  license: 'MIT',
  description: { key: 'd', fallback: 'A shop.' },
  categories: ['commerce'],
  compatibility: { minAdminiumVersion: '0.3.47' },
  requiredSchema: { prefixed: true, tables: [{ ref: 'lines', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'name', type: 'text', maxLength: 80, nullable: true }] }] },
  pages: [{ ref: 'shop-lines', template: 'page-crud', title: { key: 't', fallback: 'Lines' }, nav: { group: 'manage', icon: 'list', order: 1 }, bindings: { main: 'lines' } }],
  frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  addOns: { suggests: [{ key: KIT, range: '*', reason: { 'en-US': 'Keeps units.' } }] },
  roles: [
    {
      key: 'maker',
      name: 'Maker',
      screensOnly: true,
      permissions: ['app:@:staff', 'table:@lines:read'],
      tables: [
        { addOn: KIT, table: 'things', actions: ['read', 'read_pii', 'create', 'update'], limit: { creatable: ['name', 'contact', 'memo'], writable: ['memo'] } },
        { addOn: KIT, table: 'settings', actions: ['read', 'delete'] },
        // Asks for a hold's state too: what the ledger keeps is cut.
        { addOn: KIT, table: 'holds', actions: ['read', 'create'], limit: { creatable: ['account_id', 'amount', 'state'] } },
      ],
    },
    // The same reads, without the personal columns or the remove, and no add or change.
    { key: 'packer', name: 'Packer', screensOnly: true, permissions: ['app:@:staff', 'table:@lines:read'], tables: [{ addOn: KIT, table: 'things', actions: ['read'] }, { addOn: KIT, table: 'settings', actions: ['read'] }] },
  ],
});

describe.each(LEGS)("an app's screens-only role: personal columns, removes and a ledger's table — %s", (dialect, available) => {
  let h: Harness;
  let served: Served;
  let things: string;
  let settings: string;
  let holds: string;
  let overreached: { statusCode: number; body: string };
  const cookies = new Map<string, string>();
  let at = 0;

  const signIn = async (role: 'maker' | 'packer'): Promise<string> => {
    const member = await usersRepo(h.meta).create({ email: `${role}@shop.dev`, name: role, passwordHash: await adminPasswordHash() });
    await rolesRepo(h.meta).assignToUser(member.id, (await rolesRepo(h.meta).findBySlug(`shop-${role}`))!.id);
    at += 1;
    const login = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.7.0.${String(at)}`, payload: { email: `${role}@shop.dev`, password: ADMIN_PASSWORD } });
    expect(login.statusCode, login.body).toBe(200);
    return sessionCookie(login.headers['set-cookie']);
  };
  const call = (who: string, method: string, url: string, payload?: Doc) =>
    served.composed.app.inject({ method: method as 'GET', url: `/api/v1/data/${h.connectionId}/${url}`, headers: { cookie: cookies.get(who)! }, ...(payload === undefined ? {} : { payload }) });

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageApp(shop());
    const installed = await h.install('shop', '1.0.0');
    expect(installed.statusCode, installed.body).toBe(200);
    // An add-on that offers an app's new row what its ledger keeps is not installed.
    const greedy = kit(true);
    await h.stageAddOn(greedy, { files: ledgerKitFiles(greedy) });
    overreached = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: KIT, version: '0.9.0', attachTo: ['shop'] } });
    const doc = kit();
    await h.stageAddOn(doc, { files: ledgerKitFiles(doc) });
    const added = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: KIT, version: '1.0.0', attachTo: ['shop'] } });
    expect(added.statusCode, added.body).toBe(200);
    await h.rows(`INSERT INTO ledger_kit_things (name, contact, memo) VALUES ('Mug for Ana', 'ana@example.com', 'first')`);
    await h.rows(`INSERT INTO ledger_kit_settings (id, show_left_below) VALUES (10, 5), (11, 6)`);
    await h.rows(`INSERT INTO ledger_kit_accounts (id, name) VALUES (1, 'Clay')`);
    const model = parseDatabaseModel((await snapshotsRepo(h.meta).latest(h.connectionId))!.schema);
    things = model.tables.find((table) => table.name === 'ledger_kit_things')!.id;
    settings = model.tables.find((table) => table.name === 'ledger_kit_settings')!.id;
    holds = model.tables.find((table) => table.name === 'ledger_kit_holds')!.id;
    served = await servePublic(h as never, null, { ADMINIUM_DATA_DIR: h.dataDir });
    cookies.set('maker', await signIn('maker'));
    cookies.set('packer', await signIn('packer'));
  }, 240_000);
  afterAll(async () => {
    if (!available) return;
    await served?.close();
    await h?.close();
  });

  it.skipIf(!available)('the grants are written on the role, with the personal read and the remove', async () => {
    const role = (await rolesRepo(h.meta).findBySlug('shop-maker'))!;
    expect(role.screensOnly).toBe(true);
    const rows = await permissionsRepo(h.meta).listForRole(role.id);
    const on = (id: string) => rows.find((row) => row.resourceRef === `${h.connectionId}/${id}`)?.actions as Doc | undefined;
    expect(on(things)).toMatchObject({ read: true, read_pii: true, create: true, update: true, delete: false, updateLimit: { writable: ['memo'] } });
    expect(on(settings)).toMatchObject({ read: true, delete: true, create: false, update: false });
  });

  it.skipIf(!available)('the maker reads the contact in clear; the packer reads it masked', async () => {
    const maker = await call('maker', 'GET', `${things}/1`);
    expect(maker.statusCode, maker.body).toBe(200);
    expect(JSON.stringify(maker.json())).toContain('ana@example.com');
    const packer = await call('packer', 'GET', `${things}/1`);
    expect(packer.statusCode, packer.body).toBe(200);
    expect(JSON.stringify(packer.json())).not.toContain('ana@example.com');
  });

  it.skipIf(!available)('the maker removes a row; the packer is refused', async () => {
    expect((await call('packer', 'DELETE', `${settings}/11`)).statusCode).toBe(403);
    const removed = await call('maker', 'DELETE', `${settings}/11`);
    expect(removed.statusCode, removed.body).toBeLessThan(300);
    expect((await h.rows('SELECT id FROM ledger_kit_settings ORDER BY id')).map((row) => Number(row['id']))).toEqual([1, 10]);
  });

  it.skipIf(!available)("on the ledger's table the maker adds a row and changes the memo, never the ledger's column", async () => {
    const made = await call('maker', 'POST', things, { values: { name: 'Proof v2', contact: 'ana@example.com', memo: 'proof' } });
    expect(made.statusCode, made.body).toBeLessThan(300);
    const changed = await call('maker', 'PATCH', `${things}/1`, { values: { memo: 'proofed' } });
    expect(changed.statusCode, changed.body).toBe(200);
    expect((await call('maker', 'PATCH', `${things}/1`, { values: { name: 'Something else' } })).statusCode).toBe(403);
    expect((await call('packer', 'POST', things, { values: { name: 'Nope' } })).statusCode).toBe(403);
    const rows = await h.rows('SELECT id, name, memo FROM ledger_kit_things ORDER BY id');
    expect(rows.map((row) => [Number(row['id']), row['name'], row['memo']])).toEqual([
      [1, 'Mug for Ana', 'proofed'],
      [2, 'Proof v2', 'proof'],
    ]);
  });

  it.skipIf(!available)("an add-on that offers a new row what its ledger keeps is refused, by the columns it names", () => {
    expect(overreached.statusCode, overreached.body).toBeGreaterThanOrEqual(400);
    expect(overreached.body).toContain('holds.state');
    expect(overreached.body).toContain('things.receipt_id');
  });

  it.skipIf(!available)("the maker adds a hold, never with the state the ledger moves nor a posting's receipt", async () => {
    const role = (await rolesRepo(h.meta).findBySlug('shop-maker'))!;
    const rows = await permissionsRepo(h.meta).listForRole(role.id);
    const onHolds = rows.find((row) => row.resourceRef === `${h.connectionId}/${holds}`)?.actions as Doc | undefined;
    expect(onHolds).toMatchObject({ read: true, create: true });
    // The state the role asked for is cut from what its new rows may be given.
    expect(JSON.stringify(onHolds?.['createLimit'])).toContain('amount');
    expect(JSON.stringify(onHolds?.['createLimit'])).not.toContain('state');
    expect((await call('maker', 'POST', holds, { values: { account_id: 1, amount: '2', state: 'taken' } })).statusCode).toBe(403);
    expect((await call('maker', 'POST', things, { values: { name: 'Forged', receipt_id: 1 } })).statusCode).toBe(403);
    const made = await call('maker', 'POST', holds, { values: { account_id: 1, amount: '2' } });
    expect(made.statusCode, made.body).toBeLessThan(300);
    expect((await h.rows('SELECT account_id, state, receipt_id FROM ledger_kit_holds')).map((row) => [Number(row['account_id']), row['state'], row['receipt_id'] ?? null])).toEqual([[1, 'held', null]]);
  });
});
