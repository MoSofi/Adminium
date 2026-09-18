// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The write service: the order a write runs in, what hooks may change, and
 * that a server with no hooks sends exactly the statements it always sent.
 */
import BetterSqlite3 from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SourceDatabase } from '../src/connections/manager.js';
import type { ResolvedColumn, ResolvedTable, SnapshotView } from '../src/crud/identifiers.js';
import type { Row } from '../src/crud/mask.js';
import {
  HookFailedError,
  HookRejectedError,
  NO_RECORD_HOOKS,
  bindValue,
  createWriteService,
  insertRows,
  requestWriteContext,
  uncheckedForUndo,
  unknownColumn,
  type AfterWriteEvent,
  type BeforeWriteEvent,
  type RecordHooks,
  type WriteContext,
  type WriteTarget,
} from '../src/crud/write-service.js';
import { createSqlSink, recordingDialect, type SqlSink } from './sql-recorder.js';

function column(name: string, logicalType: ResolvedColumn['logicalType'], extra: Partial<ResolvedColumn> = {}): ResolvedColumn {
  return { name, logicalType, nullable: true, isPrimaryKey: false, masked: false, secret: false, textish: false, ...extra };
}

const table: ResolvedTable = {
  id: 'main.orders',
  schema: 'main',
  name: 'orders',
  primaryKey: ['id'],
  columns: new Map(
    [
      column('id', 'integer', { isPrimaryKey: true, nullable: false }),
      column('qty', 'integer'),
      column('price', 'integer'),
      column('total', 'integer'),
      column('status', 'text'),
      column('shipped', 'boolean'),
      column('password_hash', 'text', { secret: true }),
    ].map((c) => [c.name, c]),
  ),
  readOnly: false,
  table: {} as ResolvedTable['table'],
};

const view = { table: () => table } as unknown as SnapshotView;

const context: WriteContext = {
  origin: 'dashboard',
  hops: 0,
  actor: { kind: 'user', id: 'usr_1', label: 'Ada' },
  request: null,
};

/** Hooks that record what they saw and run the given functions. */
function fakeHooks(opts: {
  before?: (event: BeforeWriteEvent) => void | Promise<void>;
  after?: (event: AfterWriteEvent) => void | Promise<void>;
  wants?: (timing: 'before' | 'after') => boolean;
}): RecordHooks & { seen: string[] } {
  const seen: string[] = [];
  return {
    seen,
    wants: (timing) => Promise.resolve(opts.wants?.(timing) ?? true),
    before: async (event) => {
      seen.push(`before:${event.action}`);
      await opts.before?.(event);
    },
    after: async (event) => {
      seen.push(`after:${event.action}`);
      await opts.after?.(event);
    },
  };
}

let raw: BetterSqlite3.Database;
let db: Kysely<SourceDatabase>;
let sink: SqlSink;
let target: WriteTarget;

beforeEach(() => {
  raw = new BetterSqlite3(':memory:');
  raw.exec(
    'CREATE TABLE orders (id INTEGER PRIMARY KEY, qty INTEGER, price INTEGER, total INTEGER, status TEXT UNIQUE, shipped INTEGER, password_hash TEXT)',
  );
  raw.exec("INSERT INTO orders (id, qty, price, total, status) VALUES (1, 2, 5, 10, 'open')");
  sink = createSqlSink();
  db = new Kysely<SourceDatabase>({ dialect: recordingDialect(new SqliteDialect({ database: raw }), sink) });
  target = { connectionId: 'conn_1', view, table, db, dialect: 'sqlite' };
});

afterEach(async () => {
  await db.destroy();
});

const rows = (): Row[] => raw.prepare('SELECT id, qty, price, total, status, shipped FROM orders ORDER BY id').all() as Row[];

describe('with no hooks', () => {
  it('sends the same statements as before, and nothing more', async () => {
    const writes = createWriteService();
    expect(writes.hooks).toBe(NO_RECORD_HOOKS);

    const created = await writes.create({ target, values: { id: 2, qty: 1 }, context, announce: async () => {} });
    expect(created).toMatchObject({ id: 2, qty: 1 });
    expect(sink.queries).toEqual(['insert into "main"."orders" ("id", "qty") values (?, ?) returning *']);

    sink.queries.length = 0;
    const before = rows()[0] as Row;
    const outcome = await writes.update({ target, pk: { id: 1 }, values: { qty: 3 }, before, context, announce: async () => {} });
    expect(outcome).toMatchObject({ count: 1, after: { qty: 3 }, before });
    expect(sink.queries).toEqual([
      'update "main"."orders" set "qty" = ? where "id" = ?',
      'select * from "main"."orders" where "id" = ?',
    ]);

    sink.queries.length = 0;
    await writes.delete({ target, pk: { id: 2 }, before: created, context, announce: async () => {} });
    expect(sink.queries).toEqual(['delete from "main"."orders" where "id" = ?']);

    sink.queries.length = 0;
    const prepared = await writes.beforeEach('update', target, context, [{ match: { id: 1 }, values: { qty: 4 } }]);
    expect(prepared).toEqual([{ values: { qty: 4 }, record: undefined, issues: null }]);
    await writes.afterEach('update', target, context, [{ record: before, before }]);
    expect(sink.queries).toEqual([]);
  });

  it('turns a failed statement into the caller’s error, and leaves other errors alone', async () => {
    const writes = createWriteService();
    const mapError = (): never => {
      throw new Error('mapped');
    };
    await expect(
      writes.create({ target, values: { id: 3, status: 'open' }, context, mapError, announce: async () => {} }),
    ).rejects.toThrow('mapped');
    await expect(
      writes.create({
        target,
        values: { id: 3, status: 'new' },
        context,
        mapError,
        announce: () => Promise.reject(new Error('announce failed')),
      }),
    ).rejects.toThrow('announce failed');
  });
});

describe('with hooks', () => {
  it('runs before hooks, the statement, the announcement and after hooks, in that order', async () => {
    const order: string[] = [];
    const hooks = fakeHooks({
      before: (event) => {
        order.push('before');
        event.values.total = (event.values.qty as number) * (event.values.price as number);
      },
      after: (event) => {
        order.push(`after:${String(event.record.total)}`);
      },
    });
    const writes = createWriteService({ hooks: () => hooks });
    const recheck = vi.fn(() => Promise.resolve());
    const row = await writes.create({
      target,
      values: { id: 2, qty: 3, price: 4 },
      context,
      recheck,
      announce: async (stored, values) => {
        order.push(`announce:${String(stored.total)}:${Object.keys(values).join(',')}`);
      },
    });
    expect(row.total).toBe(12);
    expect(order).toEqual(['before', 'announce:12:id,qty,price,total', 'after:12']);
    expect(recheck).toHaveBeenCalledWith({ id: 2, qty: 3, price: 4, total: 12 });
  });

  it('writes nothing when a before hook rejects', async () => {
    const hooks = fakeHooks({
      before: () => {
        throw new HookRejectedError('Shipped orders cannot be deleted.', 'hooks/orders.ts');
      },
    });
    const writes = createWriteService({ hooks: () => hooks });
    const announce = vi.fn(() => Promise.resolve());
    const error = await writes
      .delete({ target, pk: { id: 1 }, before: rows()[0] as Row, context, announce })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HookRejectedError);
    expect(error).toMatchObject({ statusCode: 422, code: 'VALIDATION_FAILED', message: 'Shipped orders cannot be deleted.' });
    expect(announce).not.toHaveBeenCalled();
    expect(hooks.seen).toEqual(['before:delete']);
    expect(rows()).toHaveLength(1);
  });

  it('refuses a value for a column the table does not have', async () => {
    const hooks = fakeHooks({
      before: (event) => {
        event.values.totl = 1;
      },
    });
    const writes = createWriteService({ hooks: () => hooks });
    await expect(
      writes.create({ target, values: { id: 2 }, context, announce: async () => {} }),
    ).rejects.toBeInstanceOf(HookFailedError);
    expect(rows()).toHaveLength(1);
    expect(unknownColumn(table, { qty: 1, password_hash: 'x' })).toBeNull();
  });

  it('lets a hook fill a secret column and spells its values for the database', async () => {
    const hooks = fakeHooks({
      before: (event) => {
        event.values.password_hash = 'hashed';
        event.values.shipped = true;
      },
    });
    const writes = createWriteService({ hooks: () => hooks });
    await writes.create({ target, values: { id: 2 }, context, announce: async () => {} });
    expect(raw.prepare('SELECT password_hash, shipped FROM orders WHERE id = 2').get()).toEqual({
      password_hash: 'hashed',
      shipped: 1,
    });
    expect(bindValue('postgres', true)).toBe(true);
  });

  it('reads the row for an update hook only through the caller’s own read', async () => {
    const seen: (Row | null)[] = [];
    const hooks = fakeHooks({
      before: (event) => {
        seen.push(event.record);
      },
    });
    const writes = createWriteService({ hooks: () => hooks });
    const load = vi.fn(() => Promise.resolve(null));
    const announce = vi.fn(() => Promise.resolve());
    // The scoped read found nothing: no hook runs, and the caller's UPDATE decides.
    const outcome = await writes.update({
      target,
      pk: { id: 1 },
      values: { qty: 9 },
      context,
      load,
      refine: (query) => query.where('status', '=', 'closed' as never),
      skipIfNone: true,
      announce,
    });
    expect(load).toHaveBeenCalledOnce();
    expect(seen).toEqual([]);
    expect(outcome.count).toBe(0);
    expect(announce).not.toHaveBeenCalled();
    expect(hooks.seen).toEqual([]);

    // Without a scoped read, the row is read by its key.
    await writes.update({ target, pk: { id: 1 }, values: { qty: 9 }, context, announce });
    expect(seen).toEqual([expect.objectContaining({ id: 1, qty: 2 })]);
    expect(hooks.seen).toEqual(['before:update', 'after:update']);
  });

  it('passes an update’s after hook the row before and after', async () => {
    const events: AfterWriteEvent[] = [];
    const hooks = fakeHooks({ after: (event) => void events.push(event) });
    const writes = createWriteService({ hooks: () => hooks });
    const before = rows()[0] as Row;
    await writes.update({ target, pk: { id: 1 }, values: { status: 'paid' }, before, context, announce: async () => {} });
    expect(events).toHaveLength(1);
    expect(events[0]?.before).toBe(before);
    expect(events[0]?.record).toMatchObject({ id: 1, status: 'paid' });
  });

  it('asks before reading or copying anything', async () => {
    const hooks = fakeHooks({ wants: () => false });
    const writes = createWriteService({ hooks: () => hooks });
    await writes.update({ target, pk: { id: 1 }, values: { qty: 5 }, context, announce: async () => {} });
    expect(hooks.seen).toEqual([]);
    expect(sink.queries.filter((sql) => sql.startsWith('select'))).toHaveLength(1);
  });

  it('prepares several rows before any is written, and follows them after', async () => {
    raw.exec("INSERT INTO orders (id, qty, status) VALUES (2, 1, 'shipped')");
    const hooks = fakeHooks({
      before: (event) => {
        if (event.action === 'update') event.values.total = (event.record?.qty as number) * 100;
      },
    });
    const writes = createWriteService({ hooks: () => hooks });
    const prepared = await writes.beforeEach('update', target, context, [
      { match: { id: 1 }, values: { status: 'x' } },
      { match: { id: 99 }, values: { status: 'y' } },
      { match: { id: 2 }, values: { status: 'z' } },
    ]);
    expect(prepared).toEqual([
      { values: { status: 'x', total: 200 }, record: expect.objectContaining({ id: 1 }), issues: null },
      { values: { status: 'y' }, record: null, issues: null },
      { values: { status: 'z', total: 100 }, record: expect.objectContaining({ id: 2 }), issues: null },
    ]);
    expect(sink.queries.every((sql) => sql.startsWith('select'))).toBe(true);

    const deletes = await writes.beforeEach('delete', target, context, [{ match: { id: 2 }, values: {} }]);
    expect(deletes).toEqual([
      { values: {}, record: expect.objectContaining({ status: 'shipped' }), issues: null },
    ]);

    await writes.afterEach('delete', target, context, [
      { record: { id: 1 }, before: null },
      { record: { id: 2 }, before: null },
    ]);
    expect(hooks.seen.slice(-2)).toEqual(['after:delete', 'after:delete']);
  });

  it('stops a multi-row write at the first rejection', async () => {
    let calls = 0;
    const hooks = fakeHooks({
      before: () => {
        calls += 1;
        throw new HookRejectedError('No.', 'hooks/orders.ts');
      },
    });
    const writes = createWriteService({ hooks: () => hooks });
    await expect(
      writes.beforeEach('create', target, context, [{ values: { id: 5 } }, { values: { id: 6 } }]),
    ).rejects.toThrow('No.');
    expect(calls).toBe(1);
  });

  it('reads the hooks in force at each write', async () => {
    let current: RecordHooks = NO_RECORD_HOOKS;
    const writes = createWriteService({ hooks: () => current });
    const hooks = fakeHooks({});
    current = hooks;
    await writes.create({ target, values: { id: 7 }, context, announce: async () => {} });
    expect(hooks.seen).toEqual(['before:create', 'after:create']);
  });
});

describe('requestWriteContext', () => {
  it('attributes a write to the signed-in user or the API key', () => {
    const user = { user: { id: 'usr_1', name: 'Ada', email: 'ada@example.com' }, apiKeyPrincipal: null };
    expect(requestWriteContext(user as never, 'dashboard')).toMatchObject({
      origin: 'dashboard',
      hops: 0,
      actor: { kind: 'user', id: 'usr_1', label: 'Ada' },
    });
    const key = { user: null, apiKeyPrincipal: { kind: 'api-key', id: 'key_1', label: 'CI', roleId: 'rol_1' } };
    expect(requestWriteContext(key as never, 'bulk').actor).toEqual({ kind: 'api-key', id: 'key_1', label: 'CI' });
    expect(requestWriteContext({ user: null, apiKeyPrincipal: null } as never, 'undo').actor).toBeNull();
  });
});

/* --------------------------------------------------- the rules, and the brand */

/**
 * The same `orders` table, with an `EffectiveTable` behind it so the rule
 * engine has facts to read: a NOT NULL `created_at` with no database default
 * and a NOT NULL `updated_at`, which is the shape the column rules exist for.
 */
function ruledTarget(base: WriteTarget): WriteTarget {
  const effective = {
    id: 'main.orders',
    schema: 'main',
    name: 'orders',
    primaryKey: ['id'],
    checks: [],
    columns: [
      { name: 'id', logicalType: 'integer', nullable: false, isPrimaryKey: true, isGenerated: false, default: { kind: 'autoincrement' }, enumRef: null, semantics: null },
      { name: 'qty', logicalType: 'integer', nullable: true, isPrimaryKey: false, isGenerated: false, default: null, enumRef: null, semantics: null },
      { name: 'created_at', logicalType: 'timestamptz', nullable: false, isPrimaryKey: false, isGenerated: false, default: null, enumRef: null, semantics: { primary: 'created-at', flags: { secret: false, pii: null, maskedByDefault: false }, format: null, pair: null, confidence: 1, source: 'heuristic' } },
      { name: 'updated_at', logicalType: 'timestamptz', nullable: false, isPrimaryKey: false, isGenerated: false, default: null, enumRef: null, semantics: { primary: 'updated-at', flags: { secret: false, pii: null, maskedByDefault: false }, format: null, pair: null, confidence: 1, source: 'heuristic' } },
    ],
  };
  const columns = new Map(table.columns);
  for (const name of ['created_at', 'updated_at']) {
    columns.set(name, column(name, 'timestamptz'));
  }
  return { ...base, table: { ...table, columns, table: effective as never } };
}

/** `orders` with a `mood` column whose values the database itself fixes. */
function moodTarget(base: WriteTarget): WriteTarget {
  const effective = {
    id: 'main.orders',
    checks: [],
    columns: [
      {
        name: 'mood',
        logicalType: 'enum',
        nullable: true,
        isPrimaryKey: false,
        isGenerated: false,
        default: null,
        enumRef: 'main.mood',
        semantics: null,
      },
    ],
  };
  const columns = new Map(table.columns);
  columns.set('mood', column('mood', 'text'));
  return {
    ...base,
    view: { model: { enums: [{ id: 'main.mood', name: 'mood', values: ['calm'], source: 'native' }] } } as never,
    table: { ...table, columns, table: effective as never },
  };
}

describe('the column rules inside the write path', () => {
  it('fills an absent created_at, and lets a supplied value win', async () => {
    raw.exec('DROP TABLE orders');
    raw.exec('CREATE TABLE orders (id INTEGER PRIMARY KEY, qty INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)');
    const writes = createWriteService();
    const ruled = ruledTarget(target);
    const created = await writes.create({ target: ruled, values: { id: 2, qty: 1 }, context, announce: async () => {} });
    expect(typeof created['created_at']).toBe('string');
    expect(created['created_at']).toBe(created['updated_at']);

    const supplied = await writes.create({
      target: ruled,
      values: { id: 3, qty: 1, created_at: '1999-01-01T00:00:00.000Z' },
      context,
      announce: async () => {},
    });
    expect(supplied['created_at']).toBe('1999-01-01T00:00:00.000Z');
  });

  it('puts the filled column in the outcome the undo entry is built from', async () => {
    raw.exec('DROP TABLE orders');
    raw.exec('CREATE TABLE orders (id INTEGER PRIMARY KEY, qty INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)');
    const writes = createWriteService();
    const ruled = ruledTarget(target);
    await writes.create({ target: ruled, values: { id: 2, qty: 1 }, context, announce: async () => {} });
    const outcome = await writes.update({
      target: ruled,
      pk: { id: 2 },
      values: { qty: 5 },
      context,
      announce: async () => {},
    });
    // `routes/data` hands `Object.keys(outcome.values)` to the undo entry as
    // its changed columns. Without `updated_at` here, an undo would restore
    // the row with the timestamp of the edit it just took back.
    expect(Object.keys(outcome.values).sort()).toEqual(['qty', 'updated_at']);
    // `created_at` is not an onUpdate fill, ever.
    expect(outcome.values).not.toHaveProperty('created_at');
  });

  it('runs the fill BEFORE the hooks and the check AFTER them', async () => {
    raw.exec('DROP TABLE orders');
    raw.exec('CREATE TABLE orders (id INTEGER PRIMARY KEY, qty INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)');
    let seenByHook: Row | null = null;
    const hooks = fakeHooks({
      before: (event) => {
        seenByHook = { ...event.values };
        event.values['qty'] = 9;
      },
    });
    const writes = createWriteService({ hooks: () => hooks });
    const stored = await writes.create({
      target: ruledTarget(target),
      values: { id: 2, qty: 1 },
      context,
      announce: async () => {},
    });
    expect(seenByHook).not.toBeNull();
    expect(Object.keys(seenByHook ?? {})).toContain('created_at');
    expect(stored['qty']).toBe(9);
  });

  it('brands the very same object when the table has no rules', () => {
    const writes = createWriteService();
    const values: Row = { qty: 1 };
    const { rows: checked, issues } = writes.check('create', target, context, [values]);
    expect(checked[0]).toBe(values);
    expect(issues[0]).toBeNull();
  });

  it('reports a refused row rather than throwing, so a bulk caller decides', () => {
    const writes = createWriteService();
    const { rows: checked, issues } = writes.check('create', moodTarget(target), context, [
      { mood: 'wibble' },
      { mood: 'calm' },
    ]);
    expect(checked[0]).toBeNull();
    expect(issues[0]).toEqual({ mood: { code: 'not-allowed' } });
    expect(checked[1]).not.toBeNull();
    expect(issues[1]).toBeNull();
  });

  it('throws a refusal through the caller’s own mapError', async () => {
    raw.exec('DROP TABLE orders');
    raw.exec('CREATE TABLE orders (id INTEGER PRIMARY KEY, mood TEXT)');
    const enumTarget = moodTarget(target);
    const writes = createWriteService();
    // The public surface collapses every refusal into one opaque answer; it
    // does that in `mapError`, so a refusal that skipped `mapError` would name
    // columns and legal values to an anonymous caller.
    let collapsed = false;
    const mapError = (): never => {
      collapsed = true;
      throw new Error('refused');
    };
    await expect(
      writes.create({ target: enumTarget, values: { mood: 'wibble' }, context, mapError, announce: async () => {} }),
    ).rejects.toThrow('refused');
    expect(collapsed).toBe(true);

    // With no mapError the caller gets the named fields the dashboard renders.
    await expect(
      writes.create({ target: enumTarget, values: { mood: 'wibble' }, context, announce: async () => {} }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: { fields: { mood: { code: 'not-allowed' } } } });
  });

  it('does not let an unchecked row reach a statement', async () => {
    /*
     * The whole point of the brand, and the assertion IS the `@ts-expect-error`
     * below: `tsc` fails this file if that line ever stops being an error.
     * `values` is an ordinary Row — the kind the CSV import's fast path used
     * to hand straight to `insertRows` with no rule in sight.
     */
    const values: Row = { id: 99, qty: 1 };
    // @ts-expect-error a Row is not a CheckedRow: only check() and uncheckedForUndo() make one
    await insertRows(db, table, [values]);
    // The one named escape compiles, and says why in its name.
    await expect(insertRows(db, table, uncheckedForUndo([{ id: 98, qty: 1 }]))).resolves.toBeUndefined();
  });
});
