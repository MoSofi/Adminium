import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  AdapterError,
  AdapterRegistry,
  type AdapterProvider,
  type DatabaseModel,
  databaseModelSchema,
  getAdapter,
  IR_VERSION,
  parseDatabaseModel,
  parseSchemaModel,
  registerAdapter,
  adapterRegistry,
  schemaModelSchema,
} from '../src/index.js';

const fixturePath = fileURLToPath(new URL('./fixtures/northwind.model.json', import.meta.url));
const fixtureJson = readFileSync(fixturePath, 'utf8');

describe('northwind fixture (shared contract test vector)', () => {
  const model = parseDatabaseModel(fixtureJson);

  it('parses as a valid DatabaseModel', () => {
    expect(model.irVersion).toBe(IR_VERSION);
    expect(model.dialect).toBe('postgres');
    expect(model.name).toBe('northwind');
    expect(model.stats.tableCount).toBe(model.tables.length);
    expect(model.stats.columnCount).toBe(
      model.tables.reduce((n, t) => n + t.columns.length, 0),
    );
    expect(model.stats.relationCount).toBe(model.relations.length);
  });

  it('contains the 14 classic tables', () => {
    expect(model.tables.map((t) => t.name).sort()).toEqual([
      'categories',
      'customer_customer_demo',
      'customer_demographics',
      'customers',
      'employee_territories',
      'employees',
      'order_details',
      'orders',
      'products',
      'region',
      'shippers',
      'suppliers',
      'territories',
      'us_states',
    ]);
  });

  it('models the declared FK graph', () => {
    const byPair = (from: string, to: string) =>
      model.relations.filter((r) => r.from.tableId === from && r.to.tableId === to);

    expect(byPair('public.orders', 'public.customers')).toHaveLength(1);
    expect(byPair('public.orders', 'public.employees')).toHaveLength(1);
    expect(byPair('public.orders', 'public.shippers')).toHaveLength(1);
    expect(byPair('public.order_details', 'public.orders')).toHaveLength(1);
    expect(byPair('public.order_details', 'public.products')).toHaveLength(1);
    expect(byPair('public.products', 'public.categories')).toHaveLength(1);
    expect(byPair('public.products', 'public.suppliers')).toHaveLength(1);
    expect(byPair('public.territories', 'public.region')).toHaveLength(1);
    expect(byPair('public.employee_territories', 'public.employees')).toHaveLength(1);
    expect(byPair('public.employee_territories', 'public.territories')).toHaveLength(1);

    for (const relation of model.relations) {
      expect(relation.kind).toBe('declared-fk');
      expect(relation.confidence).toBe(1);
    }
  });

  it('marks the employees reports_to self-FK as selfReferential', () => {
    const self = model.relations.filter((r) => r.selfReferential);
    expect(self).toHaveLength(1);
    expect(self[0]?.from).toEqual({ tableId: 'public.employees', columns: ['reports_to'] });
    expect(self[0]?.to).toEqual({ tableId: 'public.employees', columns: ['employee_id'] });
  });

  it('mirrors FKs onto column references', () => {
    const orders = model.tables.find((t) => t.id === 'public.orders');
    const customerId = orders?.columns.find((c) => c.name === 'customer_id');
    expect(customerId?.references).toEqual({
      tableId: 'public.customers',
      column: 'customer_id',
    });
  });

  it('keeps composite PKs ordered (order_details, employee_territories)', () => {
    const orderDetails = model.tables.find((t) => t.id === 'public.order_details');
    expect(orderDetails?.primaryKey).toEqual(['order_id', 'product_id']);
    const et = model.tables.find((t) => t.id === 'public.employee_territories');
    expect(et?.primaryKey).toEqual(['employee_id', 'territory_id']);
  });

  it('round-trips through JSON byte-identically (snapshot persistence safety)', () => {
    const first = parseDatabaseModel(fixtureJson);
    const reserialized = JSON.stringify(first);
    const second = parseDatabaseModel(reserialized);
    expect(second).toEqual(first);
    // parse is idempotent: re-parsing an already-parsed model changes nothing
    expect(JSON.stringify(second)).toBe(reserialized);
  });

  it('exposes the SchemaModel aliases', () => {
    expect(schemaModelSchema).toBe(databaseModelSchema);
    expect(parseSchemaModel).toBe(parseDatabaseModel);
    const alias: DatabaseModel = model;
    expect(alias.dialect).toBe('postgres');
  });
});

describe('databaseModelSchema', () => {
  it('accepts the minimal IR and fills defaults (05 §2.3)', () => {
    const model = parseDatabaseModel({
      irVersion: 1,
      dialect: 'generic',
      name: 'tiny',
      tables: [{ name: 'things', columns: [{ name: 'label' }] }],
    });
    expect(model.defaultSchema).toBe('public');
    expect(model.schemas).toEqual(['public']);
    expect(model.source).toEqual({ kind: 'import', format: 'json-ir' });
    expect(model.tables[0]?.id).toBe('public.things');
    expect(model.tables[0]?.kind).toBe('table');
    expect(model.tables[0]?.primaryKey).toEqual([]);
    expect(model.tables[0]?.columns[0]).toMatchObject({
      name: 'label',
      logicalType: 'text',
      nullable: true,
      isPrimaryKey: false,
      references: null,
      semantics: null,
    });
    expect(model.capabilities.hasFKs).toBe(true);
    expect(model.capabilities.hasRowEstimates).toBe(false);
    expect(model.relations).toEqual([]);
    expect(Date.parse(model.introspectedAt)).not.toBeNaN();
  });

  it('rejects unknown keys loudly (strict objects)', () => {
    const result = databaseModelSchema.safeParse({
      irVersion: 1,
      dialect: 'generic',
      name: 'tiny',
      tables: [{ name: 'things', columns: [{ name: 'label' }], bogus: true }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects relations pointing at unknown tables/columns', () => {
    const result = databaseModelSchema.safeParse({
      irVersion: 1,
      dialect: 'generic',
      name: 'tiny',
      tables: [{ name: 'things', columns: [{ name: 'label' }] }],
      relations: [
        {
          id: 'r1',
          kind: 'inferred-name',
          cardinality: 'one-to-many',
          from: { tableId: 'public.things', columns: ['label'] },
          to: { tableId: 'public.missing', columns: ['id'] },
          confidence: 0.85,
        },
      ],
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(!result.success && result.error.issues)).toContain('public.missing');
  });

  it('rejects dangling column references and enum refs', () => {
    const badRef = databaseModelSchema.safeParse({
      irVersion: 1,
      dialect: 'generic',
      name: 'tiny',
      tables: [
        {
          name: 'things',
          columns: [{ name: 'other_id', references: { tableId: 'public.others', column: 'id' } }],
        },
      ],
    });
    expect(badRef.success).toBe(false);

    const badEnum = databaseModelSchema.safeParse({
      irVersion: 1,
      dialect: 'generic',
      name: 'tiny',
      tables: [
        { name: 'things', columns: [{ name: 'state', logicalType: 'enum', enumRef: 'nope' }] },
      ],
    });
    expect(badEnum.success).toBe(false);
  });

  it('rejects a wrong irVersion', () => {
    const result = databaseModelSchema.safeParse({
      irVersion: 2,
      dialect: 'generic',
      name: 'tiny',
      tables: [{ name: 'things', columns: [{ name: 'label' }] }],
    });
    expect(result.success).toBe(false);
  });
});

describe('AdapterRegistry', () => {
  const provider = (dialect: 'postgres' | 'mysql' | 'sqlite' | 'generic'): AdapterProvider => ({
    dialect,
    create: () => {
      throw new Error('not implemented in test stub');
    },
    createQueryEngine: () => {
      throw new Error('not implemented in test stub');
    },
  });

  it('registers and resolves providers', () => {
    const registry = new AdapterRegistry();
    const pg = provider('postgres');
    registry.register(pg);
    expect(registry.get('postgres')).toBe(pg);
    expect(registry.has('postgres')).toBe(true);
    expect(registry.list()).toEqual(['postgres']);
  });

  it('throws a typed UNSUPPORTED error for unknown dialects', () => {
    const registry = new AdapterRegistry();
    registry.register(provider('postgres'));
    let caught: unknown;
    try {
      registry.get('mysql');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AdapterError);
    expect((caught as AdapterError).code).toBe('UNSUPPORTED');
    expect((caught as AdapterError).hint).toContain('postgres');
  });

  it('rejects duplicate registration and supports unregister/clear', () => {
    const registry = new AdapterRegistry();
    registry.register(provider('sqlite'));
    expect(() => registry.register(provider('sqlite'))).toThrowError(/already registered/);
    expect(registry.unregister('sqlite')).toBe(true);
    expect(registry.unregister('sqlite')).toBe(false);
    registry.register(provider('sqlite'));
    registry.clear();
    expect(registry.list()).toEqual([]);
  });

  it('exposes the process-wide singleton with registerAdapter/getAdapter wrappers', () => {
    adapterRegistry.clear();
    try {
      registerAdapter(provider('mysql'));
      registerAdapter('generic', {
        create: provider('generic').create,
        createQueryEngine: provider('generic').createQueryEngine,
      });
      expect(getAdapter('mysql').dialect).toBe('mysql');
      expect(getAdapter('generic').dialect).toBe('generic');
      expect(() => getAdapter('sqlite')).toThrowError(AdapterError);
    } finally {
      adapterRegistry.clear();
    }
  });
});
