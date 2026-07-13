import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  canonicalModelJson,
  diffModels,
  diffSnapshots,
  hashModel,
  isEmptyDiff,
  parseDatabaseModel,
  schemaDiffSchema,
  sha256Hex,
  snapshotFromModel,
  type DatabaseModel,
} from '../src/index.js';

const fixturePath = fileURLToPath(new URL('./fixtures/northwind.model.json', import.meta.url));
const northwind = parseDatabaseModel(readFileSync(fixturePath, 'utf8'));

const clone = (model: DatabaseModel): DatabaseModel => structuredClone(model);

// ---------------------------------------------------------------------------
// sha256 (dependency-free implementation) — FIPS 180-4 test vectors
// ---------------------------------------------------------------------------

describe('sha256Hex', () => {
  it('matches the FIPS vectors', () => {
    expect(sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('handles multi-block input and non-ASCII UTF-8 (incl. surrogate pairs)', () => {
    expect(sha256Hex('a'.repeat(200))).toBe(
      'c2a908d98f5df987ade41b5fce213067efbcc21ef2240212a41e54b5e7c28ae5',
    );
    expect(sha256Hex('héllo 🌍 snapshot')).toBe(
      'a800cfc004da813e994ac8add026f1828e9e4e8d9f16f107725c1c2e9988059a',
    );
  });
});

// ---------------------------------------------------------------------------
// Canonical hash (§9): volatile fields stripped, ordering-insensitive
// ---------------------------------------------------------------------------

describe('hashModel / canonicalModelJson', () => {
  it('is stable across calls and does not mutate the model', () => {
    const before = JSON.stringify(northwind);
    const h1 = hashModel(northwind);
    const h2 = hashModel(northwind);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(northwind)).toBe(before);
  });

  it('ignores the §9 volatile fields (introspectedAt/stats/warnings/estimates/activity/sizeBytes)', () => {
    const noisy = clone(northwind);
    noisy.introspectedAt = '2030-01-01T00:00:00.000Z';
    noisy.stats = { tableCount: 0, columnCount: 0, relationCount: 0, durationMs: 999 };
    noisy.warnings = [{ code: 'X', message: 'noise', tableId: null }];
    noisy.tables[0]!.rowCountEstimate = 123456;
    noisy.tables[0]!.activity = { inserts: 1, updates: 2, deletes: 3 };
    noisy.tables[0]!.sizeBytes = 42;
    expect(hashModel(noisy)).toBe(hashModel(northwind));
  });

  it('is insensitive to table/column/relation enumeration order', () => {
    const shuffled = clone(northwind);
    shuffled.tables.reverse();
    for (const table of shuffled.tables) table.columns.reverse();
    shuffled.relations.reverse();
    expect(hashModel(shuffled)).toBe(hashModel(northwind));
  });

  it('changes when the schema actually changes', () => {
    const changed = clone(northwind);
    changed.tables[0]!.columns[0]!.logicalType = 'bigint';
    expect(hashModel(changed)).not.toBe(hashModel(northwind));

    const stripped = JSON.parse(canonicalModelJson(northwind)) as Record<string, unknown>;
    expect(stripped['introspectedAt']).toBeUndefined();
    expect(stripped['stats']).toBeUndefined();
    expect(stripped['warnings']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// snapshotFromModel + dedupe short-circuit
// ---------------------------------------------------------------------------

describe('snapshotFromModel / diffSnapshots', () => {
  it('produces the checksum the meta-store dedupes on', () => {
    const snapshot = snapshotFromModel(northwind);
    expect(snapshot.checksum).toBe(hashModel(northwind));
    expect(snapshot.model).toBe(northwind);
  });

  it('equal checksums short-circuit to an empty diff', () => {
    const a = snapshotFromModel(northwind);
    const noisy = clone(northwind);
    noisy.introspectedAt = '2031-05-05T00:00:00.000Z';
    const b = snapshotFromModel(noisy);
    expect(a.checksum).toBe(b.checksum);
    const diff = diffSnapshots(a, b);
    expect(isEmptyDiff(diff)).toBe(true);
    expect(diff.breaking).toBe(false);
  });

  it('different checksums delegate to diffModels', () => {
    const changed = clone(northwind);
    changed.tables = changed.tables.filter((t) => t.name !== 'us_states');
    const diff = diffSnapshots(snapshotFromModel(northwind), snapshotFromModel(changed));
    expect(diff.removedTables).toEqual(['public.us_states']);
  });
});

// ---------------------------------------------------------------------------
// diffModels (§9)
// ---------------------------------------------------------------------------

describe('diffModels', () => {
  it('identical models → empty, non-breaking diff', () => {
    const diff = diffModels(northwind, clone(northwind));
    expect(isEmptyDiff(diff)).toBe(true);
    expect(diff.breaking).toBe(false);
    expect(schemaDiffSchema.parse(diff)).toEqual(diff);
  });

  it('added column is reported and non-breaking', () => {
    const b = clone(northwind);
    b.tables
      .find((t) => t.id === 'public.products')!
      .columns.push({
        name: 'sku',
        ordinal: 11,
        dbType: 'character varying(32)',
        logicalType: 'varchar',
        nullable: true,
        default: null,
        isPrimaryKey: false,
        isUnique: true,
        isGenerated: false,
        enumRef: null,
        maxLength: 32,
        numericPrecision: null,
        numericScale: null,
        isArray: false,
        comment: null,
        references: null,
        semantics: null,
      });
    const diff = diffModels(northwind, b);
    expect(diff.changedTables['public.products']).toMatchObject({
      addedColumns: ['sku'],
      removedColumns: [],
      pkChanged: false,
    });
    expect(diff.breaking).toBe(false);
  });

  it('dropped table is breaking', () => {
    const b = clone(northwind);
    b.tables = b.tables.filter((t) => t.id !== 'public.shippers');
    b.relations = b.relations.filter(
      (r) => r.from.tableId !== 'public.shippers' && r.to.tableId !== 'public.shippers',
    );
    const diff = diffModels(northwind, b);
    expect(diff.removedTables).toEqual(['public.shippers']);
    expect(diff.breaking).toBe(true);
    expect(diff.relationChanges.removed.map((r) => r.id)).toEqual([
      'fk:public.orders(ship_via)->public.shippers(shipper_id)',
    ]);
  });

  it('dropped column is breaking; rename detection is deferred (renamedColumns stays [])', () => {
    const b = clone(northwind);
    const customers = b.tables.find((t) => t.id === 'public.customers')!;
    customers.columns = customers.columns.filter((c) => c.name !== 'fax');
    const diff = diffModels(northwind, b);
    const changed = diff.changedTables['public.customers']!;
    expect(changed.removedColumns).toEqual(['fax']);
    expect(changed.renamedColumns).toEqual([]); // 05 §9: rename-detect.ts is a follow-up
    expect(diff.breaking).toBe(true);
  });

  it('type + nullability changes are reported per column', () => {
    const b = clone(northwind);
    const orders = b.tables.find((t) => t.id === 'public.orders')!;
    const freight = orders.columns.find((c) => c.name === 'freight')!;
    freight.logicalType = 'decimal';
    freight.nullable = false;
    const diff = diffModels(northwind, b);
    const changed = diff.changedTables['public.orders']!;
    expect(changed.typeChanged).toEqual([{ column: 'freight', from: 'float', to: 'decimal' }]);
    expect(changed.nullabilityChanged).toEqual([{ column: 'freight', nowNullable: false }]);
    expect(diff.breaking).toBe(true); // type change
  });

  it('added FK relation is reported under relationChanges', () => {
    const b = clone(northwind);
    b.relations.push({
      id: 'fk:public.orders(ship_region)->public.us_states(state_abbr)',
      kind: 'declared-fk',
      cardinality: 'one-to-many',
      from: { tableId: 'public.orders', columns: ['ship_region'] },
      to: { tableId: 'public.us_states', columns: ['state_abbr'] },
      through: null,
      onDelete: null,
      onUpdate: null,
      selfReferential: false,
      confidence: 1,
    });
    const diff = diffModels(northwind, b);
    expect(diff.relationChanges.added.map((r) => r.id)).toEqual([
      'fk:public.orders(ship_region)->public.us_states(state_abbr)',
    ]);
    expect(diff.relationChanges.removed).toEqual([]);
    expect(diff.breaking).toBe(false);
  });

  it('enum value drift is reported on the referencing table', () => {
    const a = clone(northwind);
    const b = clone(northwind);
    for (const model of [a, b]) {
      model.enums.push({
        id: 'public.order_status',
        name: 'order_status',
        values: ['pending', 'shipped'],
        source: 'native',
      });
      const orders = model.tables.find((t) => t.id === 'public.orders')!;
      orders.columns.push({
        name: 'status',
        ordinal: 15,
        dbType: 'order_status',
        logicalType: 'enum',
        nullable: true,
        default: null,
        isPrimaryKey: false,
        isUnique: false,
        isGenerated: false,
        enumRef: 'public.order_status',
        maxLength: null,
        numericPrecision: null,
        numericScale: null,
        isArray: false,
        comment: null,
        references: null,
        semantics: null,
      });
    }
    b.enums.find((e) => e.id === 'public.order_status')!.values = [
      'pending',
      'shipped',
      'delivered',
    ];
    const diff = diffModels(a, b);
    expect(diff.changedTables['public.orders']!.enumValuesChanged).toEqual([
      { enumId: 'public.order_status', added: ['delivered'], removed: [] },
    ]);
    expect(diff.breaking).toBe(false);
  });

  it('primary key changes set pkChanged and breaking', () => {
    const b = clone(northwind);
    const products = b.tables.find((t) => t.id === 'public.products')!;
    products.primaryKey = ['product_id', 'supplier_id'];
    const diff = diffModels(northwind, b);
    expect(diff.changedTables['public.products']!.pkChanged).toBe(true);
    expect(diff.breaking).toBe(true);
  });

  it('breaking honors the isReferenced predicate', () => {
    const b = clone(northwind);
    const customers = b.tables.find((t) => t.id === 'public.customers')!;
    customers.columns = customers.columns.filter((c) => c.name !== 'fax');
    const diff = diffModels(northwind, b, { isReferenced: () => false });
    expect(diff.changedTables['public.customers']!.removedColumns).toEqual(['fax']);
    expect(diff.breaking).toBe(false);
  });

  it('output ordering is stable regardless of input order', () => {
    const b = clone(northwind);
    b.tables = b.tables.filter((t) => t.name !== 'us_states' && t.name !== 'region');
    b.relations = b.relations.filter(
      (r) => r.to.tableId !== 'public.region' && r.from.tableId !== 'public.region',
    );
    const shuffledA = clone(northwind);
    shuffledA.tables.reverse();
    const diff1 = diffModels(northwind, b);
    const diff2 = diffModels(shuffledA, b);
    expect(diff1.removedTables).toEqual(['public.region', 'public.us_states']);
    expect(diff1).toEqual(diff2);
  });

  it('every diff validates against schemaDiffSchema', () => {
    const b = clone(northwind);
    b.tables = b.tables.filter((t) => t.name !== 'us_states');
    const diff = diffModels(northwind, b);
    expect(() => schemaDiffSchema.parse(diff)).not.toThrow();
  });
});
