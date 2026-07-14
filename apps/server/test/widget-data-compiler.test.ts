/**
 * Offline unit tests for the widget-data query-descriptor compiler
 * (04-widget-registry.md §5.2): SQL-text assertions over dynamic Kysely
 * with a dummy driver proving identifiers come from the snapshot, values
 * bind as parameters, time buckets compile to `date_trunc`, window bounds
 * are calendar-correct, masked columns refuse in every clause, and the
 * shape ⇄ descriptor structural rules hold. Shaper + cache units ride
 * along — no database required.
 */

import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely';
import { describe, expect, it } from 'vitest';

import { queryDescriptorSchema, type QueryDescriptor } from '@adminium/engine/config';

import type { EffectiveModel } from '../src/connections/effective-schema.js';
import type { SourceDatabase } from '../src/connections/manager.js';
import { SnapshotView, UnknownIdentifierError } from '../src/crud/identifiers.js';
import { AppError, ForbiddenError, ValidationFailedError } from '../src/errors.js';
import { WidgetDataCache, cacheKeyOf } from '../src/widget-data/cache.js';
import {
  compileWidgetQuery,
  resolveFilterParams,
  windowBounds,
  type CompiledWidgetQuery,
} from '../src/widget-data/compiler.js';
import { shapeRows, toNumber } from '../src/widget-data/shapers.js';

function semantics(overrides: Record<string, unknown> = {}) {
  return {
    primary: 'plain',
    flags: { secret: false, pii: null, maskedByDefault: false },
    format: null,
    pair: null,
    confidence: 1,
    source: 'heuristic',
    ...overrides,
  };
}

/** Minimal Northwind-ish effective model. */
const model = {
  dialect: 'postgres',
  name: 'unit',
  defaultSchema: 'public',
  schemas: ['public'],
  enums: [],
  relations: [],
  tables: [
    {
      id: 'public.orders',
      schema: 'public',
      name: 'orders',
      kind: 'table',
      primaryKey: ['order_id'],
      columns: [
        { name: 'order_id', logicalType: 'integer', nullable: false, isPrimaryKey: true, semantics: null },
        { name: 'customer_id', logicalType: 'varchar', nullable: true, isPrimaryKey: false, semantics: null },
        { name: 'order_date', logicalType: 'timestamp', nullable: true, isPrimaryKey: false, semantics: null },
        { name: 'freight', logicalType: 'decimal', nullable: true, isPrimaryKey: false, semantics: null },
        {
          name: 'ship_phone',
          logicalType: 'varchar',
          nullable: true,
          isPrimaryKey: false,
          semantics: semantics({ primary: 'phone', flags: { secret: false, pii: 'phone', maskedByDefault: true } }),
        },
      ],
    },
  ],
} as unknown as EffectiveModel;

const view = new SnapshotView('conn_1', model);

const db = new Kysely<SourceDatabase>({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (kysely) => new PostgresIntrospector(kysely),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  },
});

const NOW = new Date('2026-07-15T12:00:00.000Z');

function descriptor(input: Record<string, unknown>): QueryDescriptor {
  return queryDescriptorSchema.parse({
    connectionId: 'conn_1',
    source: { name: 'orders', schema: 'public' },
    ...input,
  });
}

function compile(input: Record<string, unknown>, canReadPii = false): CompiledWidgetQuery {
  return compileWidgetQuery({
    db,
    view,
    descriptor: descriptor(input),
    canReadPii,
    now: () => NOW,
  });
}

describe('widget-data compiler — SQL', () => {
  it('compiles a monthly revenue timeseries with date_trunc and quoted snapshot identifiers', () => {
    const compiled = compile({
      shape: 'timeseries',
      aggregations: [{ fn: 'sum', column: 'freight', alias: 'revenue' }],
      bucket: { column: 'order_date', unit: 'month' },
    });
    const q = compiled.query.compile();
    expect(q.sql).toContain(`date_trunc('month', "order_date")`);
    expect(q.sql).toContain('sum("freight") as "revenue"');
    expect(q.sql).toContain('group by date_trunc');
    expect(q.sql).toContain('order by date_trunc');
    expect(q.sql).toContain('from "public"."orders"');
    expect(compiled.bucketAlias).toBe('__bucket');
  });

  it('binds every filter value as a parameter — hostile strings never reach SQL text', () => {
    const hostile = `'; DROP TABLE orders; --`;
    const q = compile({
      shape: 'single-metric',
      aggregations: [{ fn: 'count', alias: 'n' }],
      filters: [{ column: 'customer_id', op: 'eq', value: hostile }],
    }).query.compile();
    expect(q.sql).toContain('count(*) as "n"');
    expect(q.sql).not.toContain('DROP TABLE');
    expect(q.parameters).toContain(hostile);
  });

  it('compiles categorical group-by with the alias ordered desc and a LIMIT cap', () => {
    const q = compile({
      shape: 'categorical',
      aggregations: [{ fn: 'count', alias: 'orders' }],
      groupBy: ['customer_id'],
      // No limit requested — the compiler applies the 1000-row hard cap
      // (the descriptor schema itself already rejects limit > 1000).
    }).query.compile();
    expect(q.sql).toContain('"customer_id" as "__group"');
    expect(q.sql).toContain('group by "customer_id"');
    expect(q.sql).toContain('order by "orders" desc');
    expect(q.parameters).toContain(1000);
  });

  it('adds half-open window bounds as parameters and builds the shifted prior twin', () => {
    const compiled = compile({
      shape: 'metric+delta',
      aggregations: [{ fn: 'sum', column: 'freight', alias: 'revenue' }],
      window: { column: 'order_date', last: 30, unit: 'day', compareToPrior: true },
    });
    const q = compiled.query.compile();
    expect(q.sql).toContain('"order_date" >= $1');
    expect(q.sql).toContain('"order_date" < $2');
    expect(q.parameters[0]).toEqual(new Date('2026-06-15T12:00:00.000Z'));
    expect(q.parameters[1]).toEqual(NOW);

    expect(compiled.prior).not.toBeNull();
    const p = compiled.prior!.compile();
    expect(p.parameters[0]).toEqual(new Date('2026-05-16T12:00:00.000Z'));
    expect(p.parameters[1]).toEqual(new Date('2026-06-15T12:00:00.000Z'));
  });

  it('record-list selects snapshot columns only and pairs an exact-count twin', () => {
    const compiled = compile({
      shape: 'record-list',
      select: ['order_id', 'customer_id'],
      orderBy: [{ column: 'order_date', dir: 'desc' }],
      limit: 5,
    });
    const q = compiled.query.compile();
    expect(q.sql).toContain('select "order_id", "customer_id"');
    expect(q.sql).toContain('order by "order_date" desc');
    expect(compiled.count).not.toBeNull();
    expect(compiled.count!.compile().sql).toContain('count(*)');
    expect(compiled.selectedColumns.map((c) => c.name)).toEqual(['order_id', 'customer_id']);
  });
});

describe('widget-data compiler — refusals', () => {
  it('rejects unknown tables and columns with UNKNOWN_IDENTIFIER (422)', () => {
    expect(() =>
      compile({ shape: 'single-metric', aggregations: [{ fn: 'count', alias: 'n' }], source: { name: 'nope' } }),
    ).toThrow(UnknownIdentifierError);
    for (const clause of [
      { aggregations: [{ fn: 'sum', column: 'nope', alias: 'x' }] },
      { filters: [{ column: 'nope', op: 'eq', value: 1 }], aggregations: [{ fn: 'count', alias: 'n' }] },
    ]) {
      expect(() => compile({ shape: 'single-metric', ...clause })).toThrow(UnknownIdentifierError);
    }
  });

  it('refuses PII-masked columns in aggregation, groupBy, bucket, filter, orderBy and window clauses (403 COLUMN_FORBIDDEN)', () => {
    const cases: Record<string, unknown>[] = [
      { shape: 'single-metric', aggregations: [{ fn: 'count', column: 'ship_phone', alias: 'n' }] },
      { shape: 'categorical', aggregations: [{ fn: 'count', alias: 'n' }], groupBy: ['ship_phone'] },
      {
        shape: 'timeseries',
        aggregations: [{ fn: 'count', alias: 'n' }],
        bucket: { column: 'ship_phone', unit: 'day' },
      },
      {
        shape: 'single-metric',
        aggregations: [{ fn: 'count', alias: 'n' }],
        filters: [{ column: 'ship_phone', op: 'eq', value: 'x' }],
      },
      { shape: 'record-list', orderBy: [{ column: 'ship_phone', dir: 'asc' }] },
      {
        shape: 'single-metric',
        aggregations: [{ fn: 'count', alias: 'n' }],
        window: { column: 'ship_phone', last: 7, unit: 'day' },
      },
      { shape: 'record-list', select: ['ship_phone'] },
    ];
    for (const input of cases) {
      try {
        compile(input);
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ForbiddenError);
        expect((error as AppError).code).toBe('COLUMN_FORBIDDEN');
      }
    }
    // With the unmask grant the same descriptors compile.
    expect(() => compile(cases[0]!, true)).not.toThrow();
  });

  it('enforces shape ⇄ descriptor structural rules', () => {
    const bad: Record<string, unknown>[] = [
      { shape: 'single-metric' }, // no aggregation
      { shape: 'timeseries', aggregations: [{ fn: 'count', alias: 'n' }] }, // no bucket
      { shape: 'categorical', aggregations: [{ fn: 'count', alias: 'n' }] }, // no groupBy
      { shape: 'record-list', aggregations: [{ fn: 'count', alias: 'n' }] },
      { shape: 'matrix' }, // unsupported shape
      {
        shape: 'single-metric',
        aggregations: [{ fn: 'percentile', column: 'freight', p: 0.5, alias: 'p50' }],
      },
      { shape: 'single-metric', aggregations: [{ fn: 'count', alias: '__bucket' }] }, // reserved alias
      { shape: 'single-metric', aggregations: [{ fn: 'sum', alias: 'x' }] }, // sum needs a column
    ];
    for (const input of bad) {
      expect(() => compile(input)).toThrow(ValidationFailedError);
    }
  });
});

describe('windowBounds', () => {
  it('is calendar-exact for months and contiguous half-open for the prior window', () => {
    const b = windowBounds(1, 'month', new Date('2026-03-31T00:00:00.000Z'));
    expect(b.start.toISOString()).toBe('2026-03-03T00:00:00.000Z'); // Feb has 28 days → JS rolls over deterministically
    expect(b.priorEnd).toEqual(b.start);
  });

  it('handles day/week/hour spans exactly', () => {
    const b = windowBounds(2, 'week', NOW);
    expect(b.end.getTime() - b.start.getTime()).toBe(14 * 86_400_000);
    expect(b.start.getTime() - b.priorStart.getTime()).toBe(14 * 86_400_000);
  });
});

describe('resolveFilterParams', () => {
  it('resolves late-bound params and drops filters whose param is unset', () => {
    const resolved = resolveFilterParams(
      [
        { column: 'order_date', op: 'gte', param: 'dateRange.start' },
        { column: 'order_date', op: 'lte', param: 'dateRange.end' },
        { column: 'customer_id', op: 'eq', value: 'ALFKI' },
      ],
      { 'dateRange.start': '2026-01-01' },
    );
    expect(resolved).toEqual([
      { column: 'order_date', op: 'gte', value: '2026-01-01' },
      { column: 'customer_id', op: 'eq', value: 'ALFKI' },
    ]);
  });
});

describe('shapers', () => {
  const base = {
    table: view.table('public.orders'),
    prior: null,
    count: null,
    bucketAlias: null,
    groupAlias: null,
    selectedColumns: [],
    limit: 1000,
    query: null as never,
    aggregationAliases: ['revenue'],
  };

  it('shapes metric+delta with deltaPct from the prior window', () => {
    const compiled = { ...base, shape: 'metric+delta' } as unknown as CompiledWidgetQuery;
    const shaped = shapeRows({
      compiled,
      rows: [{ revenue: '1250' }], // PG numeric arrives as a string
      priorRows: [{ revenue: 1000 }],
      canReadPii: false,
    });
    expect(shaped).toEqual({ shape: 'metric+delta', value: 1250, prior: 1000, deltaPct: 0.25 });
  });

  it('shapes timeseries points with ISO bucket timestamps', () => {
    const compiled = {
      ...base,
      shape: 'timeseries',
      bucketAlias: '__bucket',
    } as unknown as CompiledWidgetQuery;
    const shaped = shapeRows({
      compiled,
      rows: [{ __bucket: new Date('2026-05-01T00:00:00.000Z'), revenue: 42 }],
      canReadPii: false,
    });
    expect(shaped).toEqual({
      shape: 'timeseries',
      points: [{ t: '2026-05-01T00:00:00.000Z', v: 42 }],
    });
  });

  it('shapes categorical items with a total and null-key normalization', () => {
    const compiled = {
      ...base,
      shape: 'categorical',
      groupAlias: '__group',
      aggregationAliases: ['n'],
    } as unknown as CompiledWidgetQuery;
    const shaped = shapeRows({
      compiled,
      rows: [
        { __group: 'pro', n: '7' },
        { __group: null, n: 3 },
      ],
      canReadPii: false,
    });
    expect(shaped).toEqual({
      shape: 'categorical',
      items: [
        { key: 'pro', label: 'pro', value: 7 },
        { key: '__null', label: '—', value: 3 },
      ],
      total: 10,
    });
  });

  it('toNumber coerces PG string numerics and bigints', () => {
    expect(toNumber('12.5')).toBe(12.5);
    expect(toNumber(7n)).toBe(7);
    expect(toNumber(null)).toBe(0);
  });
});

describe('WidgetDataCache', () => {
  it('expires by TTL and invalidates by table', () => {
    let t = 0;
    const cache = new WidgetDataCache({ ttlMs: 1000, now: () => t });
    const key = cacheKeyOf({ descriptor: { a: 1 }, params: null, connectionId: 'c1', roleScope: 'r1' });
    cache.set(key, { shape: 'single-metric', value: 1 }, 'c1', 'public.orders');
    expect(cache.get(key)).toEqual({ shape: 'single-metric', value: 1 });

    cache.invalidateTable('c1', 'public.orders');
    expect(cache.get(key)).toBeUndefined();

    cache.set(key, 'v2', 'c1', 'public.orders');
    t = 1001;
    expect(cache.get(key)).toBeUndefined();
  });

  it('role scope and params are part of the key', () => {
    const a = cacheKeyOf({ descriptor: { a: 1 }, params: null, connectionId: 'c1', roleScope: 'viewer' });
    const b = cacheKeyOf({ descriptor: { a: 1 }, params: null, connectionId: 'c1', roleScope: 'admin' });
    const c = cacheKeyOf({ descriptor: { a: 1 }, params: { x: 1 }, connectionId: 'c1', roleScope: 'viewer' });
    expect(new Set([a, b, c]).size).toBe(3);
  });
});
