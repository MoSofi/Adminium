// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `db` helper project code gets: reads, writes through the write service
 * with an audit row naming who is behind them, and the refusals.
 */
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { auditRepo } from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ResolvedTable } from '../src/crud/identifiers.js';
import { createWriteService, type RecordHooks, type WriteContext } from '../src/crud/write-service.js';
import { createProjectDb, recordKey, MAX_LIST_LIMIT } from '../src/project/code/db.js';
import type { ProjectDb } from '../src/project/code/define.js';
import { makeInstall, type Install } from './project-fixtures.js';

let install: Install;
beforeEach(async () => {
  install = await makeInstall();
});
afterEach(async () => {
  await install.close();
});

const context = (overrides: Partial<WriteContext> = {}): WriteContext => ({
  origin: 'hook',
  hops: 1,
  actor: { kind: 'user', id: 'usr_1', label: 'Ada' },
  request: null,
  ...overrides,
});

async function helper(opts: { context?: WriteContext; hooks?: RecordHooks } = {}): Promise<ProjectDb> {
  const { db, dialect } = await install.manager.data(install.mainId);
  // afterRecordWrite needs only these when no request is in hand.
  const app = { hasDecorator: () => false, rbac: { meta: install.meta } } as unknown as FastifyInstance;
  const writes = createWriteService(opts.hooks === undefined ? {} : { hooks: () => opts.hooks as RecordHooks });
  return createProjectDb(
    { app, meta: install.meta, manager: install.manager, writes: () => writes },
    { database: 'main', raw: db, dialect, context: opts.context ?? context() },
  );
}

function shop(sql: string, ...params: unknown[]): unknown {
  const db = new BetterSqlite3(join(install.dir, 'shop.db'), { readonly: true });
  try {
    return db.prepare(sql).get(...params);
  } finally {
    db.close();
  }
}

describe('reading', () => {
  it('gets a record by its key, or null', async () => {
    const orders = (await helper()).table<{ id: number; status: string }>('orders');
    expect(await orders.get(1)).toMatchObject({ id: 1, status: 'paid' });
    expect(await orders.get('2')).toMatchObject({ id: 2, status: 'shipped' });
    expect(await orders.get({ id: 3 })).toMatchObject({ status: 'refunded' });
    expect(await orders.get(999)).toBeNull();
  });

  it('lists with equality filters, a sort and a page', async () => {
    const db = await helper();
    const orders = db.table('main.orders');
    const paid = await orders.list({ where: { status: 'paid' }, orderBy: '-id', limit: 3 });
    expect(paid.map((row) => row.id)).toEqual([37, 33, 29]);
    expect((await orders.list({ where: { status: 'paid' }, orderBy: 'id', limit: 2, offset: 1 })).map((row) => row.id)).toEqual([5, 9]);
    expect(await orders.list()).toHaveLength(40);
    expect(await orders.list({ limit: 0 })).toHaveLength(1);
    expect(MAX_LIST_LIMIT).toBe(1000);
    expect(await db.table('tasks').list({ where: { customer_id: null } })).toEqual([]);
    await expect(orders.list({ where: { stauts: 'paid' } })).rejects.toThrow('main.orders has no column "stauts".');
    await expect(orders.list({ orderBy: '-nope' })).rejects.toThrow('has no column "nope"');
  });
});

describe('writing', () => {
  it('inserts, updates and deletes, with an audit row for each', async () => {
    const tasks = (await helper()).table('tasks');
    const created = await tasks.insert({
      title: 'Call back',
      status: 'todo',
      priority: 'high',
      created_at: '2026-01-01 00:00:00',
      updated_at: '2026-01-01 00:00:00',
      ignored: undefined,
    });
    expect(created).toMatchObject({ id: 41, title: 'Call back' });
    expect(await tasks.update(41, { status: 'done' })).toMatchObject({ id: 41, status: 'done' });
    expect(await tasks.update(999, { status: 'done' })).toBeNull();
    expect(await tasks.delete(41)).toBe(true);
    expect(await tasks.delete(41)).toBe(false);
    expect(shop('SELECT count(*) AS n FROM tasks WHERE id = 41')).toEqual({ n: 0 });

    const audit = (await auditRepo(install.meta).list({ limit: 10 })).reverse();
    expect(audit.map((entry) => entry.action)).toEqual(['record.create', 'record.update', 'record.delete']);
    expect(audit[0]).toMatchObject({ actorKind: 'user', actorId: 'usr_1', actorLabel: 'Ada', entity: { table: 'main.tasks' } });
  });

  it('names a write nobody signed in for after the project', async () => {
    const tasks = (await helper({ context: context({ actor: null }) })).table('tasks');
    await tasks.update(1, { title: 'Renamed' });
    const [entry] = await auditRepo(install.meta).list({ limit: 1 });
    expect(entry).toMatchObject({ actorKind: 'system', actorId: null, actorLabel: 'Project code' });
    const publicWrite = (await helper({ context: context({ actor: { kind: 'public', id: null, label: 'public:key_1' } }) })).table('tasks');
    await publicWrite.update(1, { title: 'Again' });
    const [second] = await auditRepo(install.meta).list({ limit: 1 });
    expect(second).toMatchObject({ actorKind: 'api-key', actorLabel: 'public:key_1' });
  });

  it('runs the hooks for its own writes, with its own context', async () => {
    const seen: WriteContext[] = [];
    const hooks: RecordHooks = {
      wants: () => Promise.resolve(true),
      before: async (event) => {
        seen.push(event.context);
        event.values.title = 'From a hook';
      },
      after: () => Promise.resolve(),
    };
    const tasks = (await helper({ hooks })).table('tasks');
    expect(await tasks.update(2, { title: 'x' })).toMatchObject({ title: 'From a hook' });
    expect(seen).toEqual([context()]);
  });

  it('refuses unknown columns, other databases and read-only connections', async () => {
    const db = await helper();
    await expect(db.table('tasks').insert({ titel: 'x' })).rejects.toThrow('main.tasks has no column "titel".');
    await expect(db.table('orders', { database: 'billing' }).get(1)).rejects.toThrow(
      'There is no database "billing" in adminium.config.ts.',
    );
    await expect(db.rawFor('billing')).rejects.toThrow('There is no database "billing"');
    expect(await db.rawFor('main')).toBe(db.raw);

    await install.manager.connections.update(install.mainId, { readOnly: true });
    const readOnly = await helper();
    await expect(readOnly.table('tasks').update(1, { title: 'x' })).rejects.toThrow('The database "main" is read-only in Adminium.');
    await expect(readOnly.table('tasks').delete(1)).rejects.toThrow('read-only');
    expect(await readOnly.table('tasks').get(1)).toMatchObject({ id: 1 });
  });
});

describe('record keys', () => {
  const table = (primaryKey: string[]): ResolvedTable => ({ id: 'public.lines', primaryKey }) as unknown as ResolvedTable;

  it('reads one-column and several-column keys', () => {
    expect(recordKey(table(['id']), 7)).toEqual({ id: 7 });
    expect(recordKey(table(['order_id', 'line']), { order_id: 1, line: 2, extra: 3 })).toEqual({ order_id: 1, line: 2 });
    expect(() => recordKey(table(['order_id', 'line']), 1)).toThrow('pass the id as an object');
    expect(() => recordKey(table(['order_id', 'line']), { order_id: 1 })).toThrow('needs a value for line');
    expect(() => recordKey(table([]), 1)).toThrow('has no primary key');
  });
});
