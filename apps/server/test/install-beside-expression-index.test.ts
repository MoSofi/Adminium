// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN APP AND ITS ADD-ON INSTALLED INTO A DATABASE THAT ALREADY KEEPS AN
 * EXPRESSION INDEX.
 *
 * A connected database may hold an index over an expression rather than over
 * columns: `CREATE UNIQUE INDEX … ON customers ((lower(email)))`, one address
 * however it is typed. Read back, it names no column, and a set of columns
 * kept unique that names none is no set at all: the install reads it as no
 * unique key, keeps installing, and leaves the index exactly as it was.
 *
 * On every engine this run reaches that has expression indexes (MySQL and
 * Postgres), through the real installer.
 */
import { parseDatabaseModel } from '@adminium/engine';
import { snapshotsRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { DESIGN_KIT, DESIGN_KIT_FILES, designKitManifest, designShopManifest } from './fixtures/design-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';

let h: Harness | null = null;
afterEach(async () => {
  await h?.close();
  h = null;
});

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available || dialect === 'sqlite')(`an install beside an expression index, on ${dialect}`, () => {
    it('installs, reads the index as no unique set of columns, and leaves it as it was', async () => {
      h = await addOnHarness(dialect, { unbuiltWords: {} });
      // A table of the connected database's own, its addresses unique however they are typed.
      if (dialect === 'mysql') {
        await h.rows('CREATE TABLE customers (id INT PRIMARY KEY, email VARCHAR(190) NOT NULL, name VARCHAR(80) NULL)');
        await h.rows('CREATE UNIQUE INDEX customers_email_lower ON customers ((lower(email)))');
        await h.rows('CREATE INDEX customers_name_email ON customers (name, (lower(email)))');
      } else {
        await h.rows('CREATE TABLE customers (id INT PRIMARY KEY, email VARCHAR(190) NOT NULL, name VARCHAR(80) NULL)');
        await h.rows('CREATE UNIQUE INDEX customers_email_lower ON customers ((lower(email)))');
        await h.rows('CREATE INDEX customers_name_email ON customers (name, (lower(email)))');
      }
      await h.rows(`INSERT INTO customers (id, email, name) VALUES (1, 'Ana@Example.test', 'Ana')`);

      await h.stageAddOn(designKitManifest({}, { panel: true }) as Record<string, unknown>, { files: DESIGN_KIT_FILES });
      await h.stageApp(designShopManifest('printing', { addOns: { suggests: [{ key: DESIGN_KIT, range: '^1.0.0', reason: { 'en-US': 'Shoppers design their products.' } }] }, people: undefined }));
      const installed = await h.install('printing', '1.0.0', { addOns: [{ key: DESIGN_KIT, version: '1.0.0' }] });
      expect(installed.statusCode, installed.body).toBe(200);

      // Read back: the expression index is there, as an expression, and no unique set of columns stands for it.
      const model = parseDatabaseModel((await snapshotsRepo(h.meta).latest(h.connectionId))!.schema);
      const customers = model.tables.find((table) => table.name === 'customers')!;
      expect(customers.uniques.every((unique) => unique.columns.length > 0)).toBe(true);
      expect(customers.uniques.map((unique) => unique.name)).not.toContain('customers_email_lower');
      const lower = customers.indexes.find((index) => index.name === 'customers_email_lower')!;
      expect(lower).toMatchObject({ unique: true, columns: [] });
      expect(lower.expression).toMatch(/lower/i);
      // An index of a column and an expression keeps its column, and says it reads an expression too.
      const mixed = customers.indexes.find((index) => index.name === 'customers_name_email')!;
      expect(mixed.columns).toEqual(['name']);
      expect(mixed.expression).toMatch(/lower/i);
      expect(customers.columns.find((column) => column.name === 'email')!.isUnique).toBe(false);

      // The index still holds: the same address in another case is refused, and the row is as it was.
      await expect(h.rows(`INSERT INTO customers (id, email) VALUES (2, 'ana@example.TEST')`)).rejects.toBeTruthy();
      expect(await h.rows('SELECT id, email FROM customers ORDER BY id')).toEqual([{ id: 1, email: 'Ana@Example.test' }]);
    }, 240_000);
  });
}
