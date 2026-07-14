/**
 * Schema-IR / statistics serialization (06-llm-assist.md §4.1, §4.2).
 *
 * Locks the SAMPLE-FREE guarantee (acceptance criterion 8): with sampling off no
 * cell value appears; with sampling on, PII/secret column values still never
 * appear. Also covers enum-value inclusion, pseudo-enum flagging, and the
 * aggregates-only stats block.
 */
import { parseDatabaseModel, type StatsResult } from '@adminium/engine';
import { describe, expect, it } from 'vitest';

import {
  SAMPLING_BLOCK_HEADER,
  qualifyTableRef,
  serializeSampling,
  serializeSchemaIr,
  serializeStats,
  toPromptJson,
} from './serializer.js';

function demoModel() {
  return parseDatabaseModel({
    dialect: 'postgres',
    name: 'shop',
    tables: [
      {
        name: 'customers',
        primaryKey: ['id'],
        columns: [
          { name: 'id', logicalType: 'uuid', nullable: false, isPrimaryKey: true, isUnique: true },
          {
            name: 'email',
            logicalType: 'text',
            nullable: false,
            isUnique: true,
            semantics: { primary: 'email', flags: { pii: 'email' }, confidence: 0.99 },
          },
          {
            name: 'full_name',
            logicalType: 'text',
            nullable: true,
            semantics: { primary: 'person-name', flags: { pii: 'person-name' }, confidence: 0.9 },
          },
          { name: 'country', logicalType: 'text', nullable: true },
          { name: 'created_at', logicalType: 'timestamptz', nullable: false },
        ],
      },
      {
        name: 'orders',
        primaryKey: ['id'],
        columns: [
          { name: 'id', logicalType: 'uuid', nullable: false, isPrimaryKey: true, isUnique: true },
          {
            name: 'customer_id',
            logicalType: 'uuid',
            nullable: false,
            references: { tableId: 'public.customers', column: 'id' },
          },
          { name: 'status', logicalType: 'enum', nullable: false, enumRef: 'public.orders.status' },
        ],
      },
    ],
    enums: [
      {
        id: 'public.orders.status',
        name: 'status',
        values: ['pending', 'paid', 'shipped', 'cancelled', 'refunded'],
        source: 'check',
      },
    ],
    relations: [
      {
        id: 'orders_customer_fk',
        kind: 'declared-fk',
        cardinality: 'one-to-many',
        from: { tableId: 'public.orders', columns: ['customer_id'] },
        to: { tableId: 'public.customers', columns: ['id'] },
      },
    ],
  });
}

/** Stats carrying SENTINEL cell values on both a PII (email/full_name) and a non-PII (country) column. */
const demoStats: StatsResult[] = [
  {
    table: { schema: 'public', name: 'customers' },
    rowCountEstimate: 8402,
    rowCountExact: false,
    sampled: true,
    columns: [
      { column: 'email', nullFraction: 0, distinctCount: 8402, sampleValues: ['SENTINEL_EMAIL@x.com'] },
      { column: 'full_name', nullFraction: 0.01, distinctCount: 8000, sampleValues: ['SENTINEL_NAME'] },
      {
        column: 'country',
        nullFraction: 0,
        distinctCount: 6,
        min: 'AT',
        max: 'US',
        sampleValues: ['DE', 'US', 'SENTINEL_COUNTRY'],
      },
    ],
  },
];

describe('serializeStats — aggregates only', () => {
  it('emits row counts + null fractions + distinct counts and nothing else', () => {
    const json = toPromptJson(serializeStats(demoStats, { defaultSchema: 'public' }));
    expect(json).toContain('"rowCountEstimate":8402');
    expect(json).toContain('"nullFraction"');
    expect(json).toContain('"distinctCount"');
    // No cell values leak through the stats block, even though the input carried them.
    expect(json).not.toContain('SENTINEL');
    expect(json).not.toContain('sampleValues');
    expect(json).not.toContain('"min"');
    expect(json).not.toContain('"max"');
  });
});

describe('serializeSchemaIr — structure', () => {
  const ir = serializeSchemaIr(demoModel(), { stats: demoStats });

  it('carries no sampled cell values (structure only)', () => {
    expect(toPromptJson(ir)).not.toContain('SENTINEL');
  });

  it('flags pk / unique / references / enum / pii on columns', () => {
    const customers = ir.tables.find((t) => t.table === 'public.customers');
    const orders = ir.tables.find((t) => t.table === 'public.orders');
    if (customers === undefined || orders === undefined || 'stub' in customers || 'stub' in orders) {
      throw new Error('expected full tables');
    }
    const id = customers.columns.find((c) => c.column === 'id');
    const email = customers.columns.find((c) => c.column === 'email');
    const customerId = orders.columns.find((c) => c.column === 'customer_id');
    const status = orders.columns.find((c) => c.column === 'status');

    expect(id).toMatchObject({ primaryKey: true, unique: true });
    expect(email).toMatchObject({ piiSuspected: true });
    expect(customerId).toMatchObject({ references: 'public.customers.id' });
    expect(status).toMatchObject({ enum: 'public.orders.status' });
  });

  it('flags low-cardinality non-PII text as a pseudo-enum candidate', () => {
    const customers = ir.tables.find((t) => t.table === 'public.customers');
    if (customers === undefined || 'stub' in customers) throw new Error('expected full table');
    const country = customers.columns.find((c) => c.column === 'country');
    expect(country?.pseudoEnumCandidate).toBe(true);
    // The high-cardinality PII column is NOT a pseudo-enum candidate.
    const email = customers.columns.find((c) => c.column === 'email');
    expect(email?.pseudoEnumCandidate).toBeUndefined();
  });

  it('lists declared enum values under enumColumns (schema, not row data)', () => {
    expect(ir.enumColumns).toContainEqual({
      table: 'public.orders',
      column: 'status',
      values: ['pending', 'paid', 'shipped', 'cancelled', 'refunded'],
    });
  });

  it('lists declared foreign keys under declaredRelations', () => {
    expect(ir.declaredRelations).toContainEqual({
      fromTable: 'public.orders',
      fromColumns: ['customer_id'],
      toTable: 'public.customers',
      toColumns: ['id'],
      cardinality: 'one-to-many',
    });
  });

  it('renders out-of-chunk tables as name-only stubs', () => {
    const chunked = serializeSchemaIr(demoModel(), {
      stubTables: new Set(['public.customers']),
      stats: demoStats,
    });
    const customers = chunked.tables.find((t) => t.table === 'public.customers');
    if (customers === undefined || !('stub' in customers)) throw new Error('expected stub table');
    expect(customers).toEqual({
      table: 'public.customers',
      stub: true,
      columns: ['id', 'email', 'full_name', 'country', 'created_at'],
    });
  });
});

describe('serializeSampling — the only place cell values appear', () => {
  it('is empty when sampling is off (sample-free default)', () => {
    expect(serializeSampling(demoModel(), demoStats, null)).toBe('');
  });

  it('includes non-PII sampled values but never PII/secret column values', () => {
    const block = serializeSampling(demoModel(), demoStats, { maxValuesPerColumn: 20 });
    expect(block.startsWith(SAMPLING_BLOCK_HEADER)).toBe(true);
    expect(block).toContain('SENTINEL_COUNTRY'); // country is non-PII → sampled
    expect(block).not.toContain('SENTINEL_EMAIL'); // email is PII → excluded
    expect(block).not.toContain('SENTINEL_NAME'); // full_name is PII → excluded
  });

  it('truncates each column value list to maxValuesPerColumn', () => {
    const block = serializeSampling(demoModel(), demoStats, { maxValuesPerColumn: 1 });
    expect(block).toContain('"sampleValues":["DE"]');
    expect(block).not.toContain('SENTINEL_COUNTRY');
  });
});

describe('qualifyTableRef', () => {
  it('uses the default schema when the ref schema is null (mysql/sqlite)', () => {
    expect(qualifyTableRef({ schema: null, name: 'orders' }, 'main')).toBe('main.orders');
    expect(qualifyTableRef({ schema: 'public', name: 'orders' }, 'main')).toBe('public.orders');
  });
});
