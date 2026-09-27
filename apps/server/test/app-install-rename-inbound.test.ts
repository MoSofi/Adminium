// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN APP MOVES THE OPERATOR'S TABLE ASIDE, AND THE TABLES THAT LINK TO IT.
 *
 * The operator's database already has `orders`, and `order_details` links to
 * it by `order_id` (Northwind's shape). The ordering app wants a table called
 * `orders` too, so the operator renames theirs out of the way
 * (`rename-existing` → `northwind_orders`). Their `order_details` must still
 * link to THEIR orders — the database's foreign key follows the rename — and
 * the app's own `order_items` must link to the app's new `orders` by its `id`.
 *
 * It did not: the install created the app's tables from the tables it had
 * read BEFORE the rename, where `orders` was still the operator's, keyed by
 * `order_id` — so `order_items.order_id` was made to point at a column the
 * app's `orders` has not got. Postgres and MySQL refused the table; SQLite
 * made it and the pages step then stopped on the broken link.
 *
 * SQLite always runs; Postgres runs with TEST_POSTGRES_URL, MySQL with
 * TEST_MYSQL_URL (`./app-install-harness.ts`).
 */
import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';
import { snapshotsRepo } from '@adminium/meta';
import type { DatabaseModel } from '@adminium/engine';

import { ENGINES, installHarness, type Harness } from './app-install-harness.js';

const ORDERING = JSON.parse(
  readFileSync(new URL('../../../packages/manifest/test/fixtures/released/online-ordering-0.1.3.manifest.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;

/** The operator's own tables: orders keyed by `order_id`, and the lines that link to them. */
const NORTHWIND: Record<string, string[]> = {
  sqlite: [
    'CREATE TABLE orders (order_id INTEGER PRIMARY KEY, customer_id VARCHAR(5), order_date DATE)',
    'CREATE TABLE order_details (order_id INTEGER NOT NULL REFERENCES orders (order_id), product_id INTEGER NOT NULL, quantity INTEGER NOT NULL, PRIMARY KEY (order_id, product_id))',
  ],
  postgres: [
    'CREATE TABLE orders (order_id integer PRIMARY KEY, customer_id varchar(5), order_date date)',
    'CREATE TABLE order_details (order_id integer NOT NULL REFERENCES orders (order_id), product_id integer NOT NULL, quantity integer NOT NULL, PRIMARY KEY (order_id, product_id))',
  ],
  mysql: [
    'CREATE TABLE orders (order_id int PRIMARY KEY, customer_id varchar(5), order_date date)',
    'CREATE TABLE order_details (order_id int NOT NULL, product_id int NOT NULL, quantity int NOT NULL, PRIMARY KEY (order_id, product_id), FOREIGN KEY (order_id) REFERENCES orders (order_id))',
  ],
};

let harness: Harness | null = null;
afterEach(async () => {
  await harness?.close();
  harness = null;
});

describe.each(ENGINES)('renaming the operator\'s table out of an app\'s way, on %s', (dialect, available) => {
  it.skipIf(!available)('keeps the tables that link to it linked to it', async () => {
    harness = await installHarness(dialect);
    const h = harness;
    for (const statement of NORTHWIND[dialect]!) await h.run(statement);
    await h.run(`INSERT INTO orders (order_id, customer_id) VALUES (10248, 'VINET')`);
    await h.run('INSERT INTO order_details (order_id, product_id, quantity) VALUES (10248, 11, 12)');

    const reply = await h.install(ORDERING, { choices: { orders: { action: 'rename-existing', to: 'northwind_orders' } } });
    expect(reply.statusCode, reply.body).toBe(200);

    // The operator's rows moved with their table, and the lines still reach them.
    const [kept] = await h.rows('SELECT d.quantity AS quantity, o.customer_id AS customer_id FROM order_details d JOIN northwind_orders o ON o.order_id = d.order_id');
    expect(kept).toMatchObject({ customer_id: 'VINET' });
    expect(Number(kept!['quantity'])).toBe(12);

    // The schema Adminium keeps says so too: the lines point at the renamed table, not the app's.
    const snapshot = await snapshotsRepo(h.meta).latest(h.connectionId);
    const model = snapshot!.schema as DatabaseModel;
    const idOf = (name: string) => model.tables.find((t) => t.name === name)!.id;
    const inbound = model.relations.filter((r) => r.through === null && r.from.tableId === idOf('order_details'));
    expect(inbound.map((r) => ({ to: r.to.tableId, columns: r.to.columns }))).toEqual([{ to: idOf('northwind_orders'), columns: ['order_id'] }]);
    expect(model.relations.some((r) => r.to.tableId === idOf('orders') && r.to.columns.includes('order_id'))).toBe(false);
    // The app's lines link to the app's orders.
    const lines = model.relations.find((r) => r.through === null && r.from.tableId === idOf('order_items') && r.from.columns[0] === 'order_id');
    expect(lines?.to.tableId).toBe(idOf('orders'));
    expect(lines?.to.columns).toEqual(['id']);
  }, 120_000);

  it.skipIf(!available)('does the same when an update brings the table and a link to it', async () => {
    harness = await installHarness(dialect);
    const h = harness;
    const v1 = {
      kind: 'app',
      manifestVersion: 1,
      key: 'notes',
      name: 'Notes',
      version: '1.0.0',
      publisher: { id: 'adminium', name: 'Adminium' },
      license: 'AGPL-3.0-only',
      description: { key: 'd', fallback: 'Notes.' },
      categories: ['operations'],
      compatibility: { minAdminiumVersion: '0.1.0' },
      requiredSchema: { tables: [{ ref: 'notes', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'body', type: 'text', maxLength: 200 }] }] },
      pages: [{ ref: 'notes', template: 'page-crud', title: { key: 't', fallback: 'Notes' }, nav: { group: 'records', icon: 'list', order: 1 }, bindings: { rows: 'notes' } }],
      frontends: [{ side: 'staff', kind: 'spa' }],
    };
    expect((await h.install(v1)).statusCode).toBe(200);
    // The operator makes a `tags` table of their own, keyed by `tag_id`.
    await h.run(`CREATE TABLE tags (tag_id ${dialect === 'mysql' ? 'int' : 'integer'} PRIMARY KEY, word varchar(20))`);
    const v2 = {
      ...v1,
      version: '1.1.0',
      requiredSchema: {
        tables: [
          ...v1.requiredSchema.tables,
          { ref: 'tags', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'label', type: 'text', maxLength: 40 }] },
          { ref: 'note_tags', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'tag_id', type: 'fk', references: 'tags' }] },
        ],
      },
    };
    await h.stage(v2);
    const choices = { tags: { action: 'rename-existing', to: 'tags_2019' } };
    const planned = await h.inject({ method: 'POST', url: '/apps/plan', payload: { key: 'notes', version: '1.1.0', connectionId: h.connectionId, choices } });
    expect(planned.statusCode, planned.body).toBe(200);
    const checksum = (JSON.parse(planned.body) as { plan: { checksum: string } }).plan.checksum;
    const updated = await h.inject({ method: 'POST', url: '/apps/notes/update', payload: { choices, planChecksum: checksum } });
    expect(updated.statusCode, updated.body).toBe(200);

    await h.run(`INSERT INTO tags (id, label) VALUES (1, 'urgent')`);
    await h.run('INSERT INTO note_tags (tag_id) VALUES (1)');
    const model = (await snapshotsRepo(h.meta).latest(h.connectionId))!.schema as DatabaseModel;
    const idOf = (name: string) => model.tables.find((t) => t.name === name)!.id;
    const link = model.relations.find((r) => r.through === null && r.from.tableId === idOf('note_tags'));
    expect({ to: link?.to.tableId, columns: link?.to.columns }).toEqual({ to: idOf('tags'), columns: ['id'] });
  }, 120_000);
});
