// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Offline unit tests for the CRUD list DSL: the filter compiler over
 * dynamic Kysely with a dummy driver, SQL-text assertions proving
 * identifiers come from the snapshot and every value binds as a
 * parameter, structural limits, masked-column rejection, and the undo
 * store TTL machinery.
 */

import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely';
import { describe, expect, it } from 'vitest';

import type { EffectiveModel } from '../src/connections/effective-schema.js';
import type { SourceDatabase } from '../src/connections/manager.js';
import {
  assertFilterLimits,
  assertWhereEnvelope,
  compileFilter,
  compileQuickSearch,
  escapeLike,
  MAX_WHERE_BYTES,
  MAX_WHERE_DEPTH,
  parseWhereParam,
  recordFilterSchema,
  type CompileFilterContext,
  type RecordFilter,
} from '../src/crud/filters.js';
import type { Dialect } from '@adminium/engine';

import { SnapshotView, UnknownIdentifierError } from '../src/crud/identifiers.js';
import { parseOrder } from '../src/crud/list.js';
import { rowsEqual, UndoStore } from '../src/crud/undo.js';
import { AppError } from '../src/errors.js';

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

/** Minimal customers-ish effective model for the view. */
const model = {
  dialect: 'postgres',
  name: 'unit',
  defaultSchema: 'public',
  schemas: ['public'],
  enums: [],
  relations: [],
  tables: [
    {
      id: 'public.customers',
      schema: 'public',
      name: 'customers',
      kind: 'table',
      primaryKey: ['customer_id'],
      columns: [
        { name: 'customer_id', logicalType: 'varchar', nullable: false, isPrimaryKey: true, semantics: null },
        { name: 'company_name', logicalType: 'varchar', nullable: false, isPrimaryKey: false, semantics: null },
        { name: 'balance', logicalType: 'decimal', nullable: true, isPrimaryKey: false, semantics: null },
        { name: 'placed_at', logicalType: 'timestamptz', nullable: true, isPrimaryKey: false, semantics: null },
        {
          name: 'phone',
          logicalType: 'varchar',
          nullable: true,
          isPrimaryKey: false,
          semantics: semantics({ primary: 'phone', flags: { secret: false, pii: 'phone', maskedByDefault: true } }),
        },
        {
          name: 'password_hash',
          logicalType: 'text',
          nullable: true,
          isPrimaryKey: false,
          semantics: semantics({ primary: 'secret', flags: { secret: true, pii: null, maskedByDefault: false } }),
        },
      ],
    },
  ],
} as unknown as EffectiveModel;

const view = new SnapshotView('conn_1', model);
const table = view.table('public.customers');

const db = new Kysely<SourceDatabase>({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (kysely) => new PostgresIntrospector(kysely),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  },
});

function ctx(canReadPii = false, dialect: Dialect = 'postgres'): CompileFilterContext {
  return { view, table, canReadPii, dynamic: db.dynamic, dialect };
}

function compile(filter: RecordFilter, canReadPii = false, dialect: Dialect = 'postgres') {
  return db
    .selectFrom('public.customers')
    .selectAll()
    .where((eb) => compileFilter(eb as never, ctx(canReadPii, dialect), filter))
    .compile();
}

describe('filter DSL compiler', () => {
  it('compiles a nested tree with parameterized values and quoted snapshot identifiers', () => {
    const filter: RecordFilter = {
      and: [
        { column: 'company_name', op: 'ilike', value: '%acme%' },
        {
          or: [
            { column: 'balance', op: 'between', value: [10, 20] },
            { column: 'customer_id', op: 'in', value: ['A', 'B'] },
            { column: 'balance', op: 'is_null' },
          ],
        },
      ],
    };
    const compiled = compile(filter);
    expect(compiled.sql).toContain('"company_name" ilike $1');
    expect(compiled.sql).toContain('"balance" >= $2');
    expect(compiled.sql).toContain('"balance" <= $3');
    expect(compiled.sql).toContain('"customer_id" in ($4, $5)');
    expect(compiled.sql).toContain('"balance" is null');
    expect(compiled.parameters).toEqual(['%acme%', 10, 20, 'A', 'B']);
  });

  it('compiles the `ilike` op per dialect: native ILIKE on postgres, LOWER(...) LIKE on mysql/sqlite', () => {
    // Postgres keeps the native operator.
    const pg = compile({ column: 'company_name', op: 'ilike', value: '%acme%' });
    expect(pg.sql).toContain('"company_name" ilike $1');
    expect(pg.parameters).toEqual(['%acme%']);

    // MySQL and SQLite have no ILIKE — fold both operands with LOWER() so the
    // match stays case-insensitive regardless of collation, value still bound.
    for (const dialect of ['mysql', 'sqlite'] as const) {
      const compiled = compile({ column: 'company_name', op: 'ilike', value: '%acme%' }, false, dialect);
      expect(compiled.sql).toContain('lower("company_name") like lower($1)');
      expect(compiled.sql).not.toContain('ilike');
      expect(compiled.parameters).toEqual(['%acme%']);
    }
  });

  it('reads a time with no zone, for a column that keeps one, on this server’s clock — as a write does', () => {
    const at = new Date(2026, 8, 25, 11, 45);
    const iso = `${at.toISOString().slice(0, 19)}Z`;
    // Postgres gets the instant with its zone, never a text its session zone would read.
    expect(compile({ column: 'placed_at', op: 'gte', value: '2026-09-25 11:45' }).parameters).toEqual([iso]);
    expect(compile({ column: 'placed_at', op: 'between', value: ['2026-09-25 11:45', '2026-09-25T12:00:00Z'] }).parameters).toEqual([iso, '2026-09-25T12:00:00Z']);
    expect(compile({ column: 'placed_at', op: 'in', value: ['2026-09-25 11:45'] }).parameters).toEqual([iso]);
    // MySQL gets the same instant as UTC's wall time, its session's.
    expect(compile({ column: 'placed_at', op: 'eq', value: '2026-09-25 11:45' }, false, 'mysql').parameters).toEqual([at.toISOString().slice(0, 19).replace('T', ' ')]);
  });

  it('never lets a client value reach the SQL text (hostile value stays a parameter)', () => {
    const hostile = `"; DROP TABLE customers; --`;
    const compiled = compile({ column: 'company_name', op: 'eq', value: hostile });
    expect(compiled.sql).not.toContain('DROP TABLE');
    expect(compiled.parameters).toEqual([hostile]);
  });

  it('rejects hostile / unknown identifiers with UNKNOWN_IDENTIFIER (422)', () => {
    for (const column of ['"; DROP TABLE x; --', 'nope', 'company_name; --']) {
      try {
        compile({ column, op: 'eq', value: 1 });
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(UnknownIdentifierError);
        expect((error as AppError).statusCode).toBe(422);
      }
    }
  });

  it('secret columns are invisible even with the unmask permission (rule 1)', () => {
    expect(() => compile({ column: 'password_hash', op: 'eq', value: 'x' }, true)).toThrow(
      UnknownIdentifierError,
    );
  });

  it('masked columns are rejected in `where` without the unmask grant, allowed with it', () => {
    expect(() => compile({ column: 'phone', op: 'eq', value: '555' })).toThrow(
      'masked for your role',
    );
    const compiled = compile({ column: 'phone', op: 'eq', value: '555' }, true);
    expect(compiled.sql).toContain('"phone" = $1');
  });

  it('compiles the empty `in` set to a no-match predicate, still parameterized', () => {
    const compiled = compile({ column: 'customer_id', op: 'in', value: [] });
    expect(compiled.parameters).toEqual([1, 0]);
  });

  it('requires values where the op needs one and validates between pairs', () => {
    expect(() => compile({ column: 'balance', op: 'gt' })).toThrow('requires a value');
    expect(() => compile({ column: 'balance', op: 'between', value: [1] })).toThrow('[low, high]');
    expect(() => compile({ column: 'customer_id', op: 'in', value: 'A' })).toThrow('array');
  });

  it('enforces structural limits (≤ 16 conditions, ≤ 2 group levels)', () => {
    const seventeen: RecordFilter = {
      and: Array.from({ length: 16 }, () => ({ column: 'balance', op: 'gt' as const, value: 1 })),
    };
    expect(() => assertFilterLimits(seventeen)).not.toThrow();
    expect(() =>
      assertFilterLimits({ and: [seventeen, { column: 'balance', op: 'gt', value: 1 }] }),
    ).toThrow();
    const tooDeep: RecordFilter = { and: [{ or: [{ and: [{ column: 'balance', op: 'gt', value: 1 }] }] }] };
    expect(() => assertFilterLimits(tooDeep)).toThrow('nest');
  });

  it('parseWhereParam: malformed JSON and off-grammar shapes are 422', () => {
    expect(() => parseWhereParam('{nope')).toThrow('URL-encoded JSON');
    expect(() => parseWhereParam('{"column":"x"}')).toThrow('filter grammar');
    expect(recordFilterSchema.safeParse({ column: 'x', op: 'eq', value: 1 }).success).toBe(true);
    expect(recordFilterSchema.safeParse({ column: 'x', op: 'regex', value: 1 }).success).toBe(false);
  });
});

/*
 * The pre-parse envelope. `assertFilterLimits` walks a tree that already
 * exists, so before these two ran there was nothing between an authenticated
 * caller and zod's recursion: a rejecting `{"or":[…]}` chain is quadratic in
 * depth, and a ~7 KB one overflows the stack into a 500 — both inside Node's
 * default 16,384-byte request line.
 */
describe('where= envelope (pre-parse byte + depth caps)', () => {
  const chain = (depth: number, leaf = '{"column":"balance","op":"!"}'): string => {
    let out = leaf;
    for (let i = 0; i < depth; i += 1) out = `{"or":[${out}]}`;
    return out;
  };

  it('derives both caps from the grammar, not from round numbers', () => {
    // Two group levels, each an object around an array; then the condition
    // object; then the flat list `in`/`between` may carry.
    expect(MAX_WHERE_DEPTH).toBe(6);
    expect(MAX_WHERE_BYTES).toBe(10_205);
    // Whatever the arithmetic yields, it has to stay under the request line
    // Node will actually accept, or the cap is decorative.
    expect(MAX_WHERE_BYTES).toBeLessThan(16_384);
  });

  it('admits every filter the grammar itself accepts', () => {
    // The deepest legal shape: two groups, a condition, and a value list.
    const deepestLegal = '{"and":[{"or":[{"column":"balance","op":"between","value":[1,2]}]}]}';
    expect(() => assertWhereEnvelope(deepestLegal)).not.toThrow();
    expect(parseWhereParam(deepestLegal)).toEqual({
      and: [{ or: [{ column: 'balance', op: 'between', value: [1, 2] }] }],
    });
    // The widest legal value: a full `in` list of UUIDs, ~7.8 KB of it.
    const ids = Array.from({ length: 200 }, () => '"550e8400-e29b-41d4-a716-446655440000"');
    const widest = `{"column":"customer_id","op":"in","value":[${ids.join(',')}]}`;
    expect(widest.length).toBeGreaterThan(7_000);
    expect(() => parseWhereParam(widest)).not.toThrow();
  });

  it('refuses an over-long `where` as the same 422, before parsing it', () => {
    const oversize = `{"column":"balance","op":"eq","value":"${'x'.repeat(MAX_WHERE_BYTES)}"}`;
    expect(() => assertWhereEnvelope(oversize)).toThrow(AppError);
    expect(() => parseWhereParam(oversize)).toThrow(`limited to ${String(MAX_WHERE_BYTES)} bytes`);
    // Bytes, not UTF-16 units: a multi-byte body under the length cap is still
    // over the byte cap.
    const multibyte = `"${'é'.repeat(MAX_WHERE_BYTES - 100)}"`;
    expect(multibyte.length).toBeLessThan(MAX_WHERE_BYTES);
    expect(() => assertWhereEnvelope(multibyte)).toThrow('bytes');
  });

  it('refuses over-deep nesting before JSON.parse, and counts structure only', () => {
    expect(() => assertWhereEnvelope(chain(MAX_WHERE_DEPTH))).toThrow(
      `at most ${String(MAX_WHERE_DEPTH)} levels`,
    );
    expect(() => parseWhereParam(chain(1_200))).toThrow(AppError);
    // Brackets inside a string literal are text, not nesting — including one
    // hiding behind an escaped quote.
    expect(() =>
      assertWhereEnvelope('{"column":"balance","op":"eq","value":"[[[[[[[[[[{{{{"}'),
    ).not.toThrow();
    expect(() =>
      assertWhereEnvelope('{"column":"balance","op":"eq","value":"\\"[[[[[[[[[["}'),
    ).not.toThrow();
  });

  it('bounds the CPU a rejecting filter can charge the event loop', () => {
    /*
     * The real weapon here was never the stack overflow — it was the ~410 ms
     * of blocking work a 9 KB rejecting chain bought on a single-threaded
     * server for a 422. The caps have to make that unbuyable, so this asserts
     * on wall clock rather than on shape. The budget is deliberately ~40x the
     * ~2.4 ms the worst surviving shape measures, so it pins the two orders of
     * magnitude without being a CI flake.
     */
    const worst = `{"or":[${Array.from({ length: 250 }, () => '{"column":"balance","op":"!"}').join(',')}]}`;
    expect(worst.length).toBeLessThan(MAX_WHERE_BYTES);
    expect(() => parseWhereParam(worst)).toThrow(AppError);

    const started = performance.now();
    for (let i = 0; i < 10; i += 1) {
      expect(() => parseWhereParam(worst)).toThrow(AppError);
    }
    expect((performance.now() - started) / 10).toBeLessThan(100);

    // …and the payloads that used to cost hundreds of ms are now refused by a
    // scan that never reaches zod at all.
    const wasExpensive = chain(1_000);
    const refused = performance.now();
    for (let i = 0; i < 10; i += 1) {
      expect(() => parseWhereParam(wasExpensive)).toThrow(AppError);
    }
    expect((performance.now() - refused) / 10).toBeLessThan(5);
  });
});

describe('quick search (q=)', () => {
  it('ORs ILIKE over text-ish, non-masked columns and escapes wildcards', () => {
    const compiled = db
      .selectFrom('public.customers')
      .selectAll()
      .where((eb) => compileQuickSearch(eb as never, ctx(), 'a%b_c')!)
      .compile();
    // company_name + customer_id are text-ish; phone is masked; password_hash secret.
    expect(compiled.sql).toContain('"customer_id" ilike $1');
    expect(compiled.sql).toContain('"company_name" ilike $2');
    expect(compiled.sql).not.toContain('phone');
    expect(compiled.sql).not.toContain('password_hash');
    expect(compiled.parameters?.[0]).toBe('%a\\%b\\_c%');
    expect(escapeLike('100%_\\')).toBe('100\\%\\_\\\\');
  });

  it('includes masked columns for unmask holders', () => {
    const compiled = db
      .selectFrom('public.customers')
      .selectAll()
      .where((eb) => compileQuickSearch(eb as never, ctx(true), 'x')!)
      .compile();
    expect(compiled.sql).toContain('"phone" ilike');
  });

  it('compiles to LOWER(...) LIKE on mysql/sqlite (no ILIKE — the 500)', () => {
    // Regression: pre-fix this OR-ed `ILIKE`, which is a syntax error on both
    // mysql and sqlite (`near "ilike": syntax error`) → 500 INTERNAL.
    for (const dialect of ['mysql', 'sqlite'] as const) {
      const compiled = db
        .selectFrom('public.customers')
        .selectAll()
        .where((eb) => compileQuickSearch(eb as never, ctx(false, dialect), 'Cactus')!)
        .compile();
      expect(compiled.sql).toContain('lower("customer_id") like lower($1)');
      expect(compiled.sql).toContain('lower("company_name") like lower($2)');
      expect(compiled.sql).not.toContain('ilike');
      expect(compiled.parameters?.[0]).toBe('%Cactus%');
    }
  });
});

describe('sort key parsing', () => {
  it('appends the PK tiebreaker and caps at 3 keys', () => {
    expect(parseOrder(view, table, 'company_name.desc', false)).toEqual([
      { column: 'company_name', dir: 'desc' },
      { column: 'customer_id', dir: 'asc' },
    ]);
    expect(() => parseOrder(view, table, 'a.asc,b.asc,c.asc,d.asc', false)).toThrow();
    expect(() => parseOrder(view, table, 'company_name.sideways', false)).toThrow('col.asc');
    expect(() => parseOrder(view, table, 'phone.asc', false)).toThrow('masked');
  });
});

describe('undo store', () => {
  const entry = {
    auditId: null,
    userId: 'usr_1',
    connectionId: 'conn_1',
    tableId: 'public.customers',
    action: 'delete' as const,
    pkColumns: ['customer_id'],
    before: [{ customer_id: 'A', company_name: 'Acme' }],
    after: [],
    changedColumns: [],
  };

  it('issues single-use tokens that expire after the TTL', () => {
    let now = 1_000_000;
    const store = new UndoStore(() => now);
    const { token } = store.issue(entry);
    expect(token).toMatch(/^undo_[0-9a-f]{32}$/);

    now += 60_001;
    expect(store.consume(token)).toEqual({ status: 'expired' });
    expect(store.consume(token)).toEqual({ status: 'unknown' }); // single-use

    const second = store.issue(entry);
    const consumed = store.consume(second.token);
    expect(consumed.status).toBe('ok');
    expect(store.consume(second.token)).toEqual({ status: 'unknown' });
    expect(store.consume('undo_ffffffffffffffffffffffffffffffff')).toEqual({ status: 'unknown' });
  });

  it('rowsEqual normalizes dates and bigints', () => {
    const a = { at: new Date('2026-01-01T00:00:00Z'), n: 1n };
    const b = { at: '2026-01-01T00:00:00.000Z', n: '1' };
    expect(rowsEqual(a, b, ['at', 'n'])).toBe(true);
    expect(rowsEqual(a, { ...b, n: '2' }, ['at', 'n'])).toBe(false);
  });
});
