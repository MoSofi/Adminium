// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN APP REUSES A TABLE WHOSE KEY IT NUMBERS, AND A NEW TABLE LINKS TO IT.
 *
 * The operator already has `customers`, keyed by a plain `int` that does not
 * number itself. The app reuses it — so the install makes that key number
 * itself — and creates `orders`, which links to it. MySQL refuses to change a
 * column a foreign key points at ("Cannot change column 'id': used in a foreign
 * key constraint"), and the install created `orders` and its link FIRST, then
 * altered the key: every such install failed there, halfway.
 *
 * The key is now altered before any new table links to it. On every engine the
 * install succeeds, a customer added without an id is numbered, and an order
 * links to it (Postgres and MySQL refuse an order naming no customer).
 *
 * Only a change to a column the table already has goes before the new tables.
 * The columns the app adds to it come after, and so do the unique sets, which
 * may name one of them: a set made before its column is refused. The second
 * case numbers the key AND adds an email kept unique with the name.
 *
 * SQLite always runs; Postgres runs with TEST_POSTGRES_URL, MySQL with
 * TEST_MYSQL_URL (`./app-install-harness.ts`).
 */
import { afterEach, describe, expect, it } from 'vitest';

import { ENGINES, installHarness, type Harness } from './app-install-harness.js';

const MANIFEST = {
  kind: 'app',
  manifestVersion: 1,
  key: 'shop',
  name: 'Shop',
  version: '1.0.0',
  publisher: { id: 'adminium', name: 'Adminium' },
  license: 'AGPL-3.0-only',
  description: { key: 'd', fallback: 'A shop.' },
  categories: ['operations'],
  compatibility: { minAdminiumVersion: '0.1.0' },
  requiredSchema: {
    tables: [
      { ref: 'customers', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'name', type: 'text', maxLength: 80 }] },
      {
        ref: 'orders',
        columns: [
          { ref: 'id', type: 'int', role: 'pk' },
          { ref: 'customer_id', type: 'fk', references: 'customers' },
          { ref: 'total', type: 'money', default: 0 },
        ],
      },
    ],
  },
  pages: [{ ref: 'orders', template: 'page-crud', title: { key: 't', fallback: 'Orders' }, nav: { group: 'records', icon: 'list', order: 1 }, bindings: { rows: 'orders' } }],
  frontends: [{ side: 'staff', kind: 'spa' }],
};

/** The operator's own table: an `int` key that does not number itself. */
const HAND_MADE: Record<string, string> = {
  // `INT`, not `INTEGER`: only the latter is SQLite's self-numbering rowid alias.
  sqlite: 'CREATE TABLE customers (id INT NOT NULL PRIMARY KEY, name VARCHAR(80))',
  postgres: 'CREATE TABLE customers (id integer NOT NULL PRIMARY KEY, name varchar(80))',
  mysql: 'CREATE TABLE customers (id int NOT NULL PRIMARY KEY, name varchar(80))',
};

let harness: Harness | null = null;
afterEach(async () => {
  await harness?.close();
  harness = null;
});

describe.each(ENGINES)('reusing a table whose key the app numbers, on %s', (dialect, available) => {
  it.skipIf(!available)('numbers the key before a new table links to it', async () => {
    harness = await installHarness(dialect);
    const h = harness;
    await h.run(HAND_MADE[dialect]!);

    const reply = await h.install(MANIFEST, { choices: { customers: { action: 'reuse' } } });
    expect(reply.statusCode, reply.body).toBe(200);

    await h.run(`INSERT INTO customers (name) VALUES ('Ada')`);
    const [ada] = await h.rows(`SELECT id FROM customers WHERE name = 'Ada'`);
    expect(Number(ada!['id'])).toBe(1);

    await h.run(`INSERT INTO orders (customer_id) VALUES (1)`);
    const [order] = await h.rows('SELECT id, customer_id FROM orders');
    expect(Number(order!['id'])).toBe(1);
    expect(Number(order!['customer_id'])).toBe(1);
    if (dialect !== 'sqlite') {
      // The link is really there: an order naming no customer is refused.
      await expect(h.run(`INSERT INTO orders (customer_id) VALUES (999)`)).rejects.toThrow();
    }
  });

  it.skipIf(!available)('numbers the key first, then adds a column and the set over it', async () => {
    harness = await installHarness(dialect);
    const h = harness;
    await h.run(HAND_MADE[dialect]!);
    await h.run(`INSERT INTO customers (id, name) VALUES (1, 'Ada')`);
    const [customers, orders] = MANIFEST.requiredSchema.tables;
    const manifest = {
      ...MANIFEST,
      requiredSchema: {
        tables: [
          {
            ...customers!,
            columns: [...customers!.columns, { ref: 'email', type: 'text', maxLength: 200, nullable: true }],
            unique: [['name', 'email']],
          },
          orders!,
        ],
      },
    };

    const reply = await h.install(manifest, { choices: { customers: { action: 'reuse' } } });
    expect(reply.statusCode, reply.body).toBe(200);

    await h.run(`INSERT INTO customers (name, email) VALUES ('Bo', 'bo@x.io')`);
    const [bo] = await h.rows(`SELECT id FROM customers WHERE name = 'Bo'`);
    expect(Number(bo!['id'])).toBe(2);
    // The set is there: the same name and email twice is refused, another email is not.
    await expect(h.run(`INSERT INTO customers (name, email) VALUES ('Bo', 'bo@x.io')`)).rejects.toThrow();
    await h.run(`INSERT INTO customers (name, email) VALUES ('Bo', 'bo@y.io')`);
    await h.run(`INSERT INTO orders (customer_id) VALUES (2)`);
    expect((await h.rows('SELECT customer_id FROM orders')).map((r) => Number(r['customer_id']))).toEqual([2]);
  });
});
