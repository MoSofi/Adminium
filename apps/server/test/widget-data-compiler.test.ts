// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Offline unit tests for the widget-data query-descriptor compiler
 * (04-widget-registry.md §5.2): SQL-text assertions over dynamic Kysely
 * with a dummy driver proving identifiers come from the snapshot, values
 * bind as parameters, time buckets compile per dialect (Postgres
 * `date_trunc`, MySQL `DATE_FORMAT`, SQLite `strftime`), window bounds are
 * calendar-correct, masked columns refuse in every clause, and the shape ⇄
 * descriptor structural rules hold. Shaper + cache units ride along — no
 * database required.
 */

import {
  DummyDriver,
  Kysely,
  MysqlAdapter,
  MysqlIntrospector,
  MysqlQueryCompiler,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
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
    /**
     * The shapes added after the six-shape subset need column types `orders`
     * has no reason to carry: a self-referencing parent (`hierarchy/tree`), a
     * REAL coordinate pair and a text region code (`geo-points` classifies by
     * logical type), a boolean (`boolean-map`), and a masked column to prove
     * every row-bearing form still masks.
     */
    {
      id: 'public.places',
      schema: 'public',
      name: 'places',
      kind: 'table',
      primaryKey: ['id'],
      columns: [
        { name: 'id', logicalType: 'integer', nullable: false, isPrimaryKey: true, semantics: null },
        { name: 'name', logicalType: 'varchar', nullable: true, isPrimaryKey: false, semantics: null },
        { name: 'parent_id', logicalType: 'integer', nullable: true, isPrimaryKey: false, semantics: null },
        { name: 'region_code', logicalType: 'varchar', nullable: true, isPrimaryKey: false, semantics: null },
        { name: 'lat', logicalType: 'float', nullable: true, isPrimaryKey: false, semantics: null },
        { name: 'lng', logicalType: 'float', nullable: true, isPrimaryKey: false, semantics: null },
        { name: 'visits', logicalType: 'integer', nullable: true, isPrimaryKey: false, semantics: null },
        { name: 'active', logicalType: 'boolean', nullable: true, isPrimaryKey: false, semantics: null },
        { name: 'opened_at', logicalType: 'timestamp', nullable: true, isPrimaryKey: false, semantics: null },
        { name: 'price', logicalType: 'decimal', nullable: true, isPrimaryKey: false, semantics: null },
        {
          name: 'contact_email',
          logicalType: 'varchar',
          nullable: true,
          isPrimaryKey: false,
          semantics: semantics({ primary: 'email', flags: { secret: false, pii: 'email', maskedByDefault: true } }),
        },
        {
          // A masked NUMERIC column: `ohlc` coerces every candle field through
          // `toNumber`, so a masked text column would vanish from its payload
          // by coercion rather than by masking, and the leak test would pass
          // for the wrong reason.
          name: 'owner_payout',
          logicalType: 'decimal',
          nullable: true,
          isPrimaryKey: false,
          semantics: semantics({ primary: 'money', flags: { secret: false, pii: 'financial', maskedByDefault: true } }),
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
    dialect: 'postgres',
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
      // `matrix` is COMPILABLE now, so this row no longer tests "unsupported
      // shape" — it tests matrix's own rule that a cell needs an aggregation.
      { shape: 'matrix' },
      // …and its other two rules, which the old "unsupported shape" row hid.
      {
        shape: 'matrix',
        aggregations: [{ fn: 'count', alias: 'n' }],
        groupBy: ['customer_id'],
      }, // needs exactly two groupBy keys
      {
        shape: 'matrix',
        aggregations: [{ fn: 'count', alias: 'n' }],
        groupBy: ['customer_id', 'order_id'],
        bucket: { column: 'order_date', unit: 'month' },
      }, // cannot time-bucket
      { shape: 'single-metric', aggregations: [{ fn: 'count', alias: '__bucket' }] }, // reserved alias
      { shape: 'single-metric', aggregations: [{ fn: 'sum', alias: 'x' }] }, // sum needs a column
    ];
    for (const input of bad) {
      expect(() => compile(input)).toThrow(ValidationFailedError);
    }
  });

  /**
   * `percentile` used to reject unconditionally, and this suite pinned that by
   * listing it among the structural refusals above. It is now a supported
   * aggregation, so the assertion inverts: Postgres emits `percentile_cont`
   * inline, while SQLite (no percentile function at all) and MySQL 8 (no
   * `percentile_cont`) fall back to the documented in-process scan.
   */
  it('compiles percentile natively on postgres and via a scan on sqlite/mysql', () => {
    const descriptorInput = {
      shape: 'single-metric' as const,
      aggregations: [{ fn: 'percentile', column: 'freight', p: 0.5, alias: 'p50' }],
    };

    const pg = compile(descriptorInput);
    expect(pg.percentileScan).toBeNull();
    expect(pg.query.compile().sql).toContain('percentile_cont');

    for (const dialect of ['sqlite', 'mysql'] as const) {
      const scanned = compileWidgetQuery({
        db,
        view,
        descriptor: descriptor(descriptorInput),
        canReadPii: false,
        dialect,
        now: () => NOW,
      });
      expect(scanned.percentileScan).not.toBeNull();
      expect(scanned.query.compile().sql).not.toContain('percentile_cont');
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

// Dialect divergence (04 §5.2 step 4): the `date_trunc` cases above assert the
// Postgres path; time bucketing and rolling-window bounds are the two clauses
// whose SQL differs per engine. These pin the MySQL/SQLite SQL text so the
// M9-T05 cross-engine regression (500 on sqlite/mysql — `no such function:
// date_trunc`, and better-sqlite3 refusing to bind a `Date`) stays fixed.
describe('widget-data compiler — per-dialect bucket/window SQL', () => {
  const mysqlDb = new Kysely<SourceDatabase>({
    dialect: {
      createAdapter: () => new MysqlAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (k) => new MysqlIntrospector(k),
      createQueryCompiler: () => new MysqlQueryCompiler(),
    },
  });
  const sqliteDb = new Kysely<SourceDatabase>({
    dialect: {
      createAdapter: () => new SqliteAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (k) => new SqliteIntrospector(k),
      createQueryCompiler: () => new SqliteQueryCompiler(),
    },
  });

  function bucketSql(engine: 'mysql' | 'sqlite', unit: string): string {
    return compileWidgetQuery({
      db: engine === 'mysql' ? mysqlDb : sqliteDb,
      view,
      dialect: engine,
      descriptor: descriptor({
        shape: 'timeseries',
        aggregations: [{ fn: 'count', alias: 'value' }],
        bucket: { column: 'order_date', unit },
      }),
      canReadPii: false,
      now: () => NOW,
    }).query.compile().sql;
  }

  it('sqlite buckets compile to strftime for every unit — never date_trunc', () => {
    // Full bucket expressions (identical text drives SELECT, GROUP BY, ORDER BY).
    const expected: Record<string, string> = {
      hour: `strftime('%Y-%m-%d %H:00:00', "order_date")`,
      day: `strftime('%Y-%m-%d', "order_date")`,
      week: `date("order_date", '-' || ((strftime('%w', "order_date") + 6) % 7) || ' days')`,
      month: `strftime('%Y-%m-01', "order_date")`,
      quarter: `strftime('%Y', "order_date") || '-' || printf('%02d', ((cast(strftime('%m', "order_date") as integer) - 1) / 3) * 3 + 1) || '-01'`,
      year: `strftime('%Y-01-01', "order_date")`,
    };
    for (const [unit, needle] of Object.entries(expected)) {
      const sql = bucketSql('sqlite', unit);
      expect(sql, `unit=${unit}`).toContain(needle);
      expect(sql, `unit=${unit}`).not.toContain('date_trunc');
      // The same expression drives SELECT, GROUP BY and ORDER BY.
      expect(sql, `unit=${unit}`).toContain(`group by ${needle}`);
      expect(sql, `unit=${unit}`).toContain(`order by ${needle}`);
    }
  });

  it('mysql buckets compile to DATE_FORMAT/calendar functions for every unit — never date_trunc', () => {
    const expected: Record<string, string> = {
      hour: "date_format(`order_date`, '%Y-%m-%d %H:00:00')",
      day: "date_format(`order_date`, '%Y-%m-%d')",
      week: 'date_sub(date(`order_date`), interval weekday(`order_date`) day)',
      month: "date_format(`order_date`, '%Y-%m-01')",
      quarter: 'date(makedate(year(`order_date`), 1) + interval (quarter(`order_date`) - 1) quarter)',
      year: "date_format(`order_date`, '%Y-01-01')",
    };
    for (const [unit, needle] of Object.entries(expected)) {
      const sql = bucketSql('mysql', unit);
      expect(sql, `unit=${unit}`).toContain(needle);
      expect(sql, `unit=${unit}`).not.toContain('date_trunc');
    }
  });

  it('binds window bounds as UTC strings on mysql/sqlite (a Date crashes better-sqlite3)', () => {
    for (const engine of ['mysql', 'sqlite'] as const) {
      const params = compileWidgetQuery({
        db: engine === 'mysql' ? mysqlDb : sqliteDb,
        view,
        dialect: engine,
        descriptor: descriptor({
          shape: 'metric+delta',
          aggregations: [{ fn: 'count', alias: 'value' }],
          window: { column: 'order_date', last: 30, unit: 'day', compareToPrior: true },
        }),
        canReadPii: false,
        now: () => NOW,
      }).query.compile().parameters;
      // NOW = 2026-07-15T12:00:00Z, 30d back = 2026-06-15T12:00:00Z.
      expect(params[0], engine).toBe('2026-06-15 12:00:00');
      expect(params[1], engine).toBe('2026-07-15 12:00:00');
      // Never a Date instance — the whole point of the fix.
      expect(params.every((p) => !(p instanceof Date)), engine).toBe(true);
    }
  });

  it('postgres still binds window bounds as Date objects (unchanged)', () => {
    const params = compile({
      shape: 'metric+delta',
      aggregations: [{ fn: 'count', alias: 'value' }],
      window: { column: 'order_date', last: 30, unit: 'day' },
    }).query.compile().parameters;
    expect(params[0]).toBeInstanceOf(Date);
    expect(params[1]).toBeInstanceOf(Date);
  });
});

/**
 * The last five compiler gaps (`hierarchy/tree`, `geo-points`, `flows`, `ohlc`,
 * `boolean-map`). Four of them have TWO descriptor forms — a rollup and a row
 * projection — so each is pinned twice: once for the SQL, once for the envelope
 * the shaper emits from it.
 */
function places(input: Record<string, unknown>, canReadPii = false): CompiledWidgetQuery {
  return compileWidgetQuery({
    db,
    view,
    descriptor: queryDescriptorSchema.parse({
      connectionId: 'conn_1',
      source: { name: 'places', schema: 'public' },
      ...input,
    }),
    canReadPii,
    dialect: 'postgres',
    now: () => NOW,
  });
}

describe('widget-data compiler — hierarchy/tree', () => {
  it('rolls up two group keys into branch/leaf SQL', () => {
    const compiled = places({
      shape: 'hierarchy/tree',
      aggregations: [{ fn: 'sum', column: 'visits', alias: 'total' }],
      groupBy: ['region_code', 'name'],
    });
    const q = compiled.query.compile();
    expect(q.sql).toContain('"region_code" as "__group"');
    expect(q.sql).toContain('"name" as "__col"');
    expect(q.sql).toContain('sum("visits") as "total"');
    expect(compiled.rowShape).toBe(false);
    expect(compiled.colAlias).toBe('__col');
  });

  it('shapes a rollup into roots whose value is the sum of their leaves', () => {
    const compiled = places({
      shape: 'hierarchy/tree',
      aggregations: [{ fn: 'sum', column: 'visits', alias: 'total' }],
      groupBy: ['region_code', 'name'],
    });
    const shaped = shapeRows({
      compiled,
      rows: [
        { __group: 'EU', __col: 'Berlin', total: 10 },
        { __group: 'EU', __col: 'Paris', total: '5' },
        { __group: null, __col: 'Nowhere', total: 2 },
      ],
      canReadPii: false,
    });
    expect(shaped).toEqual({
      shape: 'hierarchy/tree',
      roots: [
        {
          id: 'EU',
          label: 'EU',
          value: 15,
          children: [
            { id: 'EU/Berlin', label: 'Berlin', value: 10, children: [] },
            { id: 'EU/Paris', label: 'Paris', value: 5, children: [] },
          ],
        },
        {
          id: '__null',
          label: '—',
          value: 2,
          children: [{ id: '__null/Nowhere', label: 'Nowhere', value: 2, children: [] }],
        },
      ],
    });
  });

  it('assembles an adjacency projection, masks it, and keeps meta columns', () => {
    const compiled = places(
      { shape: 'hierarchy/tree', select: ['id', 'name', 'parent_id', 'contact_email'] },
      true,
    );
    expect(compiled.rowShape).toBe(true);
    expect(compiled.query.compile().sql).toContain('select "id", "name", "parent_id", "contact_email"');

    const rows = [
      { id: 1, name: 'root', parent_id: null, contact_email: 'a@example.com' },
      { id: 2, name: 'child', parent_id: 1, contact_email: 'b@example.com' },
    ];
    const shaped = shapeRows({ compiled, rows, canReadPii: true }) as { roots: unknown[] };
    expect(shaped).toEqual({
      shape: 'hierarchy/tree',
      roots: [
        {
          id: '1',
          label: 'root',
          meta: { contact_email: 'a@example.com' },
          children: [
            { id: '2', label: 'child', meta: { contact_email: 'b@example.com' }, children: [] },
          ],
        },
      ],
    });

    // Same rows without the unmask grant: the tree still assembles, the meta
    // column does not survive in the clear.
    const masked = shapeRows({ compiled, rows, canReadPii: false }) as {
      roots: { meta: Record<string, unknown> }[];
    };
    expect(masked.roots[0]!.meta.contact_email).not.toBe('a@example.com');
  });

  it('promotes orphans to roots and refuses to recurse on a parent cycle', () => {
    const compiled = places({ shape: 'hierarchy/tree', select: ['id', 'name', 'parent_id'] });
    const shaped = shapeRows({
      compiled,
      rows: [
        // parent 99 was never fetched — an orphan, not a dropped row.
        { id: 1, name: 'orphan', parent_id: 99 },
        // 2 → 3 → 2 is a loop; both flatten to roots rather than nesting forever.
        { id: 2, name: 'a', parent_id: 3 },
        { id: 3, name: 'b', parent_id: 2 },
      ],
      canReadPii: false,
    }) as { roots: { id: string; children: unknown[] }[] };
    expect(shaped.roots.map((root) => root.id)).toEqual(['1', '2', '3']);
    expect(shaped.roots.every((root) => root.children.length === 0)).toBe(true);
    // The whole payload must survive JSON — a cycle that slipped through would
    // throw here rather than in the route.
    expect(() => JSON.stringify(shaped)).not.toThrow();
  });
});

describe('widget-data compiler — geo-points', () => {
  it('rolls up one region key into a point per code with every aggregate as a metric', () => {
    const compiled = places({
      shape: 'geo-points',
      aggregations: [
        { fn: 'count', alias: 'visits_n' },
        { fn: 'sum', column: 'price', alias: 'revenue' },
      ],
      groupBy: ['region_code'],
    });
    expect(compiled.rowShape).toBe(false);
    const shaped = shapeRows({
      compiled,
      rows: [{ __group: 'DE', visits_n: 4, revenue: '99.5' }],
      canReadPii: false,
    });
    expect(shaped).toEqual({
      shape: 'geo-points',
      points: [{ name: 'DE', code: 'DE', values: { visits_n: 4, revenue: 99.5 } }],
    });
  });

  it('reads a REAL pair as coordinates and anything else as a region code', () => {
    const coordinates = places({ shape: 'geo-points', select: ['name', 'lat', 'lng', 'visits'] });
    expect(
      shapeRows({
        compiled: coordinates,
        rows: [{ name: 'Berlin', lat: 52.52, lng: 13.405, visits: 12 }],
        canReadPii: false,
      }),
    ).toEqual({
      shape: 'geo-points',
      points: [{ name: 'Berlin', lat: 52.52, lng: 13.405, values: { visits: 12 } }],
    });

    // `region_code` is varchar, so position 2 is a code and the rest metrics.
    const regions = places({ shape: 'geo-points', select: ['name', 'region_code', 'visits'] });
    expect(
      shapeRows({
        compiled: regions,
        rows: [{ name: 'Germany', region_code: 'DE', visits: 3 }],
        canReadPii: false,
      }),
    ).toEqual({
      shape: 'geo-points',
      points: [{ name: 'Germany', code: 'DE', values: { visits: 3 } }],
    });
  });

  it('drops rows that can be placed neither by coordinates nor by code', () => {
    const compiled = places({ shape: 'geo-points', select: ['name', 'lat', 'lng'] });
    const shaped = shapeRows({
      compiled,
      rows: [
        { name: 'nowhere', lat: null, lng: null },
        { name: 'Berlin', lat: 52.52, lng: 13.405 },
      ],
      canReadPii: false,
    }) as { points: unknown[] };
    // Never plotted at (0, 0) off West Africa.
    expect(shaped.points).toEqual([{ name: 'Berlin', lat: 52.52, lng: 13.405, values: {} }]);
  });
});

describe('widget-data compiler — flows', () => {
  it('folds a two-key rollup into nodes, links and longest-path layers', () => {
    const compiled = places({
      shape: 'flows',
      aggregations: [{ fn: 'count', alias: 'weight' }],
      groupBy: ['region_code', 'name'],
    });
    const shaped = shapeRows({
      compiled,
      rows: [
        { __group: 'visited', __col: 'signed_up', weight: 30 },
        { __group: 'signed_up', __col: 'paid', weight: '12' },
        { __group: 'visited', __col: 'bounced', weight: 70 },
      ],
      canReadPii: false,
    });
    expect(shaped).toEqual({
      shape: 'flows',
      nodes: [
        { id: 'visited', label: 'visited', layer: 0 },
        { id: 'signed_up', label: 'signed_up', layer: 1 },
        { id: 'paid', label: 'paid', layer: 2 },
        { id: 'bounced', label: 'bounced', layer: 1 },
      ],
      links: [
        { from: 'visited', to: 'signed_up', weight: 30 },
        { from: 'signed_up', to: 'paid', weight: 12 },
        { from: 'visited', to: 'bounced', weight: 70 },
      ],
    });
  });

  it('terminates on a cyclic flow instead of recursing through it', () => {
    const compiled = places({
      shape: 'flows',
      aggregations: [{ fn: 'count', alias: 'weight' }],
      groupBy: ['region_code', 'name'],
    });
    const shaped = shapeRows({
      compiled,
      rows: [
        { __group: 'a', __col: 'b', weight: 1 },
        { __group: 'b', __col: 'a', weight: 1 },
      ],
      canReadPii: false,
    }) as { nodes: { id: string; layer: number }[] };
    expect(shaped.nodes.map((node) => node.id)).toEqual(['a', 'b']);
    expect(shaped.nodes.every((node) => Number.isFinite(node.layer))).toBe(true);
  });
});

describe('widget-data compiler — ohlc', () => {
  it('projects raw ticks in time order and folds them into candles', () => {
    const compiled = places({
      shape: 'ohlc',
      select: ['price'],
      bucket: { column: 'opened_at', unit: 'day' },
    });
    const q = compiled.query.compile();
    // No GROUP BY: open/close are the first/last row of each bucket run, which
    // is why the ORDER BY on the raw column is load-bearing.
    expect(q.sql).not.toContain('group by');
    expect(q.sql).toContain('order by "opened_at" asc');
    expect(q.sql).toContain(`date_trunc('day', "opened_at")`);
    expect(q.parameters).toContain(50_000);
    expect(compiled.ohlcScan).toEqual({ bucketAlias: '__bucket', valueAlias: '__value' });

    const shaped = shapeRows({
      compiled,
      rows: [
        { __bucket: new Date('2026-05-01T00:00:00.000Z'), __value: 10 },
        { __bucket: new Date('2026-05-01T00:00:00.000Z'), __value: '14' },
        { __bucket: new Date('2026-05-01T00:00:00.000Z'), __value: null }, // NULL ticks skip
        { __bucket: new Date('2026-05-01T00:00:00.000Z'), __value: 7 },
        { __bucket: new Date('2026-05-02T00:00:00.000Z'), __value: 9 },
      ],
      canReadPii: false,
    });
    expect(shaped).toEqual({
      shape: 'ohlc',
      candles: [
        { t: '2026-05-01T00:00:00.000Z', o: 10, h: 14, l: 7, c: 7 },
        { t: '2026-05-02T00:00:00.000Z', o: 9, h: 9, l: 9, c: 9 },
      ],
    });
  });

  it('reads a table that already stores candles, sorted by time by default', () => {
    const compiled = places({
      shape: 'ohlc',
      select: ['opened_at', 'price', 'lat', 'lng', 'visits'],
    });
    expect(compiled.rowShape).toBe(true);
    expect(compiled.ohlcScan).toBeNull();
    expect(compiled.query.compile().sql).toContain('order by "opened_at" asc');

    const shaped = shapeRows({
      compiled,
      rows: [{ opened_at: '2026-05-01T00:00:00.000Z', price: '1', lat: 3, lng: 0.5, visits: 2 }],
      canReadPii: false,
    });
    expect(shaped).toEqual({
      shape: 'ohlc',
      candles: [{ t: '2026-05-01T00:00:00.000Z', o: 1, h: 3, l: 0.5, c: 2 }],
    });
  });

  it('folds candles without date_trunc on sqlite', () => {
    const sqlite = new Kysely<SourceDatabase>({
      dialect: {
        createAdapter: () => new SqliteAdapter(),
        createDriver: () => new DummyDriver(),
        createIntrospector: (k) => new SqliteIntrospector(k),
        createQueryCompiler: () => new SqliteQueryCompiler(),
      },
    });
    const sql = compileWidgetQuery({
      db: sqlite,
      view,
      dialect: 'sqlite',
      descriptor: queryDescriptorSchema.parse({
        connectionId: 'conn_1',
        source: { name: 'places', schema: 'public' },
        shape: 'ohlc',
        select: ['price'],
        bucket: { column: 'opened_at', unit: 'day' },
      }),
      canReadPii: false,
      now: () => NOW,
    }).query.compile().sql;
    expect(sql).toContain(`strftime('%Y-%m-%d', "opened_at")`);
    expect(sql).not.toContain('date_trunc');
  });
});

describe('widget-data compiler — boolean-map', () => {
  it('folds [key, flag] rows into entries, reading every engine truth encoding', () => {
    const compiled = places({ shape: 'boolean-map', select: ['name', 'active'] });
    expect(compiled.rowShape).toBe(true);
    const shaped = shapeRows({
      compiled,
      rows: [
        { name: 'pg', active: true },
        { name: 'mysql', active: 1 },
        { name: 'sqlite', active: 0 },
        { name: 'text-t', active: 't' },
        { name: 'text-no', active: 'no' },
        { name: null, active: true }, // no key — cannot be an entry
      ],
      canReadPii: false,
    });
    expect(shaped).toEqual({
      shape: 'boolean-map',
      entries: { pg: true, mysql: true, sqlite: false, 'text-t': true, 'text-no': false },
    });
  });

  it('a row keyed __proto__ becomes an entry, never the prototype', () => {
    const compiled = places({ shape: 'boolean-map', select: ['name', 'active'] });
    const shaped = shapeRows({
      compiled,
      rows: [{ name: '__proto__', active: true }],
      canReadPii: false,
    }) as { entries: Record<string, boolean> };
    expect(Object.prototype.hasOwnProperty.call(shaped.entries, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(shaped.entries)).toBe(Object.prototype);
  });
});

describe('widget-data compiler — structural rules for the new shapes', () => {
  it('rejects every malformed form with 422', () => {
    const bad: Record<string, unknown>[] = [
      { shape: 'hierarchy/tree', select: ['id', 'name'] }, // adjacency needs 3
      {
        shape: 'hierarchy/tree',
        groupBy: ['region_code', 'name'],
      }, // rollup needs an aggregation
      {
        shape: 'hierarchy/tree',
        aggregations: [{ fn: 'count', alias: 'n' }],
        groupBy: ['region_code'],
      }, // rollup needs two keys
      { shape: 'geo-points', select: ['name'] }, // needs a code or a pair
      {
        shape: 'geo-points',
        aggregations: [{ fn: 'count', alias: 'n' }],
        groupBy: ['region_code', 'name'],
      }, // rollup is one key
      { shape: 'flows', groupBy: ['region_code', 'name'] }, // no weight
      { shape: 'flows', aggregations: [{ fn: 'count', alias: 'n' }], groupBy: ['region_code'] },
      { shape: 'ohlc', select: ['opened_at', 'price'] }, // neither form
      {
        shape: 'ohlc',
        select: ['price'],
        bucket: { column: 'opened_at', unit: 'day' },
        aggregations: [{ fn: 'sum', column: 'price', alias: 'x' }],
      }, // bucketed ohlc derives its own o/h/l/c
      { shape: 'boolean-map', select: ['name'] },
      { shape: 'boolean-map', select: ['name', 'active', 'visits'] },
    ];
    for (const input of bad) {
      expect(() => places(input), JSON.stringify(input)).toThrow(ValidationFailedError);
    }
  });

  it('refuses a masked column in every new shape, in both of its forms', () => {
    const cases: Record<string, unknown>[] = [
      { shape: 'hierarchy/tree', select: ['id', 'name', 'contact_email'] },
      {
        shape: 'hierarchy/tree',
        aggregations: [{ fn: 'count', alias: 'n' }],
        groupBy: ['contact_email', 'name'],
      },
      { shape: 'geo-points', select: ['contact_email', 'lat', 'lng'] },
      { shape: 'geo-points', aggregations: [{ fn: 'count', alias: 'n' }], groupBy: ['contact_email'] },
      {
        shape: 'flows',
        aggregations: [{ fn: 'count', alias: 'n' }],
        groupBy: ['region_code', 'contact_email'],
      },
      { shape: 'ohlc', select: ['contact_email'], bucket: { column: 'opened_at', unit: 'day' } },
      { shape: 'boolean-map', select: ['contact_email', 'active'] },
    ];
    for (const input of cases) {
      try {
        places(input);
        expect.unreachable(`should have refused ${JSON.stringify(input)}`);
      } catch (error) {
        expect(error).toBeInstanceOf(ForbiddenError);
        expect((error as AppError).code).toBe('COLUMN_FORBIDDEN');
      }
    }
  });
});

/**
 * The single highest-risk invariant of the widget-data layer: the compiler
 * refuses a masked column the caller NAMED, but a row-bearing descriptor that
 * omits `select` falls back to every selectable column — masked ones included.
 * Masking therefore lives in the shaper, and this walks every row-bearing form
 * to prove none of them forgot the call.
 */
describe('widget-data shapers — every row-bearing shape masks', () => {
  const EMAIL = 'leak@example.com';
  const PAYOUT = '4242.42';

  const rowForms: {
    shape: string;
    input: Record<string, unknown>;
    read: (payload: unknown) => unknown[];
    /** The masked value this form's envelope would carry if masking were skipped. */
    secret: string;
  }[] = [
    {
      shape: 'record-list',
      input: { shape: 'record-list' },
      read: (payload) => (payload as { rows: unknown[] }).rows,
      secret: EMAIL,
    },
    {
      shape: 'record',
      input: { shape: 'record' },
      read: (payload) => [(payload as { row: unknown }).row],
      secret: EMAIL,
    },
    {
      shape: 'stream',
      input: { shape: 'stream' },
      read: (payload) => (payload as { snapshot: unknown[] }).snapshot,
      secret: EMAIL,
    },
    {
      shape: 'calendar-events',
      input: { shape: 'calendar-events', select: ['opened_at', 'contact_email'] },
      read: (payload) => (payload as { events: unknown[] }).events,
      secret: EMAIL,
    },
    {
      shape: 'hierarchy/tree',
      input: { shape: 'hierarchy/tree', select: ['id', 'name', 'parent_id', 'contact_email'] },
      read: (payload) => (payload as { roots: unknown[] }).roots,
      secret: EMAIL,
    },
    {
      shape: 'geo-points',
      input: { shape: 'geo-points', select: ['contact_email', 'lat', 'lng'] },
      read: (payload) => (payload as { points: unknown[] }).points,
      secret: EMAIL,
    },
    {
      // Numeric secret on purpose — see the `owner_payout` column comment.
      shape: 'ohlc',
      input: { shape: 'ohlc', select: ['opened_at', 'price', 'lat', 'lng', 'owner_payout'] },
      read: (payload) => (payload as { candles: unknown[] }).candles,
      secret: PAYOUT,
    },
    {
      shape: 'boolean-map',
      input: { shape: 'boolean-map', select: ['contact_email', 'active'] },
      read: (payload) => [(payload as { entries: unknown }).entries],
      secret: EMAIL,
    },
  ];

  const row = {
    id: 1,
    name: 'a',
    parent_id: null,
    region_code: 'DE',
    lat: 1.5,
    lng: 2.5,
    visits: 1,
    active: true,
    opened_at: '2026-05-01T09:30:00.000Z',
    price: 3,
    contact_email: EMAIL,
    owner_payout: Number(PAYOUT),
  };

  for (const form of rowForms) {
    it(`${form.shape} never emits a masked value without the unmask grant`, () => {
      // Compiled WITH the grant so the explicit `contact_email` resolves; shaped
      // without it, which is exactly the split the route can produce (the cache
      // key carries the role scope, the compiler does not re-check per row).
      const compiled = places(form.input, true);
      expect(compiled.rowShape).toBe(true);
      const shaped = shapeRows({
        compiled,
        rows: [row],
        canReadPii: false,
        connectionId: 'conn_1',
      });
      expect(JSON.stringify(form.read(shaped))).not.toContain(form.secret);
      // …and the same rows WITH the grant do carry it, so the assertion above
      // is testing masking and not an accidentally empty payload.
      const unmasked = shapeRows({ compiled, rows: [row], canReadPii: true, connectionId: 'conn_1' });
      expect(JSON.stringify(form.read(unmasked))).toContain(form.secret);
    });
  }
});
