import { describe, expect, it } from 'vitest';

import { dataShapeSchema, queryDescriptorSchema } from '../src/page-config/index.js';

const minimal = {
  connectionId: 'conn_01HZX0000000000000000000',
  source: { name: 'orders' },
  shape: 'timeseries',
};

describe('queryDescriptorSchema', () => {
  it('accepts a minimal descriptor and applies defaults', () => {
    const parsed = queryDescriptorSchema.parse(minimal);
    expect(parsed.kind).toBe('table-query');
    expect(parsed.source.type).toBe('table');
    expect(parsed.shape).toBe('timeseries');
  });

  it('accepts a fully-populated descriptor', () => {
    const parsed = queryDescriptorSchema.parse({
      ...minimal,
      source: { schema: 'public', name: 'orders', type: 'view' },
      shape: 'metric+delta',
      select: ['amount', 'status'],
      aggregations: [
        { fn: 'sum', column: 'amount', alias: 'total' },
        { fn: 'count', alias: 'orders' },
        { fn: 'percentile', column: 'amount', p: 0.95, alias: 'p95' },
      ],
      groupBy: ['status', 'region'],
      bucket: { column: 'created_at', unit: 'day' },
      filters: [
        { column: 'status', op: 'eq', value: 'paid' },
        { column: 'created_at', op: 'gte', param: 'dateRange.start' },
        { column: 'deleted_at', op: 'is_null' },
      ],
      window: { column: 'created_at', last: 30, unit: 'day', compareToPrior: true },
      orderBy: [{ column: 'created_at', dir: 'desc' }],
      limit: 50,
      cursor: 'abc',
    });
    expect(parsed.aggregations).toHaveLength(3);
    expect(parsed.window?.compareToPrior).toBe(true);
  });

  it('defaults window.compareToPrior to false', () => {
    const parsed = queryDescriptorSchema.parse({
      ...minimal,
      window: { column: 'created_at', last: 7, unit: 'day' },
    });
    expect(parsed.window?.compareToPrior).toBe(false);
  });

  it.each([
    ['unknown shape', { shape: 'pie' }],
    ['missing connectionId', { connectionId: undefined }],
    ['missing source name', { source: {} }],
    ['bad source type', { source: { name: 'orders', type: 'materialized' } }],
    ['kind other than table-query', { kind: 'raw-sql' }],
    ['more than 8 aggregations', {
      aggregations: Array.from({ length: 9 }, (_, n) => ({ fn: 'count', alias: `a${n}` })),
    }],
    ['unknown aggregation fn', { aggregations: [{ fn: 'median', alias: 'm' }] }],
    ['aggregation missing alias', { aggregations: [{ fn: 'count' }] }],
    ['percentile p above 1', { aggregations: [{ fn: 'percentile', column: 'x', p: 1.5, alias: 'p' }] }],
    ['more than 2 groupBy columns', { groupBy: ['a', 'b', 'c'] }],
    ['bad bucket unit', { bucket: { column: 'created_at', unit: 'minute' } }],
    ['more than 16 filters', {
      filters: Array.from({ length: 17 }, () => ({ column: 'x', op: 'eq', value: 1 })),
    }],
    ['unknown filter op', { filters: [{ column: 'x', op: 'regex', value: '.*' }] }],
    ['window.last below 1', { window: { column: 't', last: 0, unit: 'day' } }],
    ['more than 3 orderBy entries', {
      orderBy: [
        { column: 'a', dir: 'asc' },
        { column: 'b', dir: 'asc' },
        { column: 'c', dir: 'asc' },
        { column: 'd', dir: 'asc' },
      ],
    }],
    ['orderBy with bad dir', { orderBy: [{ column: 'a', dir: 'up' }] }],
    ['limit of 0', { limit: 0 }],
    ['limit above 1000', { limit: 1001 }],
    ['non-integer limit', { limit: 10.5 }],
  ])('rejects %s', (_label, overrides) => {
    expect(queryDescriptorSchema.safeParse({ ...minimal, ...overrides }).success).toBe(false);
  });
});

describe('dataShapeSchema', () => {
  it('accepts all 18 canonical shapes', () => {
    expect(dataShapeSchema.options).toHaveLength(18);
    for (const shape of dataShapeSchema.options) {
      expect(dataShapeSchema.safeParse(shape).success).toBe(true);
    }
  });

  it('rejects unknown shapes', () => {
    expect(dataShapeSchema.safeParse('bar-chart').success).toBe(false);
  });
});
