// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN APP LINKS TO A TABLE THE DATABASE ALREADY HAS.
 *
 * A loyalty app on a shop: `accounts.customer_id` points at the shop's own
 * `customers`, which the app does not declare. The install plan calls that a
 * host link and lets it through, and then the page check, which models the
 * manifest's tables alone, threw on the link it could not place: every such
 * install failed with a 500 (walkthrough finding V10), while `app check`
 * passed it.
 *
 * Now the install makes the table and its foreign key to the shop's table,
 * and a database without that table is refused by name, before anything is
 * made.
 *
 * SQLite always runs; Postgres runs with TEST_POSTGRES_URL, MySQL with
 * TEST_MYSQL_URL (`./app-install-harness.ts`).
 */
import { afterEach, describe, expect, it } from 'vitest';

import { ENGINES, installHarness, type Harness } from './app-install-harness.js';

const MANIFEST = {
  kind: 'app',
  manifestVersion: 1,
  key: 'loyalty',
  name: 'Loyalty',
  version: '0.1.0',
  publisher: { id: 'adminium', name: 'Adminium' },
  license: 'AGPL-3.0-only',
  description: { key: 'd', fallback: 'Points per customer.' },
  categories: ['operations'],
  compatibility: { minAdminiumVersion: '0.1.0' },
  requiredSchema: {
    prefixed: true,
    tables: [
      {
        ref: 'accounts',
        columns: [
          { ref: 'id', type: 'int', role: 'pk' },
          { ref: 'customer_id', type: 'fk', references: 'customers' },
          { ref: 'points', type: 'int', default: 0 },
        ],
      },
    ],
  },
  pages: [{ ref: 'loyalty-accounts', template: 'page-crud', title: { key: 't', fallback: 'Accounts' }, nav: { group: 'records', icon: 'list', order: 1 }, bindings: { rows: 'accounts' } }],
  frontends: [{ side: 'staff', kind: 'spa' }],
};

/** The shop's own table, which no install records. */
const SHOP: Record<string, string> = {
  sqlite: 'CREATE TABLE customers (id INTEGER PRIMARY KEY, name VARCHAR(80))',
  postgres: 'CREATE TABLE customers (id serial PRIMARY KEY, name varchar(80))',
  mysql: 'CREATE TABLE customers (id int NOT NULL AUTO_INCREMENT PRIMARY KEY, name varchar(80))',
};

let harness: Harness | null = null;
afterEach(async () => {
  await harness?.close();
  harness = null;
});

describe.each(ENGINES)('an app linking to a table the database has, on %s', (dialect, available) => {
  it.skipIf(!available)('installs, and the link is a foreign key to that table', async () => {
    harness = await installHarness(dialect);
    const h = harness;
    await h.run(SHOP[dialect]!);
    await h.run(`INSERT INTO customers (name) VALUES ('Ada')`);

    const reply = await h.install(MANIFEST);
    expect(reply.statusCode, reply.body).toBe(200);
    const body = JSON.parse(reply.body) as { schema: { created: string[] }; pages: { created: string[]; warnings: unknown[] } };
    expect(body.schema.created).toEqual(['loyalty_accounts']);
    expect(body.pages).toMatchObject({ created: ['loyalty-accounts'], warnings: [] });

    await h.run(`INSERT INTO loyalty_accounts (customer_id, points) VALUES (1, 10)`);
    const rows = await h.rows('SELECT customer_id, points FROM loyalty_accounts');
    expect(rows.map((r) => [Number(r['customer_id']), Number(r['points'])])).toEqual([[1, 10]]);
    if (dialect !== 'sqlite') {
      // The link is really there: an account naming no customer is refused.
      await expect(h.run(`INSERT INTO loyalty_accounts (customer_id) VALUES (999)`)).rejects.toThrow();
    }
  });

  it.skipIf(!available)('is refused by name on a database without that table, and makes nothing', async () => {
    harness = await installHarness(dialect);
    const h = harness;

    const reply = await h.install(MANIFEST);
    expect(reply.statusCode, reply.body).toBeGreaterThanOrEqual(400);
    expect(reply.statusCode, reply.body).toBeLessThan(500);
    expect(reply.body).toContain('UNRESOLVED_REFERENCE');
    expect(reply.body).toContain('points at a table called \\"customers\\"');
    await expect(h.rows('SELECT 1 FROM loyalty_accounts')).rejects.toThrow();
  });
});
