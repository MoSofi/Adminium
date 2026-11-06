// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A self-made app's table under the real name a person gave it, and in its own
 * Postgres schema: who may say so, which names and schemas are
 * refused, how the plan names the table, and the names of its constraints.
 */
import { describe, expect, it } from 'vitest';

import {
  INSTALL_FLOOR_WORD_NAMES,
  SUPABASE_SCHEMAS,
  WORD_FLOORS,
  foreignKeyName,
  indexSetName,
  installFloorWords,
  planInstall,
  plainIndexName,
  realTableName,
  splitTableName,
  tableSchemaIssue,
  uniqueColumnName,
  uniqueSetName,
  validateManifest,
  type Manifest,
  type PlanContext,
  type SchemaModelView,
} from '../src/index.js';

type Doc = Record<string, unknown>;

/** A self-made shop: customers in `public`, their orders in `sales`. */
function shop(over: Doc = {}, tables?: Doc[]): Doc {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'shop',
    name: 'Shop',
    version: '1.0.0',
    publisher: { id: 'local', name: 'Made here' },
    license: 'AGPL-3.0-only',
    description: { key: 'd', fallback: 'A shop.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.3.49' },
    requiredSchema: {
      tables: tables ?? [
        { ref: 'customers', name: 'Our "Customers"', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'name', type: 'text', maxLength: 80 }] },
        {
          ref: 'orders',
          name: 'Order Lines',
          schema: 'sales',
          columns: [
            { ref: 'id', type: 'int', role: 'pk' },
            { ref: 'customer_id', type: 'fk', references: 'customers', nullable: true },
          ],
        },
      ],
    },
    pages: [{ ref: 'customers', template: 'page-crud', title: { key: 't', fallback: 'Customers' }, nav: { group: 'records', icon: 'list', order: 1 }, bindings: { rows: 'customers' } }],
    frontends: [{ side: 'staff', kind: 'none' }],
    ...over,
  };
}

const local = (m: Doc) => validateManifest(m, { allowLocalPublisher: true });
const issues = (m: Doc): string => {
  const result = local(m);
  return result.ok ? '' : result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n');
};
const table = (over: Doc): Doc => ({ ref: 't', columns: [{ ref: 'id', type: 'int', role: 'pk' }], ...over });

describe("a table's real name and schema in the file", () => {
  it('are taken from a self-made app', () => {
    expect(issues(shop())).toBe('');
  });

  it('are refused on an app of any other publisher, and on an add-on', () => {
    const text = issues(shop({ publisher: { id: 'adminium', name: 'Adminium' } }));
    expect(text).toContain('requiredSchema.tables.0.name: "name" is carried only by a self-made app');
    expect(text).toContain('requiredSchema.tables.1.schema: "schema" is carried only by a self-made app');
  });

  it('are refused beside a prefix, which names every table itself', () => {
    const m = shop();
    (m['requiredSchema'] as Doc)['prefixed'] = true;
    expect(issues(m)).toContain('a prefixed app names its tables itself: "customers" gives no name');
    expect(issues(m)).toContain('"orders" gives no schema');
  });

  it('refuse names no database keeps apart, and Adminium\'s own', () => {
    const named = (name: unknown) => issues(shop({}, [table({ name })]));
    expect(named('')).toContain('1 to 63 bytes');
    expect(named('x'.repeat(64))).toContain('1 to 63 bytes');
    // 21 three-byte letters are 63 bytes; 22 are too many.
    expect(named('€'.repeat(21))).toBe('');
    expect(named('€'.repeat(22))).toContain('1 to 63 bytes');
    expect(named('a\u0000b')).toContain('no NUL');
    expect(named(' Orders')).toContain('neither starts nor ends with a space');
    expect(named('Orders ')).toContain('neither starts nor ends with a space');
    expect(named('sales.orders')).toContain('no dot');
    expect(named('Sales As Of May')).toContain('" as "');
    expect(named('adminium_users')).toContain("Adminium's own namespace");
    expect(named('ADMINIUM_Users')).toContain("Adminium's own namespace");
    expect(named('Orders, "2026"')).toBe('');
  });

  it('refuse the database\'s own schemas and Adminium\'s', () => {
    const in_ = (schema: string) => issues(shop({}, [table({ schema })]));
    for (const schema of ['pg_catalog', 'information_schema', 'pg_toast', 'pg_temp_3', 'pg_toast_temp_3', 'PG_Catalog', 'Information_Schema']) {
      expect(in_(schema), schema).toContain("the database's own schema");
    }
    expect(in_('adminium_demo')).toContain("Adminium's own namespace");
    expect(in_('a.b')).toContain('no dot');
    expect(in_('sales')).toBe('');
  });

  it('refuse the schemas Supabase keeps for its own services', () => {
    const in_ = (schema: string) => issues(shop({}, [table({ schema })]));
    for (const schema of [...SUPABASE_SCHEMAS, 'Auth', 'STORAGE', 'supabase_admin']) {
      expect(in_(schema), schema).toContain('a schema Supabase keeps for its own services');
    }
    expect(tableSchemaIssue('auth')).toBe('"auth" is a schema Supabase keeps for its own services');
    // A name that only starts like one is a business's own.
    expect(in_('authors')).toBe('');
    expect(in_('storage_rooms')).toBe('');
    expect(in_('public')).toBe('');
    expect(in_('a.b')).toContain('no dot');
    expect(in_('sales')).toBe('');
  });

  it('refuse two tables that are one where case is ignored', () => {
    expect(issues(shop({}, [table({ ref: 'a', name: 'Orders' }), table({ ref: 'b', name: 'orders' })]))).toContain('"b" and "a" are one table to a database that ignores case');
    // A name against another table's ref.
    expect(issues(shop({}, [table({ ref: 'orders' }), table({ ref: 'b', name: 'ORDERS' })]))).toContain('"b" and "orders" are one table');
    // The same name in two schemas is two tables.
    expect(issues(shop({}, [table({ ref: 'a', name: 'Orders', schema: 'sales' }), table({ ref: 'b', name: 'Orders' })]))).toBe('');
  });

  it('are words read from 0.3.49, found where the document writes them', () => {
    for (const word of ['table.name', 'table.schema'] as const) {
      expect(INSTALL_FLOOR_WORD_NAMES).toContain(word);
      expect(WORD_FLOORS[word]).toBe('0.3.49');
    }
    const found = installFloorWords(shop()).filter((word) => word.word.startsWith('table.'));
    expect(found).toEqual([
      { word: 'table.name', path: 'requiredSchema.tables.0.name' },
      { word: 'table.name', path: 'requiredSchema.tables.1.name' },
      { word: 'table.schema', path: 'requiredSchema.tables.1.schema' },
    ]);
    expect(issues(shop({ compatibility: { minAdminiumVersion: '0.3.45' } }))).toContain('"table.name" is read by Adminium 0.3.49 and later');
  });
});

describe('the real table string', () => {
  it('is the name, in its schema, else the prefixed or plain ref', () => {
    expect(realTableName({ ref: 'orders', name: 'Order Lines', schema: 'sales' }, null)).toBe('sales.Order Lines');
    expect(realTableName({ ref: 'orders', name: 'Order Lines' }, 'pos_')).toBe('Order Lines');
    expect(realTableName({ ref: 'orders', schema: 'sales' }, null)).toBe('sales.orders');
    expect(realTableName({ ref: 'orders' }, 'pos_')).toBe('pos_orders');
    expect(splitTableName('sales.Order Lines')).toEqual({ schema: 'sales', name: 'Order Lines' });
    expect(splitTableName('pos_orders')).toEqual({ schema: null, name: 'pos_orders' });
  });
});

describe('the plan of tables under their own names', () => {
  const m = (doc: Doc = shop()): Manifest => {
    const result = local(doc);
    if (!result.ok) throw new Error(result.issues.map((issue) => issue.message).join('\n'));
    return result.manifest;
  };
  const ctx = (over: Partial<PlanContext> = {}): PlanContext => ({ prefix: null, records: {}, others: [], dialect: 'postgres', ...over });
  const view = (refs: string[] = []): SchemaModelView => ({ tables: refs.map((ref) => ({ ref, columns: [{ ref: 'id', isPrimaryKey: true }] })) });

  it('names each table as the file does, in its schema', () => {
    const plan = planInstall(m(), view(), ctx());
    expect(plan.problems).toEqual([]);
    expect(plan.names).toEqual({ customers: 'Our "Customers"', orders: 'sales.Order Lines' });
    expect(plan.create.map((t) => t.table)).toEqual(['Our "Customers"', 'sales.Order Lines']);
  });

  it('finds its own tables again: reused, nothing made', () => {
    const records = { customers: { table: 'Our "Customers"', owned: true, state: 'created' }, orders: { table: 'sales.Order Lines', owned: true, state: 'created' } };
    const plan = planInstall(m(), view(['Our "Customers"', 'sales.Order Lines']), ctx({ records }));
    expect(plan.problems).toEqual([]);
    expect(plan.create).toEqual([]);
    expect(plan.tables?.map((t) => [t.table, t.class, t.action])).toEqual([
      ['Our "Customers"', 'own-leftover', 'reuse'],
      ['sales.Order Lines', 'own-leftover', 'reuse'],
    ]);
  });

  it('refuses a schema off Postgres, and the schema Adminium\'s tables are in', () => {
    for (const dialect of ['mysql', 'sqlite'] as const) {
      const plan = planInstall(m(), view(), ctx({ dialect }));
      expect(plan.installable).toBe(false);
      expect(plan.problems).toEqual([expect.objectContaining({ code: 'TABLE_NAME_REFUSED', table: 'orders' })]);
      expect(plan.problems[0]!.message).toContain('only Postgres keeps tables in schemas');
    }
    const meta = planInstall(m(), view(), ctx({ metaSchema: 'sales' }));
    expect(meta.problems).toEqual([expect.objectContaining({ code: 'TABLE_NAME_REFUSED', table: 'orders' })]);
    expect(planInstall(m(), view(), ctx({ metaSchema: 'public' })).problems).toEqual([]);
  });

  it('refuses a name a table already there takes for its own where case is ignored', () => {
    const flat = shop({}, [table({ ref: 'orders', name: 'Orders' })]);
    for (const dialect of ['mysql', 'sqlite'] as const) {
      const plan = planInstall(m(flat), view(['orders']), ctx({ dialect }));
      expect(plan.problems.map((p) => p.code)).toContain('TABLE_NAME_REFUSED');
      // The app's own table, read back folded (MySQL with lower_case_table_names = 1), is never refused.
      const own = planInstall(m(flat), view(['orders']), ctx({ dialect, records: { orders: { table: 'Orders', owned: true, state: 'created' } } }));
      expect(own.problems.map((p) => p.code)).not.toContain('TABLE_NAME_REFUSED');
    }
    // Postgres keeps them apart.
    expect(planInstall(m(flat), view(['orders']), ctx()).problems).toEqual([]);
  });
});

describe('constraint names of a table under its own name', () => {
  const long = 'Bestellungen der Kunden mit Lieferadresse im Ausland 2026'; // 57 bytes

  it('stay within 63 bytes, and apart where Postgres would cut them alike', () => {
    const names = [
      foreignKeyName(long, 'customer_id'),
      foreignKeyName(long, 'customer_address_id'),
      uniqueColumnName(long, 'code'),
      uniqueColumnName(long, 'code_2'),
      uniqueSetName(long, ['a', 'b']),
      indexSetName(long, ['a', 'b']),
      plainIndexName(long, 'a'),
      foreignKeyName('€'.repeat(21), 'x'),
    ];
    for (const name of names) expect(new TextEncoder().encode(name).length, name).toBeLessThanOrEqual(63);
    expect(new Set(names).size).toBe(names.length);
    // Cut at 63 bytes, the first two would have been one name.
    const cut = (text: string) => Buffer.from(text).subarray(0, 63).toString();
    expect(cut(`fk_${long}_customer_id`)).toBe(cut(`fk_${long}_customer_address_id`));
  });

  it('keep the names a short table always had, and leave the schema out', () => {
    expect(foreignKeyName('pos_tickets', 'table_id')).toBe('fk_pos_tickets_table_id');
    expect(uniqueColumnName('pos_tickets', 'code')).toBe('uq_pos_tickets_code');
    expect(foreignKeyName('sales.Order Lines', 'customer_id')).toBe('fk_Order Lines_customer_id');
    expect(foreignKeyName('sales.Order Lines', 'customer_id')).toBe(foreignKeyName('Order Lines', 'customer_id'));
  });
});
