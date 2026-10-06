// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A COLUMN THAT LINKS A ROW TO AN ADD-ON'S ROW — an order line's stock item.
 *
 * The app installs with or without the add-on: the column is there either
 * way, with no foreign key behind it. While the add-on is not there FOR THIS
 * APP (not installed; installed for another app only; removed again) the
 * link is inert: a typed code fills nothing, and a value sent for the link
 * is refused — a line that names an item nobody keeps could never be posted.
 * While it is there, a typed code finds its row, and a value must be the key
 * of a row that exists. An empty link is always taken, and an import keeps
 * whatever it names.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { WriteContext, WriteTarget } from '../src/crud/write-context.js';
import { createWriteService } from '../src/crud/write-service.js';
import { writeStores } from '../src/crud/write-stores.js';
import { normalizeWriteValue } from '../src/crud/write-values.js';
import { loadSnapshotView } from '../src/data-io/snapshot-view.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

type Doc = Record<string, unknown>;
const IDENTITY = { manifestVersion: 1, publisher: { id: 'adminium', name: 'Adminium' }, license: 'MIT', description: { key: 'd', fallback: 'd' } };
const DESK: WriteContext = { origin: 'dashboard', hops: 0, actor: { kind: 'user', id: 'usr_ivy', label: 'Ivy' }, request: null };
const IMPORT: WriteContext = { ...DESK, origin: 'import' };

/** An app whose lines name a stock item: by its key, or by a code typed beside it. */
const app = (key: string, name: string): Doc => ({
  ...IDENTITY,
  kind: 'app',
  key,
  name,
  version: '0.3.0',
  categories: ['commerce'],
  compatibility: { minAdminiumVersion: '0.3.18' },
  pages: [{ ref: `${key}-lines`, template: 'page-crud', title: { key: 't', fallback: 'Lines' }, nav: { group: 'manage', icon: 'list', order: 1 }, bindings: { main: 'lines' } }],
  frontends: [{ side: 'staff', kind: 'none' }],
  addOns: { suggests: [{ key: 'kit', range: '>=1.0.0', reason: { 'en-US': 'Stock.' } }] },
  requiredSchema: {
    prefixed: true,
    tables: [
      {
        ref: 'lines',
        columns: [
          { ref: 'id', type: 'int', role: 'pk' },
          { ref: 'name', type: 'text', maxLength: 80, nullable: true },
          { ref: 'typed', type: 'text', maxLength: 40, nullable: true },
          { ref: 'item_id', type: 'int', nullable: true, rules: { addOnLink: { addOn: 'kit', table: 'items' }, lookup: { from: 'typed', table: { addOn: 'kit', table: 'items' }, column: 'sku' } } },
        ],
      },
    ],
  },
});

const KIT: Doc = {
  ...IDENTITY,
  kind: 'add-on',
  key: 'kit',
  name: 'Kit',
  version: '1.0.0',
  categories: ['data'],
  compatibility: { minAdminiumVersion: '0.3.18' },
  addOn: { attaches: [{ app: '*', range: '*' }], connect: { kind: 'none' } },
  requiredSchema: {
    prefixed: true,
    tables: [{ ref: 'items', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'name', type: 'text', maxLength: 80 }, { ref: 'sku', type: 'text', maxLength: 40, unique: true }] }],
  },
  pages: [{ ref: 'kit-items', template: 'page-crud', title: { key: 't', fallback: 'Items' }, nav: { group: 'manage', icon: 'box', order: 1 }, bindings: { main: 'items' } }],
};

const refusal = async (run: Promise<unknown>) => {
  try {
    await run;
  } catch (error) {
    return error as { code?: string; statusCode?: number; details?: Record<string, unknown> };
  }
  throw new Error('the save went through');
};

describe.each(LEGS)('a link into an add-on\'s table — %s', (dialect, available) => {
  let h: Harness;
  const writes = () => createWriteService(writeStores(h.meta));
  /** A table of an app as a save's target, over the view every write door builds. */
  const target = async (table: string): Promise<WriteTarget> => {
    const view = await loadSnapshotView(h.meta, h.connectionId, { lists: true });
    const { db, dialect: engine } = await h.manager.data(h.connectionId);
    return { connectionId: h.connectionId, view, table: view.table(view.model.tables.find((candidate) => candidate.name === table)!.id), db, dialect: engine, timezone: 'UTC' };
  };
  const create = async (table: string, values: Doc, context = DESK) => {
    const at = await target(table);
    return writes().create({ target: at, values: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, normalizeWriteValue(at.table.columns.get(k)!, v)])), context, announce: async () => {} });
  };
  const link = async (table: string) => (await target(table)).table.table!.columns.find((column) => column.name === 'item_id')!.addOnLink;
  const install = async (manifest: Doc) => {
    await h.stageApp(manifest);
    const reply = await h.install(String(manifest['key']), '0.3.0');
    expect(reply.statusCode, reply.body).toBe(200);
  };
  const kit = async (attachTo: string[]) => {
    await h.stageAddOn(KIT, { bundled: true });
    const reply = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'kit', version: '1.0.0', attachTo } });
    expect(reply.statusCode, reply.body).toBe(200);
  };

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect);
    await install(app('shop', 'Shop'));
  }, 180_000);
  afterAll(async () => {
    if (available) await h.close();
  });

  it.skipIf(!available)('the column is there with the add-on absent: a typed code fills nothing, an empty link is taken, and a value for the link is refused', async () => {
    expect(await link('shop_lines')).toEqual({ addOn: 'kit', table: 'items', tableId: null, key: null });
    const typed = await create('shop_lines', { name: 'A tote', typed: 'TOTE-1' });
    expect(typed['item_id'] ?? null).toBeNull();
    expect((await create('shop_lines', { name: 'Nothing linked', item_id: null }))['item_id'] ?? null).toBeNull();
    const error = await refusal(create('shop_lines', { name: 'Names an item', item_id: 1 }));
    expect(error).toMatchObject({ code: 'POSTING_REFUSED', statusCode: 409, details: { reason: 'add-on-unavailable', column: 'item_id' } });
    expect(Number((await h.rows(`SELECT COUNT(*) AS n FROM shop_lines WHERE name = 'Names an item'`))[0]!['n'])).toBe(0);
  });

  it.skipIf(!available)('installed for another app only, the shop\'s link is still inert and a value for it refused', async () => {
    await install(app('till', 'Till'));
    await kit(['till']);
    expect((await link('till_lines'))?.tableId).not.toBeNull();
    expect(await link('shop_lines')).toEqual({ addOn: 'kit', table: 'items', tableId: null, key: null });
    await h.rows(`INSERT INTO kit_items (id, name, sku) VALUES (1, 'Tote', 'TOTE-1')`);
    expect(await refusal(create('shop_lines', { name: 'Names an item', item_id: 1 }))).toMatchObject({ code: 'POSTING_REFUSED', details: { reason: 'add-on-unavailable', column: 'item_id' } });
    // The till, which the add-on is there for, links to it.
    expect((await create('till_lines', { name: 'A tote', item_id: 1 }))['item_id']).toBe(1);
  });

  it.skipIf(!available)('connected to the app: a typed code fills the link, a key of a row that is there is taken, and one that is not is refused by its column', async () => {
    const attached = await h.inject({ method: 'POST', url: '/add-ons/kit/attachments', payload: { app: 'shop' } });
    expect(attached.statusCode, attached.body).toBeLessThan(300);
    expect((await link('shop_lines'))?.key).toBe('id');
    // A code is compared as a code: case, spaces and dashes aside.
    expect((await create('shop_lines', { name: 'By code', typed: 'tote 1' }))['item_id']).toBe(1);
    expect((await create('shop_lines', { name: 'By key', item_id: 1 }))['item_id']).toBe(1);
    const missing = await refusal(create('shop_lines', { name: 'No such item', item_id: 999 }));
    expect(missing).toMatchObject({ code: 'VALIDATION_FAILED', statusCode: 422, details: { fields: { item_id: { code: 'not-found' } } } });
    expect(Number((await h.rows(`SELECT COUNT(*) AS n FROM shop_lines WHERE name = 'No such item'`))[0]!['n'])).toBe(0);
    // A change is held to it like a create; an empty link is always taken.
    const id = (await create('shop_lines', { name: 'Later' }))['id'];
    const at = await target('shop_lines');
    expect(await refusal(writes().update({ target: at, pk: { id }, values: { item_id: 999 }, context: DESK, announce: async () => {} }))).toMatchObject({ details: { fields: { item_id: { code: 'not-found' } } } });
    await writes().update({ target: at, pk: { id }, values: { item_id: 1 }, context: DESK, announce: async () => {} });
    await writes().update({ target: at, pk: { id }, values: { item_id: null }, context: DESK, announce: async () => {} });
    expect((await h.rows(`SELECT item_id FROM shop_lines WHERE id = ${String(id)}`))[0]!['item_id'] ?? null).toBeNull();
    // Rows made many at once are held to it row by row; an import keeps a link to a row that is gone.
    const many = await writes().check('create', at, DESK, [{ name: 'One', item_id: 1 }, { name: 'Two', item_id: 999 }]);
    expect(many.issues).toEqual([null, { item_id: { code: 'not-found' } }]);
    const history = await writes().check('create', at, IMPORT, [{ name: 'Old', item_id: 999 }], { capacity: 'unchecked' });
    expect(history.issues).toEqual([null]);
  });

  it.skipIf(!available)('removed again, the link is inert, the rows keep what they named, and a new value is refused', async () => {
    const before = (await h.rows(`SELECT name, item_id FROM shop_lines WHERE item_id IS NOT NULL ORDER BY id`)).map((row) => `${String(row['name'])}:${String(row['item_id'])}`);
    expect(before.length).toBeGreaterThan(0);
    const gone = await h.inject({ method: 'DELETE', url: '/add-ons/kit', payload: {} });
    expect(gone.statusCode, gone.body).toBeLessThan(300);
    expect(await link('shop_lines')).toEqual({ addOn: 'kit', table: 'items', tableId: null, key: null });
    expect((await h.rows(`SELECT name, item_id FROM shop_lines WHERE item_id IS NOT NULL ORDER BY id`)).map((row) => `${String(row['name'])}:${String(row['item_id'])}`)).toEqual(before);
    expect(await refusal(create('shop_lines', { name: 'After', item_id: 1 }))).toMatchObject({ code: 'POSTING_REFUSED', details: { reason: 'add-on-unavailable', column: 'item_id' } });
    // A row that names an item from before may still be changed where the link is left alone.
    const kept = (await h.rows(`SELECT id FROM shop_lines WHERE item_id IS NOT NULL ORDER BY id`))[0]!['id'];
    await writes().update({ target: await target('shop_lines'), pk: { id: kept }, values: { name: 'Renamed' }, context: DESK, announce: async () => {} });
    expect((await h.rows(`SELECT name, item_id FROM shop_lines WHERE id = ${String(kept)}`))[0]).toMatchObject({ name: 'Renamed', item_id: 1 });
  });
});
