// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A menu two apps share: the planner offers an installed app's tables of a
 * shape this app declares, whatever their real names, and keeps the answer.
 *
 *  - the shop beside an installed till is offered the till's menu (its
 *    `pos_menu_*` tables), recommended, and plans its extra columns as
 *    columns added to the till's tables;
 *  - "keep a separate menu" makes the shop's own four tables;
 *  - either order: the till beside an installed shop is offered the shop's;
 *  - an alternative prefix never renames a shared table;
 *  - the first installed is recommended among several, and one app sharing
 *    another's is the same menu, offered once;
 *  - an app that already has its own tables (an update, a reinstall) is
 *    offered nothing, and one that shares goes on sharing on an update;
 *  - an update that takes the shape off a shared table is refused, naming
 *    the other app.
 */
import { describe, expect, it } from 'vitest';

import { planInstall, validateManifest, type Manifest, type PlanContext, type SchemaModelView } from '../src/index.js';
import { menuTables, orderingSharingMenu, pointOfSale, type Doc } from './menu-sharing-fixture.js';

const manifestOf = (doc: Doc): Manifest => {
  const result = validateManifest(doc);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.manifest;
};

const MENU = ['menu_categories', 'menu_items', 'modifier_groups', 'modifiers'];

/** A live table as the database reports it, from a manifest's declared columns. */
const liveTable = (name: string, columns: readonly Doc[]) => ({
  ref: name,
  columns: columns.map((c) => ({
    ref: String(c['ref']),
    nullable: c['nullable'] === true,
    ...(c['role'] === 'pk' ? { isPrimaryKey: true, isIdentity: true } : {}),
  })),
});

/** An installed app's four menu tables under `prefix`, and the records it keeps of them. */
function installedMenu(appKey: string, prefix: string, createdAt: number, state = 'created') {
  const tables = menuTables();
  return {
    live: tables.map((t) => liveTable(`${prefix}${String(t['ref'])}`, t['columns'] as Doc[])),
    others: tables.map((t) => ({ appKey, table: `${prefix}${String(t['ref'])}`, shape: 'menu@1', state, ref: String(t['ref']), createdAt })),
  };
}

const ctx = (over: Partial<PlanContext>): PlanContext => ({ prefix: 'ordering_', records: {}, others: [], dialect: 'postgres', ...over });
const model = (tables: SchemaModelView['tables']): SchemaModelView => ({ tables, dialect: 'postgres' });

describe('the shop planned beside an installed till', () => {
  const shop = manifestOf(orderingSharingMenu());
  const pos = installedMenu('pos', 'pos_', 1_000);

  it('is offered the till’s menu, recommended: its four tables under the till’s names, with the shop’s extra columns added', () => {
    const plan = planInstall(shop, model(pos.live), ctx({ others: pos.others }));
    expect(plan.problems).toEqual([]);
    expect(plan.installable).toBe(true);
    expect(plan.shareOffers).toEqual([
      {
        shape: 'menu@1',
        with: 'pos',
        candidates: ['pos'],
        action: 'share',
        tables: MENU.map((ref) => `pos_${ref}`),
        addColumns: [
          { table: 'pos_menu_items', column: 'stock_today' },
          { table: 'pos_menu_items', column: 'hue' },
        ],
      },
    ]);
    for (const ref of MENU) {
      expect(plan.names?.[ref]).toBe(`pos_${ref}`);
      expect(plan.tables?.find((t) => t.ref === ref)).toMatchObject({ class: 'shared', action: 'share', sharedWith: 'pos', shape: 'menu@1', offers: ['share', 'separate'] });
    }
    expect(plan.tables?.find((t) => t.ref === 'menu_items')?.edits).toEqual([
      { kind: 'add-column', column: 'stock_today' },
      { kind: 'add-column', column: 'hue' },
    ]);
    // The shop's own tables are its own, and its lines point at the till's menu.
    expect(plan.names?.['orders']).toBe('ordering_orders');
    expect(plan.tables?.find((t) => t.ref === 'order_items')).toMatchObject({ class: 'new', action: 'create' });
    expect(plan.reuse.map((t) => t.table)).toEqual(MENU.map((ref) => `pos_${ref}`));
  });

  it('keeps a separate menu when told to: its own four tables, nothing added to the till’s', () => {
    const plan = planInstall(shop, model(pos.live), ctx({ others: pos.others, shares: { 'menu@1': { action: 'separate' } } }));
    expect(plan.problems).toEqual([]);
    expect(plan.shareOffers?.[0]).toMatchObject({ shape: 'menu@1', with: 'pos', action: 'separate' });
    for (const ref of MENU) {
      expect(plan.names?.[ref]).toBe(`ordering_${ref}`);
      expect(plan.tables?.find((t) => t.ref === ref)).toMatchObject({ class: 'new', action: 'create', edits: [] });
    }
    expect(plan.reuse).toEqual([]);
  });

  it('never renames a shared table with an alternative prefix', () => {
    const plan = planInstall(shop, model(pos.live), ctx({ others: pos.others, altPrefix: 'shop_' }));
    expect(plan.problems).toEqual([]);
    expect(plan.names?.['menu_items']).toBe('pos_menu_items');
    expect(plan.names?.['orders']).toBe('shop_orders');
  });

  it('recommends the first installed of two menus, takes the one it is told, and refuses one it cannot see', () => {
    const kiosk = installedMenu('kiosk', 'kiosk_', 500);
    const both = { others: [...pos.others, ...kiosk.others] };
    const first = planInstall(shop, model([...pos.live, ...kiosk.live]), ctx(both));
    expect(first.shareOffers?.[0]).toMatchObject({ with: 'kiosk', candidates: ['kiosk', 'pos'] });
    expect(first.names?.['menu_items']).toBe('kiosk_menu_items');

    const told = planInstall(shop, model([...pos.live, ...kiosk.live]), ctx({ ...both, shares: { 'menu@1': { action: 'share', with: 'pos' } } }));
    expect(told.problems).toEqual([]);
    expect(told.names?.['menu_items']).toBe('pos_menu_items');
    expect(told.shareOffers?.[0]).toMatchObject({ with: 'pos', action: 'share' });

    const unknown = planInstall(shop, model(pos.live), ctx({ others: pos.others, shares: { 'menu@1': { action: 'share', with: 'clinic' } } }));
    expect(unknown.installable).toBe(false);
    expect(unknown.problems.map((p) => p.code)).toEqual(['TABLE_TAKEN']);
  });

  it('offers one menu once when a third app already shares the till’s', () => {
    const kiosk = { others: pos.others.map((o) => ({ ...o, appKey: 'kiosk', state: 'shared', createdAt: 2_000 })) };
    const plan = planInstall(shop, model(pos.live), ctx({ others: [...pos.others, ...kiosk.others] }));
    expect(plan.shareOffers?.[0]).toMatchObject({ with: 'pos', candidates: ['pos'] });
  });

  it('is offered nothing when the till lacks one of the tables the shop declares, or one is gone', () => {
    const partial = pos.others.filter((o) => o.ref !== 'modifiers');
    const plan = planInstall(shop, model(pos.live), ctx({ others: partial }));
    expect(plan.shareOffers).toBeUndefined();
    const gone = planInstall(shop, model(pos.live.filter((t) => t.ref !== 'pos_modifiers')), ctx({ others: pos.others }));
    expect(gone.shareOffers).toBeUndefined();
    // A released menu (the till uninstalled, its tables kept) is not offered either.
    const released = planInstall(shop, model(pos.live), ctx({ others: pos.others.map((o) => ({ ...o, state: 'released' })) }));
    expect(released.shareOffers).toBeUndefined();
    expect(released.names?.['menu_items']).toBe('ordering_menu_items');
  });

  it('is planned the same on every engine', () => {
    for (const dialect of ['sqlite', 'postgres', 'mysql'] as const) {
      const plan = planInstall(shop, { tables: pos.live, dialect }, ctx({ others: pos.others, dialect }));
      expect(plan.problems, dialect).toEqual([]);
      expect(plan.names?.['menu_items'], dialect).toBe('pos_menu_items');
    }
  });
});

describe('the till planned beside an installed shop', () => {
  it('is offered the shop’s menu: the released Point of Sale joins the shop’s tables', () => {
    const shopTables = (orderingSharingMenu()['requiredSchema'] as { tables: Doc[] }).tables.filter((t) => MENU.includes(String(t['ref'])));
    const live = shopTables.map((t) => liveTable(`ordering_${String(t['ref'])}`, t['columns'] as Doc[]));
    const others = shopTables.map((t) => ({ appKey: 'ordering', table: `ordering_${String(t['ref'])}`, shape: 'menu@1', state: 'created', ref: String(t['ref']), createdAt: 1 }));
    const plan = planInstall(manifestOf(pointOfSale()), model(live), ctx({ prefix: 'pos_', others }));
    expect(plan.problems).toEqual([]);
    expect(plan.shareOffers?.[0]).toMatchObject({ with: 'ordering', action: 'share', addColumns: [] });
    expect(plan.names?.['menu_items']).toBe('ordering_menu_items');
    expect(plan.names?.['tickets']).toBe('pos_tickets');
    expect(plan.references.find((r) => r.fromTable === 'ticket_items' && r.fromColumn === 'menu_item_id')).toMatchObject({ resolution: 'internal' });
  });
});

describe('an app with tables of its own here', () => {
  const shop = manifestOf(orderingSharingMenu());
  const pos = installedMenu('pos', 'pos_', 1_000);

  it('is offered nothing on an update or a reinstall: its own menu is kept, never merged', () => {
    const own = installedMenu('ordering', 'ordering_', 2_000);
    const records = Object.fromEntries(own.others.map((o) => [o.ref, { table: o.table, owned: true, state: 'created' }]));
    const plan = planInstall(shop, model([...pos.live, ...own.live]), ctx({ others: pos.others, records }));
    expect(plan.shareOffers).toBeUndefined();
    expect(plan.tables?.find((t) => t.ref === 'menu_items')).toMatchObject({ table: 'ordering_menu_items', class: 'own-leftover', action: 'reuse' });
  });

  it('goes on sharing on an update: shared, with the app that keeps the tables, never adopted', () => {
    const records = Object.fromEntries(pos.others.map((o) => [o.ref, { table: o.table, owned: false, state: 'shared' }]));
    const plan = planInstall(shop, model(pos.live), ctx({ others: pos.others, records }));
    expect(plan.problems).toEqual([]);
    expect(plan.tables?.find((t) => t.ref === 'menu_items')).toMatchObject({ table: 'pos_menu_items', class: 'shared', action: 'share', sharedWith: 'pos', offers: ['share'] });
    // With a column the new version adds, on the till's table.
    const next = manifestOf(orderingSharingMenu({ version: '0.2.1' }, [{ ref: 'spice', type: 'int', nullable: true }]));
    const updated = planInstall(next, model(pos.live), ctx({ others: pos.others, records }));
    expect(updated.tables?.find((t) => t.ref === 'menu_items')?.edits).toContainEqual({ kind: 'add-column', column: 'spice' });
    // The till gone (uninstalled, its tables kept): still shared, with nobody.
    const left = planInstall(shop, model(pos.live), ctx({ others: pos.others.map((o) => ({ ...o, state: 'released' })), records }));
    expect(left.tables?.find((t) => t.ref === 'menu_items')).toMatchObject({ class: 'shared', action: 'share' });
    expect(left.tables?.find((t) => t.ref === 'menu_items')?.sharedWith).toBeUndefined();
  });

  it('is offered the till’s menu again when it shared it, left, and comes back: never its own, never renamed', () => {
    // Uninstalled with its tables kept: the shop's records of the till's tables, released.
    const records = Object.fromEntries(pos.others.map((o) => [o.ref, { table: o.table, owned: false, state: 'released' }]));
    const plan = planInstall(shop, model(pos.live), ctx({ others: pos.others, records }));
    expect(plan.problems).toEqual([]);
    expect(plan.shareOffers?.[0]).toMatchObject({ with: 'pos', action: 'share', tables: MENU.map((ref) => `pos_${ref}`) });
    for (const ref of MENU) {
      const table = plan.tables?.find((t) => t.ref === ref);
      expect(table).toMatchObject({ table: `pos_${ref}`, class: 'shared', action: 'share', sharedWith: 'pos', offers: ['share', 'separate'] });
      expect(table?.adopted).toBeUndefined();
    }
    // Told to keep a separate menu: its own four tables.
    const separate = planInstall(shop, model(pos.live), ctx({ others: pos.others, records, shares: { 'menu@1': { action: 'separate' } } }));
    expect(separate.tables?.find((t) => t.ref === 'menu_items')).toMatchObject({ table: 'ordering_menu_items', class: 'new', action: 'create' });
    // The till gone too: the tables are nobody else's, so the shop takes them back as its leftovers.
    const alone = planInstall(shop, model(pos.live), ctx({ others: pos.others.map((o) => ({ ...o, state: 'released' })), records }));
    expect(alone.tables?.find((t) => t.ref === 'menu_items')).toMatchObject({ table: 'pos_menu_items', class: 'own-leftover', action: 'reuse' });
  });

  it('never offers to rename a table another app still uses, even when told to', () => {
    const tillRecords = Object.fromEntries(pos.others.map((o) => [o.ref, { table: o.table, owned: true, state: 'created' }]));
    const shopHolds = pos.others.map((o) => ({ ...o, appKey: 'ordering', state: 'shared' }));
    const choices = { menu_items: { action: 'rename-existing' as const, to: 'pos_menu_items_old' } };
    const plan = planInstall(manifestOf(pointOfSale()), model(pos.live), ctx({ prefix: 'pos_', others: shopHolds, records: tillRecords, choices }));
    for (const ref of MENU) expect(plan.tables?.find((t) => t.ref === ref)?.offers, ref).toEqual(['reuse', 'alt-prefix']);
    expect(plan.tables?.find((t) => t.ref === 'menu_items')).toMatchObject({ class: 'own-leftover', action: 'reuse' });
    // Nobody else on it: renaming is offered as before.
    const own = planInstall(manifestOf(pointOfSale()), model(pos.live), ctx({ prefix: 'pos_', records: tillRecords, choices }));
    expect(own.tables?.find((t) => t.ref === 'menu_items')).toMatchObject({ offers: ['reuse', 'rename-existing', 'alt-prefix'], action: 'rename-existing' });
  });

  it('refuses an update that takes the shape off a table another app shares, naming it', () => {
    const records = Object.fromEntries(pos.others.map((o) => [o.ref, { table: o.table, owned: false, state: 'shared' }]));
    const unshaped = orderingSharingMenu();
    for (const table of (unshaped['requiredSchema'] as { tables: Doc[] }).tables) delete table['shape'];
    const plan = planInstall(manifestOf(unshaped), model(pos.live), ctx({ others: pos.others, records }));
    expect(plan.installable).toBe(false);
    expect(plan.problems.filter((p) => p.code === 'SHAPE_IN_USE').map((p) => p.table)).toEqual(MENU);
    expect(plan.problems[0]?.message).toContain('"pos"');

    // The till's own update, dropping the shape while the shop shares it: refused too.
    const till = pointOfSale();
    for (const table of (till['requiredSchema'] as { tables: Doc[] }).tables) delete table['shape'];
    const tillRecords = Object.fromEntries(pos.others.map((o) => [o.ref, { table: o.table, owned: true, state: 'created' }]));
    const shopHolds = pos.others.map((o) => ({ ...o, appKey: 'ordering', state: 'shared' }));
    const refused = planInstall(manifestOf(till), model(pos.live), ctx({ prefix: 'pos_', others: shopHolds, records: tillRecords }));
    expect(refused.problems.map((p) => p.code)).toContain('SHAPE_IN_USE');
    // Keeping it: fine.
    const kept = planInstall(manifestOf(pointOfSale()), model(pos.live), ctx({ prefix: 'pos_', others: shopHolds, records: tillRecords }));
    expect(kept.problems.filter((p) => p.code === 'SHAPE_IN_USE')).toEqual([]);
  });
});
