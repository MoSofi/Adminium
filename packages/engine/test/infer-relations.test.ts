import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  applyClassification,
  applyInference,
  detectDomains,
  inferJoinTableRelations,
  inferNameRelations,
  parseDatabaseModel,
  type DatabaseModel,
} from '../src/index.js';

/**
 * §6 rules 1–2 on the schema they exist for: one that declares no foreign
 * keys at all (MyISAM, legacy SQLite, most ORM-generated MySQL). Everything
 * downstream — domains, FK chips, join tables, hierarchies — reads
 * `model.relations`, so on this fixture the un-inferred model produces a
 * single "General" domain of nine singletons and nine `external-id` columns.
 */
const FK_LESS = parseDatabaseModel({
  dialect: 'mysql',
  name: 'shop',
  source: { kind: 'live', connectionId: 'conn_1' },
  capabilities: { hasFKs: false },
  tables: [
    {
      name: 'customers',
      primaryKey: ['id'],
      columns: [
        { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
        { name: 'name', logicalType: 'varchar', maxLength: 120 },
        { name: 'email', logicalType: 'varchar', maxLength: 200 },
      ],
    },
    {
      name: 'addresses',
      primaryKey: ['id'],
      columns: [
        { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
        { name: 'line1', logicalType: 'varchar', maxLength: 200 },
        { name: 'city', logicalType: 'varchar', maxLength: 80 },
      ],
    },
    {
      name: 'orders',
      primaryKey: ['id'],
      columns: [
        { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
        { name: 'customer_id', logicalType: 'integer', nullable: false },
        { name: 'shipping_address_id', logicalType: 'integer' },
        // varchar against an integer key — a real name match on a shape that
        // cannot actually join. Suggested, never accepted.
        { name: 'shipper_id', logicalType: 'varchar', maxLength: 32 },
        { name: 'status', logicalType: 'varchar', maxLength: 24 },
        { name: 'created_at', logicalType: 'timestamp' },
      ],
    },
    {
      name: 'products',
      primaryKey: ['id'],
      columns: [
        { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
        { name: 'name', logicalType: 'varchar', maxLength: 120 },
        { name: 'price', logicalType: 'decimal' },
      ],
    },
    {
      name: 'shippers',
      primaryKey: ['id'],
      columns: [
        { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
        { name: 'name', logicalType: 'varchar', maxLength: 120 },
      ],
    },
    {
      name: 'order_products',
      primaryKey: ['order_id', 'product_id'],
      columns: [
        { name: 'order_id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
        { name: 'product_id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
      ],
    },
    {
      name: 'employees',
      primaryKey: ['id'],
      columns: [
        { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
        { name: 'full_name', logicalType: 'varchar', maxLength: 120 },
        { name: 'email', logicalType: 'varchar', maxLength: 200 },
        { name: 'manager_id', logicalType: 'integer' },
      ],
    },
    {
      name: 'owners',
      primaryKey: ['id'],
      columns: [
        { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
        { name: 'name', logicalType: 'varchar', maxLength: 120 },
      ],
    },
    {
      name: 'notes',
      primaryKey: ['id'],
      columns: [
        { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
        { name: 'owner_type', logicalType: 'varchar', maxLength: 40 },
        { name: 'owner_id', logicalType: 'integer' },
        { name: 'body', logicalType: 'text' },
      ],
    },
  ],
});

const named = new Map(
  inferNameRelations(FK_LESS).map((i) => [i.relation.from.columns.join('+'), i]),
);

describe('§6 rule 1 — name-convention inference', () => {
  it('resolves <table>_id onto the target key, singular or plural', () => {
    const relation = named.get('customer_id')?.relation;
    expect(relation?.kind).toBe('inferred-name');
    expect(relation?.from).toEqual({ tableId: 'public.orders', columns: ['customer_id'] });
    expect(relation?.to).toEqual({ tableId: 'public.customers', columns: ['id'] });
    expect(relation?.cardinality).toBe('one-to-many');
  });

  it('scores an exact match on an agreeing declared key well above the 0.8 gate', () => {
    expect(named.get('customer_id')?.relation.confidence).toBe(0.9);
  });

  it('accepts a role-prefixed name at the gate, not above it', () => {
    // `shipping_address_id` → addresses.id: right table, one token of role
    // noise. Good enough to cluster and to render as an FK chip.
    expect(named.get('shipping_address_id')?.relation.confidence).toBe(0.8);
  });

  it('leaves a type-disagreeing match in the 0.5–0.79 suggested band', () => {
    const confidence = named.get('shipper_id')?.relation.confidence;
    expect(confidence).toBeGreaterThanOrEqual(0.5);
    expect(confidence).toBeLessThan(0.8);
  });

  it('resolves §6 rule 3 hierarchy vocabulary to the column\'s own table', () => {
    const relation = named.get('manager_id')?.relation;
    expect(relation?.to.tableId).toBe('public.employees');
    expect(relation?.selfReferential).toBe(true);
    expect(relation?.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('fabricates nothing for a §6 rule 4 polymorphic pair', () => {
    expect(named.has('owner_id')).toBe(false);
  });

  it('never emits for a column that already carries a declared reference', () => {
    const declared = parseDatabaseModel({
      dialect: 'mysql',
      name: 'shop',
      tables: [
        {
          name: 'customers',
          primaryKey: ['id'],
          columns: [{ name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false }],
        },
        {
          name: 'orders',
          primaryKey: ['id'],
          columns: [
            { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
            {
              name: 'customer_id',
              logicalType: 'integer',
              references: { tableId: 'public.customers', column: 'id' },
            },
          ],
        },
      ],
    });
    expect(inferNameRelations(declared)).toEqual([]);
  });

  it('never mistakes a table\'s own key for a reference to itself', () => {
    // `customers.customer_id` as the sole PK matches the table's own name;
    // resolving it would give every legacy schema a self-join per table.
    const selfNamedKey = parseDatabaseModel({
      dialect: 'mysql',
      name: 'legacy',
      tables: [
        {
          name: 'customers',
          primaryKey: ['customer_id'],
          columns: [
            { name: 'customer_id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
          ],
        },
      ],
    });
    expect(inferNameRelations(selfNamedKey)).toEqual([]);
  });
});

describe('§6 rule 2 — join-table inference', () => {
  it('needs rule 1 to have run first', () => {
    // The pair is composite-PK, so it classifies as pk-id and is invisible
    // until name inference has put the two relations into the graph.
    expect(inferJoinTableRelations(FK_LESS)).toEqual([]);
  });

  it('emits a many-to-many through the join table once rule 1 has run', () => {
    const m2m = applyInference(FK_LESS).relations.filter((r) => r.kind === 'inferred-join-table');
    expect(m2m).toHaveLength(1);
    expect(m2m[0]?.cardinality).toBe('many-to-many');
    expect(m2m[0]?.from.tableId).toBe('public.orders');
    expect(m2m[0]?.to.tableId).toBe('public.products');
    expect(m2m[0]?.through).toEqual({
      tableId: 'public.order_products',
      fromColumns: ['order_id'],
      toColumns: ['product_id'],
    });
  });

  it('is never surer than the weaker of the two FKs holding it up', () => {
    const m2m = applyInference(FK_LESS).relations.find((r) => r.kind === 'inferred-join-table');
    expect(m2m?.confidence).toBeLessThanOrEqual(0.9);
    expect(m2m?.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('leaves a through table an import already covered alone', () => {
    // `@adminium/schema-import`'s Django parser emits these itself, so an
    // imported model arrives with M2M relations a live introspection of the
    // same database does not have. A second one would be a duplicate id,
    // which `databaseModelSchema` throws on.
    const imported = parseDatabaseModel({
      dialect: 'generic',
      name: 'library',
      source: { kind: 'import', format: 'django' },
      tables: [
        {
          name: 'books',
          primaryKey: ['id'],
          columns: [{ name: 'id', logicalType: 'bigint', isPrimaryKey: true, nullable: false }],
        },
        {
          name: 'authors',
          primaryKey: ['id'],
          columns: [{ name: 'id', logicalType: 'bigint', isPrimaryKey: true, nullable: false }],
        },
        {
          name: 'books_authors',
          primaryKey: ['id'],
          uniques: [{ name: null, columns: ['book_id', 'author_id'] }],
          columns: [
            { name: 'id', logicalType: 'bigint', isPrimaryKey: true, nullable: false },
            { name: 'book_id', logicalType: 'bigint', nullable: false },
            { name: 'author_id', logicalType: 'bigint', nullable: false },
          ],
        },
      ],
      relations: [
        {
          id: 'm2m:public.books(id)->public.authors(id)',
          kind: 'inferred-join-table',
          cardinality: 'many-to-many',
          from: { tableId: 'public.books', columns: ['id'] },
          to: { tableId: 'public.authors', columns: ['id'] },
          through: {
            tableId: 'public.books_authors',
            fromColumns: ['book_id'],
            toColumns: ['author_id'],
          },
        },
      ],
    });
    const inferred = applyInference(imported);
    expect(inferred.relations.filter((r) => r.kind === 'inferred-join-table')).toHaveLength(1);
    // Rule 1 still resolves the join table's own two columns.
    expect(inferred.relations.filter((r) => r.kind === 'inferred-name')).toHaveLength(2);
    expect(() => parseDatabaseModel(inferred)).not.toThrow();
  });
});

describe('applyInference', () => {
  const inferred = applyInference(FK_LESS);

  it('produces a model that still parses', () => {
    expect(() => parseDatabaseModel(inferred)).not.toThrow();
    expect(inferred.stats.relationCount).toBe(inferred.relations.length);
  });

  it('does not mutate the input', () => {
    expect(FK_LESS.relations).toEqual([]);
  });

  it('is idempotent — a second pass adds nothing', () => {
    expect(applyInference(inferred).relations).toEqual(inferred.relations);
  });

  it('clusters an FK-less schema into domains instead of one "General" pile', () => {
    const before = detectDomains(FK_LESS, FK_LESS.tables);
    expect(before).toHaveLength(1);
    expect(before[0]?.key).toBe('general');

    const after = detectDomains(inferred, inferred.tables);
    const shop = after.find((d) => d.key !== 'general');
    expect(shop?.tableIds).toEqual([
      'public.addresses',
      'public.customers',
      'public.order_products',
      'public.orders',
      'public.products',
    ]);
  });

  it('leaves a 0.5–0.79 suggestion out of the domain graph', () => {
    // `orders.shipper_id` is emitted, but every 0.8 gate excludes it — so
    // shippers stays unattached until a human accepts the suggestion.
    const general = detectDomains(inferred, inferred.tables).find((d) => d.key === 'general');
    expect(general?.tableIds).toContain('public.shippers');
  });

  it('turns *_id columns into FK chips instead of external-id strings', () => {
    const columnOf = (model: DatabaseModel, table: string, column: string) =>
      model.tables
        .find((t) => t.id === table)
        ?.columns.find((c) => c.name === column)?.semantics?.primary;

    expect(columnOf(applyClassification(FK_LESS), 'public.orders', 'customer_id')).toBe(
      'external-id',
    );
    expect(columnOf(applyClassification(inferred), 'public.orders', 'customer_id')).toBe('fk');
    // The suggested-band relation deliberately does NOT flip its column.
    expect(columnOf(applyClassification(inferred), 'public.orders', 'shipper_id')).toBe(
      'external-id',
    );
  });

  it('lets the table classifier see the join table and the hierarchy', () => {
    const classified = applyClassification(inferred);
    const semanticsOf = (id: string) => classified.tables.find((t) => t.id === id)?.semantics;
    expect(semanticsOf('public.order_products')?.role).toBe('join-table');
    expect(semanticsOf('public.employees')?.hierarchy).toEqual({ parentColumn: 'manager_id' });
    // Same two tables, un-inferred: an entity and a flat table.
    const flat = applyClassification(FK_LESS);
    expect(flat.tables.find((t) => t.id === 'public.order_products')?.semantics?.role).toBe(
      'entity',
    );
  });
});

describe('a schema that declares its foreign keys is left alone', () => {
  const northwind = parseDatabaseModel(
    readFileSync(
      fileURLToPath(new URL('./fixtures/northwind.model.json', import.meta.url)),
      'utf8',
    ),
  );

  it('infers no name relation over Northwind', () => {
    // Every id-suffixed column there is either a declared FK or the table's
    // own primary key. A single hit here means rule 1 is over-firing, and
    // `generate-baseline.test.ts` is the fixture that would notice.
    expect(inferNameRelations(northwind)).toEqual([]);
  });

  it('leaves every declared relation exactly as introspected', () => {
    const after = applyInference(northwind);
    const declared = after.relations.filter((r) => r.kind === 'declared-fk');
    expect(declared).toEqual(northwind.relations);
  });
});
