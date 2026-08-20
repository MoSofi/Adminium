// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `runList`'s public-surface options: the mandatory predicate (28-T04) and the
 * column-reach fixes (28-T05 / 28 D5).
 *
 * These assert on the COMPILED SQL rather than on returned rows, because the
 * property under test is "no combination of query parameters can remove this
 * clause" — and a row assertion against a fixture proves only that the fixture
 * did not happen to contain a counter-example. A `DummyDriver` Kysely compiles
 * without a database and a `log` hook hands back the exact SQL and parameters.
 *
 * The dashboard passes none of these options; `crud.test.ts` and the 1,500-test
 * server suite are the regression proof that its behaviour is untouched.
 */

import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely';
import { beforeEach, describe, expect, it } from 'vitest';

import type { EffectiveModel } from '../src/connections/effective-schema.js';
import type { SourceDatabase } from '../src/connections/manager.js';
import { SnapshotView } from '../src/crud/identifiers.js';
import { runList } from '../src/crud/list.js';
import { ValidationFailedError } from '../src/errors.js';

function col(name: string, logicalType = 'varchar', isPrimaryKey = false) {
  return { name, logicalType, nullable: false, isPrimaryKey, semantics: null };
}

const model = {
  dialect: 'postgres',
  name: 'unit',
  defaultSchema: 'public',
  schemas: ['public'],
  enums: [],
  relations: [],
  tables: [
    {
      id: 'public.menu_items',
      schema: 'public',
      name: 'menu_items',
      kind: 'table',
      primaryKey: ['id'],
      columns: [
        col('id', 'int4', true),
        col('name'),
        col('price', 'numeric'),
        col('available', 'bool'),
        // The column an anonymous caller must never reach, by any route.
        col('cost_price', 'numeric'),
        col('internal_note'),
      ],
    },
  ],
} as unknown as EffectiveModel;

const view = new SnapshotView('conn_1', model);
const table = view.table('public.menu_items');

let sql: string[] = [];
let params: readonly unknown[][] = [];

const db = new Kysely<SourceDatabase>({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (kysely) => new PostgresIntrospector(kysely),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  },
  log: (event) => {
    sql.push(event.query.sql);
    params = [...params, event.query.parameters];
  },
});

beforeEach(() => {
  sql = [];
  params = [];
});

const AVAILABLE_ONLY = { column: 'available', op: 'eq' as const, value: true };

describe('mandatory predicate (28-T04)', () => {
  it('is applied when the caller sends nothing at all', async () => {
    await runList({
      db,
      view,
      table,
      params: {},
      canReadPii: true,
      dialect: 'postgres',
      mandatory: AVAILABLE_ONLY,
    });
    expect(sql[0]).toContain('"available"');
    expect(params[0]).toContain(true);
  });

  it('survives every shape of caller-supplied where', async () => {
    // Each of these is an attempt to replace rather than narrow: an OR that
    // would widen, a contradictory equality, and an is_null on the same column.
    const attempts = [
      JSON.stringify({ or: [{ column: 'available', op: 'eq', value: false }] }),
      JSON.stringify({ column: 'available', op: 'eq', value: false }),
      JSON.stringify({ column: 'available', op: 'is_null' }),
      JSON.stringify({ and: [{ column: 'name', op: 'like', value: '%a%' }] }),
    ];
    for (const where of attempts) {
      sql = [];
      await runList({
        db,
        view,
        table,
        params: { where },
        canReadPii: true,
        dialect: 'postgres',
        mandatory: AVAILABLE_ONLY,
      });
      /*
       * Assert on BINDING ORDER, not on punctuation. Two separate `where()`
       * calls compile to `where <mandatory> and <caller>`, so the mandatory
       * value is always parameter $1 — true whether or not Kysely wraps the
       * caller's clause in parentheses, which it does for `or` and does not for
       * a bare equality. An earlier version of this test asserted the paren
       * shape and failed on a query that was entirely correct.
       */
      expect(params[0]?.[0]).toBe(true);
      const where0 = sql[0]?.slice(sql[0].indexOf('where')) ?? '';
      expect(where0).toContain('and');
    }
  });

  it('is applied to the COUNT query too, not only the page query', async () => {
    // A total computed without the predicate leaks the unfiltered row count.
    await runList({
      db,
      view,
      table,
      params: { count: 'exact' },
      canReadPii: true,
      dialect: 'postgres',
      mandatory: AVAILABLE_ONLY,
    });
    // With a mandatory predicate the count is refused outright (see below), so
    // there is exactly one statement and it is the page query.
    expect(sql).toHaveLength(1);
  });
});

describe('count is never exact under a mandatory predicate (28 D5 d)', () => {
  it('returns a null total instead of running COUNT(*)', async () => {
    const res = await runList({
      db,
      view,
      table,
      params: { count: 'exact' },
      canReadPii: true,
      dialect: 'postgres',
      mandatory: AVAILABLE_ONLY,
    });
    expect(res.page?.total).toBeNull();
    expect(sql.join(' ')).not.toContain('count(');
  });

  it('estimated does not become exact by way of the filtered fall-through', async () => {
    // `estimated` consults catalog statistics only for an UNFILTERED list and
    // otherwise falls through to an exact COUNT(*). A mandatory predicate makes
    // every public list filtered, so without the guard this would be the
    // amplification primitive on every single request.
    const res = await runList({
      db,
      view,
      table,
      params: { count: 'estimated' },
      canReadPii: true,
      dialect: 'postgres',
      mandatory: AVAILABLE_ONLY,
    });
    expect(res.page?.total).toBeNull();
    expect(sql.join(' ')).not.toContain('count(');
  });

  it('leaves the dashboard path alone — no mandatory means a real count', async () => {
    await runList({ db, view, table, params: { count: 'exact' }, canReadPii: true, dialect: 'postgres' });
    expect(sql.join(' ')).toContain('count(');
  });
});

describe('exposeColumns replaces the select list (28 D5 a)', () => {
  it('returns exactly the exposed set when the caller omits select', async () => {
    // The trap: a validator on `params.select` is bypassed by not sending one,
    // because the default is every non-secret column.
    await runList({
      db,
      view,
      table,
      params: {},
      canReadPii: true,
      dialect: 'postgres',
      exposeColumns: ['name', 'price'],
    });
    expect(sql[0]).toContain('"name"');
    expect(sql[0]).toContain('"price"');
    expect(sql[0]).not.toContain('cost_price');
    expect(sql[0]).not.toContain('internal_note');
  });

  it('ignores a caller-supplied select rather than merging it', async () => {
    await runList({
      db,
      view,
      table,
      params: { select: 'cost_price,internal_note' },
      canReadPii: true,
      dialect: 'postgres',
      exposeColumns: ['name'],
    });
    expect(sql[0]).toContain('"name"');
    expect(sql[0]).not.toContain('cost_price');
    expect(sql[0]).not.toContain('internal_note');
  });

  it('does NOT ride the primary key along when it is not exposed (D5 a′)', async () => {
    // `select=name` on the ordinary path returns `{name, id}` — the PK is
    // appended unconditionally for cursors and refs. Right for the dashboard;
    // an enumeration aid over a sequential integer PK on a public surface.
    await runList({
      db,
      view,
      table,
      params: {},
      canReadPii: true,
      dialect: 'postgres',
      exposeColumns: ['name'],
    });
    const select = sql[0]?.slice(0, sql[0].indexOf('from')) ?? '';
    expect(select).toContain('"name"');
    expect(select).not.toContain('"id"');
  });

  it('still rides the PK along on the ordinary path — unchanged behaviour', async () => {
    await runList({ db, view, table, params: { select: 'name' }, canReadPii: true, dialect: 'postgres' });
    const select = sql[0]?.slice(0, sql[0].indexOf('from')) ?? '';
    expect(select).toContain('"id"');
  });

  it('refuses keyset pagination when the sort key is not exposed', async () => {
    // Otherwise the unexposed PK is readable straight out of the cursor.
    await expect(
      runList({
        db,
        view,
        table,
        params: { cursor: '' },
        canReadPii: true,
        dialect: 'postgres',
        exposeColumns: ['name'],
      }),
    ).rejects.toBeInstanceOf(ValidationFailedError);
  });

  it('allows keyset pagination when the PK IS exposed', async () => {
    const res = await runList({
      db,
      view,
      table,
      params: { cursor: '' },
      canReadPii: true,
      dialect: 'postgres',
      exposeColumns: ['id', 'name'],
    });
    expect(res.cursor).toBeDefined();
  });
});

describe('searchColumns bounds quick search (28 D5 b)', () => {
  it('searches only the allowed column, not every text-ish column', async () => {
    await runList({
      db,
      view,
      table,
      params: { q: 'secret' },
      canReadPii: true,
      dialect: 'postgres',
      exposeColumns: ['name'],
      searchColumns: ['name'],
    });
    expect(sql[0]).toContain('"name"');
    // Row presence would otherwise answer "does any hidden column contain
    // this?" one character at a time.
    expect(sql[0]).not.toContain('internal_note');
    expect(sql[0]).not.toContain('cost_price');
  });

  it('matches NOTHING when the allow-list is empty — a refusal, not a full listing', async () => {
    await runList({
      db,
      view,
      table,
      params: { q: 'anything' },
      canReadPii: true,
      dialect: 'postgres',
      exposeColumns: ['name'],
      searchColumns: [],
    });
    // The dashboard's `1=1` fallback is right when a table simply has no text
    // columns; here it would turn "q is not permitted" into "return everything".
    expect(params[0]).toContain(0);
  });

  it('leaves the dashboard path searching every text-ish column', async () => {
    await runList({ db, view, table, params: { q: 'x' }, canReadPii: true, dialect: 'postgres' });
    expect(sql[0]).toContain('internal_note');
  });
});
