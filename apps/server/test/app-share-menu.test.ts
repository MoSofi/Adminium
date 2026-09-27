// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A menu two apps share, installed through the real installer on every
 * engine this run can reach: the released Point of Sale 0.2.2 and an online
 * shop whose four menu tables are declared with the same `menu@1` shape.
 *
 *  - the till first, then the shop: the check offers the till's menu,
 *    recommended, whatever its real names; the shop's two extra columns are
 *    added to the till's items; the shop's lines point at the till's menu;
 *    a dish the till renames reads renamed through the shop's public key;
 *  - "keep a separate menu": the shop makes its own four tables;
 *  - the shop first, then the till: the till joins the shop's menu;
 *  - uninstalling either with its tables dropped keeps the shared four,
 *    names the other app, and hands its labels to that app;
 *  - switching the till off leaves the shop's pages, role and public key on
 *    the shared menu working;
 *  - sample rows the other app's real rows use are kept on removal, and a
 *    shop's sample menu is left out of a shared menu that holds real dishes;
 *  - updating the shop keeps it sharing; an update dropping the shape is
 *    refused, naming the till.
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { parseDatabaseModel } from '@adminium/engine';
import { appTablesRepo, overridesRepo, pagesRepo, publicKeysRepo, rolesRepo, snapshotsRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { findSampleApp } from '../src/apps/sample-data.js';
import { resolveForRoles } from '../src/rbac/resolver.js';
import { buildNavTree } from '../src/routes/bootstrap/handlers.js';
import { ENGINES, installHarness, type Harness } from './app-install-harness.js';
import { writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';
import { orderingSharingMenu, pointOfSale, type Doc } from '../../../packages/manifest/test/menu-sharing-fixture.js';

const MENU = ['menu_categories', 'menu_items', 'modifier_groups', 'modifiers'];
const POS_SAMPLE = readFileSync(new URL('../../../packages/manifest/test/fixtures/released/point-of-sale-0.2.2.sample.json', import.meta.url), 'utf8');
const SLOW = 240_000;
/** The plan the shop is shown beside the till, as the dashboard's check step tests read it. */
const SHARE_PLAN = new URL('../../dashboard/src/studio/apps/__fixtures__/share-menu-plan.json', import.meta.url);

let open: Harness | null = null;
let served: Served | null = null;
afterEach(async () => {
  await served?.close();
  served = null;
  await open?.close();
  open = null;
});

type Plan = {
  installable: boolean;
  checksum: string;
  problems: { code: string; message: string }[];
  names: Record<string, string>;
  shareOffers?: Doc[];
  tables: (Doc & { ref: string; edits: Doc[] })[];
};

const bodyOf = (reply: { body: string }) => JSON.parse(reply.body) as Doc;

async function planOf(h: Harness, doc: Doc, answers: Doc = {}): Promise<Plan> {
  await h.stage(doc);
  const reply = await h.inject({ method: 'POST', url: '/apps/plan', payload: { ...answers, key: doc['key'], version: doc['version'], connectionId: h.connectionId } });
  expect(reply.statusCode, reply.body).toBe(200);
  return bodyOf(reply)['plan'] as Plan;
}

async function install(h: Harness, doc: Doc, answers: Doc = {}, files: Record<string, string> = {}): Promise<void> {
  const reply = await h.install(doc, answers, files);
  expect(reply.statusCode, reply.body).toBe(200);
}

/** The live model, as the last introspection read it. */
async function modelOf(h: Harness) {
  return parseDatabaseModel((await snapshotsRepo(h.meta).latest(h.connectionId))!.schema);
}

async function columnsOf(h: Harness, table: string): Promise<string[]> {
  return ((await modelOf(h)).tables.find((t) => t.name === table)?.columns ?? []).map((c) => c.name);
}

/** The table a declared link points at, by the real names. */
async function linkTarget(h: Harness, table: string, column: string): Promise<string | undefined> {
  const model = await modelOf(h);
  const from = model.tables.find((t) => t.name === table)!;
  const relation = model.relations.find((r) => r.from.tableId === from.id && r.from.columns.length === 1 && r.from.columns[0] === column);
  return model.tables.find((t) => t.id === relation?.to.tableId)?.name;
}

const recordsOf = async (h: Harness, key: string) =>
  Object.fromEntries((await appTablesRepo(h.meta).forInstall(h.connectionId, key)).filter((r) => r.role === 'app').map((r) => [r.ref, r]));

/** The whole server over the harness's store, answering through one app's public key. */
async function publicOf(h: Harness, appKey: string): Promise<Served> {
  const key = (await publicKeysRepo(h.meta).listManagedBy(appKey)).find((k) => k.revokedAt === null);
  expect(key, `${appKey} has a public key`).toBeDefined();
  served = await servePublic({ meta: h.meta, manager: h.manager } as unknown as InvoicingHarness, key!.id);
  return served;
}

const names = (reply: { body: string }) => ((bodyOf(reply)['data'] as Doc[]) ?? []).map((row) => row['name']);

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`a menu two apps share — ${dialect}`, () => {
    it(
      'the till first: the shop is offered the till’s menu and shares it, its extra columns added, its lines pointing at it',
      async () => {
        const h = (open = await installHarness(dialect, { superAdmin: true, full: true }));
        await install(h, pointOfSale());
        const shop = orderingSharingMenu();
        const plan = await planOf(h, shop);
        expect(plan.problems).toEqual([]);
        expect(plan.shareOffers).toEqual([
          {
            shape: 'menu@1',
            with: 'pos',
            withName: 'Point of Sale',
            candidates: [{ key: 'pos', name: 'Point of Sale' }],
            action: 'share',
            tables: MENU.map((ref) => `pos_${ref}`),
            addColumns: [
              { table: 'pos_menu_items', column: 'stock_today' },
              { table: 'pos_menu_items', column: 'hue' },
            ],
          },
        ]);
        for (const ref of MENU) {
          expect(plan.tables.find((t) => t.ref === ref)).toMatchObject({ table: `pos_${ref}`, class: 'shared', action: 'share', sharedWith: 'pos', sharedWithName: 'Point of Sale', shape: 'menu@1' });
        }
        expect(plan.tables.find((t) => t.ref === 'menu_items')?.edits).toEqual([
          { kind: 'add-column', column: 'stock_today' },
          { kind: 'add-column', column: 'hue' },
        ]);
        // The shop's public read of the menu selects a column the install adds: nothing stands in its way.
        expect((plan as unknown as { publicAccess: { endpoints: { ref: string; issues: string[] }[] } }).publicAccess.endpoints).toEqual([
          expect.objectContaining({ ref: 'pos_menu_items', issues: [] }),
        ]);
        // The check step's tests draw this very reply: the file they read is what the server answers.
        const { checksum: _checksum, ...shown } = plan;
        if (process.env['WRITE_SHARE_PLAN'] === '1') writeFileSync(SHARE_PLAN, `${JSON.stringify(shown, null, 2)}\n`);
        expect(shown).toEqual(JSON.parse(readFileSync(SHARE_PLAN, 'utf8')));

        await install(h, shop, { planChecksum: plan.checksum });
        const shopRecords = await recordsOf(h, 'ordering');
        const tillRecords = await recordsOf(h, 'pos');
        for (const ref of MENU) {
          expect(shopRecords[ref]).toMatchObject({ tableName: `pos_${ref}`, state: 'shared', shape: 'menu@1', owned: false });
          // The till's own record keeps the shape it was made with.
          expect(tillRecords[ref]).toMatchObject({ tableName: `pos_${ref}`, state: 'created', shape: 'menu@1', owned: true });
        }
        expect(tillRecords['tickets']?.shape).toBeNull();
        expect(await appTablesRepo(h.meta).realNames(h.connectionId, 'ordering')).toMatchObject({ menu_items: 'pos_menu_items', orders: 'ordering_orders' });
        expect(await columnsOf(h, 'pos_menu_items')).toEqual(expect.arrayContaining(['stock_today', 'hue']));
        expect((await columnsOf(h, 'ordering_menu_items')).length).toBe(0);
        expect(await linkTarget(h, 'ordering_order_items', 'menu_item_id')).toBe('pos_menu_items');

        // A dish the till adds and renames reads renamed through the shop's key.
        await h.run(`INSERT INTO pos_menu_items (name, price) VALUES ('Flat white', 3.5)`);
        await h.run(`UPDATE pos_menu_items SET name = 'Flat white, oat' WHERE name = 'Flat white'`);
        const shopKey = await publicOf(h, 'ordering');
        const menu = await shopKey.get('/records/pos_menu_items');
        expect(menu.statusCode, menu.body).toBe(200);
        expect(names(menu)).toEqual(['Flat white, oat']);
      },
      SLOW,
    );

    it(
      'keeps a separate menu when told: the shop’s own four tables, nothing added to the till’s',
      async () => {
        const h = (open = await installHarness(dialect, { superAdmin: true, full: true }));
        await install(h, pointOfSale());
        const answers = { shares: { 'menu@1': { action: 'separate' } } };
        const plan = await planOf(h, orderingSharingMenu(), answers);
        expect(plan.problems).toEqual([]);
        expect(plan.shareOffers?.[0]).toMatchObject({ with: 'pos', action: 'separate' });
        await install(h, orderingSharingMenu(), { ...answers, planChecksum: plan.checksum });
        for (const ref of MENU) expect((await recordsOf(h, 'ordering'))[ref]).toMatchObject({ tableName: `ordering_${ref}`, state: 'created', shape: 'menu@1' });
        expect(await columnsOf(h, 'pos_menu_items')).not.toContain('stock_today');
        expect(await columnsOf(h, 'ordering_menu_items')).toContain('stock_today');
        expect(await linkTarget(h, 'ordering_order_items', 'menu_item_id')).toBe('ordering_menu_items');
      },
      SLOW,
    );

    it(
      'the shop first: the released till is offered the shop’s menu and joins it',
      async () => {
        const h = (open = await installHarness(dialect, { superAdmin: true, full: true }));
        await install(h, orderingSharingMenu());
        const plan = await planOf(h, pointOfSale());
        expect(plan.problems).toEqual([]);
        expect(plan.shareOffers?.[0]).toMatchObject({ with: 'ordering', withName: 'Online Ordering', action: 'share', tables: MENU.map((ref) => `ordering_${ref}`), addColumns: [] });
        await install(h, pointOfSale(), { planChecksum: plan.checksum });
        expect(await appTablesRepo(h.meta).realNames(h.connectionId, 'pos')).toMatchObject({ menu_items: 'ordering_menu_items', tickets: 'pos_tickets' });
        expect(await linkTarget(h, 'pos_ticket_items', 'menu_item_id')).toBe('ordering_menu_items');
        for (const ref of MENU) expect((await recordsOf(h, 'pos'))[ref]).toMatchObject({ state: 'shared', shape: 'menu@1', owned: false });
        // The till's rules on the shop's tables are the shop's already: skipped, and said whose.
        const tables = (await modelOf(h)).tables;
        expect(tables.some((t) => t.name === 'pos_menu_items')).toBe(false);
      },
      SLOW,
    );

    it(
      'uninstalling the till with its tables dropped keeps the shared menu, names the shop, and hands the till’s labels to it',
      async () => {
        const h = (open = await installHarness(dialect, { superAdmin: true, full: true }));
        await install(h, pointOfSale());
        await install(h, orderingSharingMenu());
        // The till's rules on the four tables, as it wrote them.
        const tillRules = Object.values(await recordsOf(h, 'pos'))
          .filter((r) => MENU.includes(r.ref))
          .flatMap((r) => r.rules.map((rule) => rule.overrideId));
        expect(tillRules.length).toBeGreaterThan(0);

        const planned = await h.inject({ method: 'GET', url: '/apps/pos/uninstall-plan' });
        expect(planned.statusCode, planned.body).toBe(200);
        const tables = bodyOf(planned)['tables'] as { table: string; droppable: boolean; sharedWith?: Doc[] }[];
        for (const ref of MENU) {
          expect(tables.find((t) => t.table === `pos_${ref}`)).toEqual({ table: `pos_${ref}`, droppable: false, sharedWith: [{ key: 'ordering', name: 'Online Ordering' }] });
        }
        expect(tables.find((t) => t.table === 'pos_tickets')).toEqual({ table: 'pos_tickets', droppable: true });
        const counted = bodyOf(planned)['rules'] as number;

        const removed = await h.inject({ method: 'DELETE', url: '/apps/pos', payload: { dropTables: true, confirmKey: 'pos' } });
        expect(removed.statusCode, removed.body).toBe(200);
        const reply = bodyOf(removed) as { removed: { rules: number }; kept: { tables: string[] }; dropped: string[] };
        expect(reply.dropped).toContain('pos_tickets');
        expect(reply.dropped.filter((t) => t.startsWith('pos_menu') || t.startsWith('pos_modifier'))).toEqual([]);
        expect(reply.kept.tables).toEqual(expect.arrayContaining(MENU.map((ref) => `pos_${ref}`)));
        expect(reply.removed.rules).toBe(counted);
        const names = (await modelOf(h)).tables.map((t) => t.name);
        expect(names).toEqual(expect.arrayContaining(MENU.map((ref) => `pos_${ref}`)));
        expect(names).not.toContain('pos_tickets');
        for (const ref of MENU) expect((await recordsOf(h, 'pos'))[ref]?.state).toBe('released');

        // The till's labels stay on the four tables, now the shop's to keep.
        const active = new Set((await overridesRepo(h.meta).listForConnection(h.connectionId, { status: 'active' })).map((o) => o.id));
        const shopHolds = new Set(Object.values(await recordsOf(h, 'ordering')).flatMap((r) => r.rules.map((rule) => rule.overrideId)));
        for (const id of tillRules) {
          expect(active.has(id), id).toBe(true);
          expect(shopHolds.has(id), id).toBe(true);
        }

        // The shop reads on.
        const menu = await (await publicOf(h, 'ordering')).get('/records/pos_menu_items');
        expect(menu.statusCode, menu.body).toBe(200);
      },
      SLOW,
    );

    it(
      'uninstalling the shop that made the menu keeps it for the till that joined',
      async () => {
        const h = (open = await installHarness(dialect, { superAdmin: true, full: true }));
        await install(h, orderingSharingMenu());
        await install(h, pointOfSale());
        const removed = await h.inject({ method: 'DELETE', url: '/apps/ordering', payload: { dropTables: true, confirmKey: 'ordering' } });
        expect(removed.statusCode, removed.body).toBe(200);
        const names = (await modelOf(h)).tables.map((t) => t.name);
        expect(names).toEqual(expect.arrayContaining(MENU.map((ref) => `ordering_${ref}`)));
        expect(names).not.toContain('ordering_orders');
        expect(await linkTarget(h, 'pos_ticket_items', 'menu_item_id')).toBe('ordering_menu_items');
        // The till's labels on the menu, the shop's before, are the till's now.
        const active = await overridesRepo(h.meta).listForConnection(h.connectionId, { status: 'active' });
        const tillHolds = new Set(Object.values(await recordsOf(h, 'pos')).flatMap((r) => r.rules.map((rule) => rule.overrideId)));
        const menuIds = new Set((await modelOf(h)).tables.filter((t) => MENU.map((ref) => `ordering_${ref}`).includes(t.name)).map((t) => t.id));
        const onMenu = active.filter((o) => menuIds.has(o.tableName));
        expect(onMenu.length).toBeGreaterThan(0);
        for (const o of onMenu) expect(tillHolds.has(o.id), `${o.op} ${o.columnName ?? ''}`).toBe(true);
      },
      SLOW,
    );

    it(
      'switching the till off leaves the shop’s pages, role and public key on the shared menu working',
      async () => {
        const h = (open = await installHarness(dialect, { superAdmin: true, full: true }));
        await install(h, pointOfSale());
        await install(h, orderingSharingMenu());
        const off = await h.inject({ method: 'POST', url: '/apps/pos/disable' });
        expect(off.statusCode, off.body).toBe(200);

        // The sidebar as the bootstrap builds it: the till switched off, the shop in its own section.
        const nav = buildNavTree(await pagesRepo(h.meta).navRows(), new Map(), new Set(), 'en-US', new Set(['pos']), new Set(['ordering']));
        expect(nav.disabledApp.length).toBeGreaterThan(0);
        expect(nav.disabledApp.every((item) => item.appKey === 'pos')).toBe(true);
        // The shop's pages — its menu page over the till's table among them — are still there.
        const menuId = (await modelOf(h)).tables.find((t) => t.name === 'pos_menu_items')!.id;
        const shopPages = (nav.appItems.get('ordering') ?? []).map((entry) => entry.item);
        expect(shopPages.some((item) => item.sourceTable === menuId)).toBe(true);

        const roles = await rolesRepo(h.meta).list();
        const kitchen = roles.find((r) => r.appKey === 'ordering')!;
        const cashier = roles.find((r) => r.appKey === 'pos' && r.slug.endsWith('cashier'))!;
        expect((await resolveForRoles(h.meta, [kitchen])).grants).toContain(`table:${h.connectionId}:${menuId}:read`);
        expect((await resolveForRoles(h.meta, [cashier])).grants.size).toBe(0);

        const shop = await publicOf(h, 'ordering');
        expect((await shop.get('/records/pos_menu_items')).statusCode).toBe(200);
        const tillKey = (await publicKeysRepo(h.meta).listManagedBy('pos')).find((k) => k.revokedAt === null)!;
        await shop.useKey(tillKey.id);
        const refused = await shop.get('/records/pos_settings');
        expect(shop.codeOf(refused), refused.body).toBe('APP_DISABLED');
      },
      SLOW,
    );

    it(
      'keeps the till’s sample dish a shop order uses, and leaves the shop’s sample menu out of a menu with real dishes',
      async () => {
        const h = (open = await installHarness(dialect, { superAdmin: true, full: true }));
        await install(h, pointOfSale(), {}, { 'seeds/pos.sample.json': POS_SAMPLE });
        const shop = orderingSharingMenu({ sampleData: { file: 'seeds/ordering.sample.json', skipWhenShared: { table: 'menu_items', skip: [...MENU, 'orders', 'order_items'] } } });
        await install(h, shop, {}, { 'seeds/ordering.sample.json': JSON.stringify(SHOP_SAMPLE) });
        const samples = h.samples!;
        const till = (await findSampleApp(h.meta, 'pos'))!;
        await samples.add(till, { locale: 'en-US', userId: null, userLabel: 'test' });
        const [dish] = await h.rows(`SELECT id, category_id FROM pos_menu_items ORDER BY id`);
        const dishCount = (await h.rows(`SELECT id FROM pos_menu_items`)).length;
        expect(dishCount).toBeGreaterThan(0);

        // Only the till's sample rows are there: the shop's sample menu and orders go in with the rest.
        const shopApp = (await findSampleApp(h.meta, 'ordering'))!;
        expect((await samples.addPreview(shopApp)).tables.map((t) => t.ref)).toEqual(expect.arrayContaining(['menu_items', 'orders']));
        await samples.add(shopApp, { locale: 'en-US', userId: null, userLabel: 'test' });
        expect((await h.rows(`SELECT id FROM pos_menu_items`)).length).toBe(dishCount + 2);
        await samples.remove(shopApp, { keepChanged: false, userId: null, userLabel: 'test' });
        expect((await h.rows(`SELECT id FROM pos_menu_items`)).length).toBe(dishCount);

        // A real order of the shop's, of the till's sample dish: that dish and its category stay.
        await h.run(`INSERT INTO ordering_orders (customer_name, status) VALUES ('Ada', 'placed')`);
        const [order] = await h.rows(`SELECT id FROM ordering_orders`);
        await h.run(`INSERT INTO ordering_order_items (order_id, menu_item_id, qty) VALUES (${String(order!['id'])}, ${String(dish!['id'])}, 1)`);
        const preview = await samples.removePreview(till);
        expect(preview.kept.map((k) => k.ref)).toEqual(['menu_items']);
        await samples.remove(till, { keepChanged: false, userId: null, userLabel: 'test' });
        const left = await h.rows(`SELECT id FROM pos_menu_items`);
        expect(left.map((r) => String(r['id']))).toEqual([String(dish!['id'])]);
        expect((await h.rows(`SELECT id FROM pos_menu_categories WHERE id = ${String(dish!['category_id'])}`)).length).toBe(1);

        // Now the menu holds a real dish (kept, no longer in any sample): the shop's sample leaves the menu and orders out.
        expect((await samples.addPreview(shopApp)).tables.map((t) => t.ref)).toEqual([]);
        const added = await samples.add(shopApp, { locale: 'en-US', userId: null, userLabel: 'test' });
        expect(added.counts).toEqual({});
        expect((await h.rows(`SELECT id FROM pos_menu_items`)).length).toBe(1);
        expect((await h.rows(`SELECT id FROM ordering_orders`)).length).toBe(1);
      },
      SLOW,
    );

    it(
      'counts only the shop’s own lines against a dish’s portions: the till’s walk-in sales of it do not',
      async () => {
        const h = (open = await installHarness(dialect, { superAdmin: true, full: true }));
        await install(h, pointOfSale());
        const shop = orderingSharingMenu();
        const lines = (shop['requiredSchema'] as { tables: Doc[] }).tables.find((t) => t['ref'] === 'order_items')!;
        lines['capacity'] = { kind: 'parent', via: 'menu_item_id', size: { column: 'stock_today' }, amount: 'qty' };
        await install(h, shop);
        await h.run(`INSERT INTO pos_menu_items (name, price, stock_today) VALUES ('Funghi', 10, 2)`);
        const [dish] = await h.rows(`SELECT id FROM pos_menu_items`);
        // Three sold at the till.
        await h.run('INSERT INTO pos_tickets (opened_at) VALUES (CURRENT_TIMESTAMP)');
        const [ticket] = await h.rows(`SELECT id FROM pos_tickets`);
        for (let i = 0; i < 3; i += 1) await h.run(`INSERT INTO pos_ticket_items (ticket_id, menu_item_id) VALUES (${String(ticket!['id'])}, ${String(dish!['id'])})`);

        const w = await writerFor({ meta: h.meta, manager: h.manager, connectionId: h.connectionId, real: (ref: string) => `ordering_${ref}` } as unknown as InvoicingHarness);
        const order = await w.create('orders', { customer_name: 'Ada' });
        await w.create('order_items', { order_id: order['id'], menu_item_id: dish!['id'], qty: 2 });
        const full = await w.create('order_items', { order_id: order['id'], menu_item_id: dish!['id'], qty: 1 }).then(
          () => 'ok',
          (error: { code?: string }) => error.code,
        );
        expect(full).toBe('CAPACITY_FULL');
      },
      SLOW,
    );

    it(
      'refuses on the check a public endpoint on the shared menu under a name another app’s endpoint has',
      async () => {
        const h = (open = await installHarness(dialect, { superAdmin: true, full: true }));
        await install(h, orderingSharingMenu());
        // A second shop reading the same menu through its own key: its endpoint would take the first's name.
        const base = orderingSharingMenu();
        const kiosk = orderingSharingMenu({
          key: 'kiosk',
          name: 'Kiosk',
          roles: [],
          pages: (base['pages'] as Doc[]).map((page) => JSON.parse(JSON.stringify(page).replaceAll('ordering', 'kiosk')) as Doc),
        });
        const plan = await planOf(h, kiosk);
        expect(plan.installable).toBe(false);
        expect(plan.problems.map((p) => p.code)).toEqual(['SHARE_REF_TAKEN']);
        expect(plan.problems[0]?.message).toContain('ordering_menu_items');
        const refused = await h.inject({ method: 'POST', url: '/apps/install', payload: { key: 'kiosk', version: '0.2.0', connectionId: h.connectionId } });
        expect(refused.statusCode, refused.body).toBe(422);
        // Keeping a separate menu, it has its own endpoint name.
        const separate = await planOf(h, kiosk, { shares: { 'menu@1': { action: 'separate' } } });
        expect(separate.problems).toEqual([]);
      },
      SLOW,
    );

    it(
      'an update of the shop goes on sharing, adding its new column to the till’s table; one dropping the shape is refused, naming the till',
      async () => {
        const h = (open = await installHarness(dialect, { superAdmin: true, full: true }));
        await install(h, pointOfSale());
        await install(h, orderingSharingMenu());
        await h.stage(orderingSharingMenu({ version: '0.2.1' }, [{ ref: 'spice', type: 'int', nullable: true }]));
        const updated = await h.inject({ method: 'POST', url: '/apps/ordering/update' });
        expect(updated.statusCode, updated.body).toBe(200);
        for (const ref of MENU) expect((await recordsOf(h, 'ordering'))[ref]).toMatchObject({ tableName: `pos_${ref}`, state: 'shared', shape: 'menu@1' });
        expect(await columnsOf(h, 'pos_menu_items')).toContain('spice');

        const unshaped = orderingSharingMenu({ version: '0.2.2' });
        for (const table of (unshaped['requiredSchema'] as { tables: Doc[] }).tables) delete table['shape'];
        await h.stage(unshaped);
        const refused = await h.inject({ method: 'POST', url: '/apps/ordering/update' });
        expect(refused.statusCode, refused.body).toBe(409);
        const error = (bodyOf(refused)['error'] as { code: string; message: string });
        expect(error.code).toBe('SHAPE_IN_USE');
        expect(error.message).toContain('Point of Sale');
        for (const ref of MENU) expect((await recordsOf(h, 'ordering'))[ref]).toMatchObject({ state: 'shared', shape: 'menu@1' });
      },
      SLOW,
    );
  });
}

/** The shop's sample: two dishes in a category, and an order of one. */
const SHOP_SAMPLE = {
  format: 'adminium.sample/1',
  app: 'ordering',
  assets: {},
  tables: [
    { ref: 'menu_categories', rows: [{ '@label': 'cat:pizza', name: 'Pizza', position: 0 }] },
    {
      ref: 'menu_items',
      rows: [
        { '@label': 'item:margherita', category_id: { '@ref': 'cat:pizza' }, name: 'Margherita', price: 9 },
        { '@label': 'item:funghi', category_id: { '@ref': 'cat:pizza' }, name: 'Funghi', price: 10, stock_today: 3 },
      ],
    },
    { ref: 'orders', rows: [{ '@label': 'order:1', customer_name: 'Sample guest', status: 'placed' }] },
    { ref: 'order_items', rows: [{ order_id: { '@ref': 'order:1' }, menu_item_id: { '@ref': 'item:margherita' }, qty: 2 }] },
  ],
};
