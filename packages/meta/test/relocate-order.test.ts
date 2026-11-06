// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The copy order is the insert order. On Postgres and MySQL a foreign key is
 * checked the moment a row lands, and SQLite checks it at commit, so a table
 * copied before a table it references fails the whole move. This reads every
 * foreign key the migrations actually created, on each engine, and fails the
 * moment a new table is added to the list ahead of a table it points at.
 */

import { sql } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyMigrations, relocatableTables, type MetaDb } from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

interface ForeignKey {
  child: string;
  parent: string;
  column: string;
}

async function foreignKeys(meta: MetaDb): Promise<ForeignKey[]> {
  if (meta.dialect === 'sqlite') {
    const tables = await sql<{ name: string }>`
      select name from sqlite_master where type = 'table' and name like 'adminium_%'
    `.execute(meta.db);
    const keys: ForeignKey[] = [];
    for (const { name } of tables.rows) {
      const rows = await sql<{ table: string; from: string }>`
        select "table", "from" from pragma_foreign_key_list(${name})
      `.execute(meta.db);
      for (const row of rows.rows) keys.push({ child: name, parent: row.table, column: row.from });
    }
    return keys;
  }
  if (meta.dialect === 'postgres') {
    const rows = await sql<{ child: string; parent: string; column: string }>`
      select tc.table_name as child, ccu.table_name as parent, kcu.column_name as column
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
      join information_schema.constraint_column_usage ccu
        on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
      where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = current_schema()
    `.execute(meta.db);
    return rows.rows;
  }
  const rows = await sql<{ child: string; parent: string; column: string }>`
    select table_name as child, referenced_table_name as parent, column_name as \`column\`
    from information_schema.key_column_usage
    where table_schema = database() and referenced_table_name is not null
  `.execute(meta.db);
  return rows.rows;
}

const available = TEST_DIALECTS.filter((dialect) => dialect.available);

for (const dialect of available) {
  describe(`relocatableTables order [${dialect.name}]`, () => {
    let db: TestDb;
    beforeEach(async () => {
      db = await dialect.make();
      await applyMigrations(db.meta.db, { dialect: db.meta.dialect });
    });
    afterEach(async () => {
      await db.destroy();
    });

    it('copies every table after every table it references', async () => {
      const order = relocatableTables();
      const position = new Map<string, number>(order.map((table, index) => [table, index]));
      const keys = await foreignKeys(db.meta);
      // Not passing by vacuity: the schema is full of foreign keys.
      expect(keys.length).toBeGreaterThan(20);

      const outOfOrder: string[] = [];
      for (const key of keys) {
        const child = key.child.toLowerCase();
        const parent = key.parent.toLowerCase();
        // A self-reference is satisfied row by row within one table.
        if (child === parent) continue;
        const childAt = position.get(child);
        const parentAt = position.get(parent);
        // A table the copy skips cannot be referenced by one it copies.
        expect(childAt === undefined || parentAt !== undefined, `${child} → ${parent}`).toBe(true);
        if (childAt !== undefined && parentAt !== undefined && parentAt > childAt) {
          outOfOrder.push(`${child}.${key.column} → ${parent}`);
        }
      }
      expect(outOfOrder).toEqual([]);
    });
  });
}
