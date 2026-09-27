// SPDX-License-Identifier: AGPL-3.0-only
/**
 * How a guest's write through an entry with child rows, agreements, a retry
 * key or a dry run is refused — and what it is not refused for: a ticket for
 * a type that is not there answered as one that is hidden (never "busy"), on
 * a save and on a quote alike; an entry's agreement judged on every door that
 * writes its row (a create without child rows, a change, a quote of the
 * change, a row visible with its parent); a project hook's own words; a lock
 * race the engine gave up told as a moment's wait; a retry of the order that
 * filled a signed-in person's last place answered with that order; the
 * anonymous caps handed back only for the guest's own value; a quote of a
 * change that runs no hook and says so. On every engine.
 */
import { createRequire } from 'node:module';

import BetterSqlite3 from 'better-sqlite3';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { HookRejectedError, NO_RECORD_HOOKS } from '../src/crud/write-service.js';
import { solveProof } from '../src/public-api/proof.js';
import { installInvoicing, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { cents } from './order-tree-fixture.js';
import { servePublic, type Served } from './public-lane.helpers.js';
import { SEED, venue } from './venue-tree-fixture.js';

const prepare = BetterSqlite3.prototype.prepare;
const pgQuery = pg.Client.prototype.query;
/** The prototype the MySQL adapter's connections take `query` from (its own copy of mysql2). */
const mysql = createRequire(new URL('../../../packages/adapter-mysql/package.json', import.meta.url))('mysql2') as { Connection: { prototype: object } };
const mysqlBase = Object.getPrototypeOf(mysql.Connection.prototype) as { query: (...args: unknown[]) => unknown };
const mysqlQuery = mysqlBase.query;

/** The engine giving this write up in a lock race, once, at the statement that matches `pattern`. */
function loseRaceAt(dialect: string, pattern: RegExp): () => void {
  let fired = false;
  const hit = (sql: unknown) => !fired && typeof sql === 'string' && pattern.test(sql) && (fired = true);
  if (dialect === 'sqlite') {
    const spy = vi.spyOn(BetterSqlite3.prototype, 'prepare').mockImplementation(function (this: BetterSqlite3.Database, source: string) {
      if (hit(source)) throw Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' });
      return prepare.call(this, source);
    } as never);
    return () => spy.mockRestore();
  }
  if (dialect === 'postgres') {
    const spy = vi.spyOn(pg.Client.prototype, 'query').mockImplementation(function (this: pg.Client, ...args: unknown[]) {
      const sql = typeof args[0] === 'string' ? args[0] : (args[0] as { text?: unknown } | undefined)?.text;
      if (hit(sql)) return Promise.reject(Object.assign(new Error('deadlock detected'), { code: '40P01' }));
      return (pgQuery as (...a: unknown[]) => unknown).apply(this, args);
    } as never);
    return () => spy.mockRestore();
  }
  const spy = vi.spyOn(mysqlBase, 'query').mockImplementation(function (this: unknown, ...args: unknown[]) {
    const sql = typeof args[0] === 'string' ? args[0] : (args[0] as { sql?: unknown } | undefined)?.sql;
    const done = args.find((arg) => typeof arg === 'function') as ((error: unknown) => void) | undefined;
    if (hit(sql) && done !== undefined) {
      process.nextTick(() => done(Object.assign(new Error('Deadlock found when trying to get lock'), { code: 'ER_LOCK_DEADLOCK', errno: 1213 })));
      return undefined;
    }
    return mysqlQuery.apply(this, args);
  });
  return () => spy.mockRestore();
}

describe.each(LEGS)('refusals of a guest write that goes the tree way — %s', (dialect, available) => {
  let h: (InvoicingHarness & { reply: Record<string, unknown> }) | undefined;
  let served: Served;
  let ip = 0;
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, venue());
    for (const statement of SEED) await h.rows(statement);
    served = await servePublic(h, (h.reply['publicAccess'] as { keyId: string }).keyId);
  }, 180_000);
  afterAll(async () => {
    await served?.close();
    await h?.close();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const from = () => {
    ip += 1;
    return `10.8.${String((ip >> 8) & 255)}.${String(ip & 255)}`;
  };
  const proof = async (address: string, purpose: 'write' | 'claim' = 'write') => {
    const res = await served.composed.app.inject({ method: 'GET', url: `/api/v1/public/challenge?purpose=${purpose}`, remoteAddress: address, headers: served.headers() });
    const c = (res.json() as { data: { id: string; salt: string; difficulty: number } }).data;
    return `${c.id}.${solveProof(c.salt, c.difficulty)}`;
  };
  const call = async (method: 'POST' | 'PATCH', url: string, payload: Record<string, unknown>, opts: { session?: string; proof?: boolean } = {}) => {
    const address = from();
    return served.composed.app.inject({
      method,
      url: `/api/v1/public/records/${url}`,
      remoteAddress: address,
      headers: served.headers(opts.session, opts.proof === true ? { 'x-adminium-proof': await proof(address) } : {}),
      payload,
    });
  };
  const order = (tickets: Record<string, unknown>[], values: Record<string, unknown> = {}) => ({
    values: { event_id: 1, email: 'guest@example.com', name: 'Guest', ...values },
    children: { tickets: tickets.map((ticket) => ({ values: ticket })) },
  });
  const save = (payload: Record<string, unknown>, session?: string) => call('POST', 'rv_orders_claimed', payload, { proof: true, ...(session === undefined ? {} : { session }) });
  const quote = (payload: Record<string, unknown>) => call('POST', 'rv_orders_claimed/dry-run', payload);
  const refusal = (res: { json: () => unknown }) => (res.json() as { error: { code: string; message: string; params?: Record<string, unknown> } }).error;
  const count = async (ref: string, where = '1 = 1') => Number((await h!.rows(`select count(*) as n from ${h!.real(ref)} where ${where}`))[0]!['n']);
  const signIn = async (): Promise<string> => {
    const address = from();
    const res = await served.composed.app.inject({
      method: 'POST',
      url: '/api/v1/public/claim',
      remoteAddress: address,
      headers: served.headers(undefined, { 'x-adminium-proof': await proof(address, 'claim') }),
      payload: { match: { email: 'ada@example.com', phone: '0700' } },
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: { session: string } }).data.session;
  };

  it.runIf(available)('a ticket for a type that is not there is refused as one that is hidden, on a save and on a quote alike — never as busy', async () => {
    const before = [await count('orders'), await count('tickets')];
    const expected = { code: 'PUBLIC_WRITE_REFUSED', params: { child: 'tickets', index: 1, path: ['tickets', 1], column: 'ticket_type_id', reason: 'not-offered' } };
    for (const type of [2, 999]) {
      const saved = await save(order([{ ticket_type_id: 1 }, { ticket_type_id: type }], { email: `probe${String(type)}@example.com` }));
      expect(saved.statusCode, saved.body).toBe(400);
      expect(refusal(saved)).toMatchObject(expected);
      const quoted = await quote(order([{ ticket_type_id: 1 }, { ticket_type_id: type }]));
      expect(quoted.statusCode, quoted.body).toBe(400);
      expect(refusal(quoted)).toMatchObject(expected);
    }
    expect([await count('orders'), await count('tickets')]).toEqual(before);
    // What a type has sold is untouched by either.
    expect(Number((await h!.rows(`select coalesce(sold, 0) as n from ${h!.real('ticket_types')} where id = 1`))[0]!['n'])).toBe(0);
  });

  it.runIf(available)("an entry's agreement holds on a create that sends no child rows", async () => {
    const stays = await count('stays');
    const three = await call('POST', 'rv_stays', { values: { room_type_id: 1, guests: 3 } }, { proof: true });
    expect(three.statusCode, three.body).toBe(400);
    expect(refusal(three)).toMatchObject({ code: 'PUBLIC_WRITE_REFUSED', params: { column: 'guests', reason: 'too-many' } });
    expect(await count('stays')).toBe(stays);
    const two = await call('POST', 'rv_stays', { values: { room_type_id: 1, guests: 2 } }, { proof: true });
    expect(two.statusCode, two.body).toBe(201);
  });

  it.runIf(available)("an entry's agreement holds on a change, and on a quote of it", async () => {
    const session = await signIn();
    const guests = async () => Number((await h!.rows(`select guests from ${h!.real('stays')} where id = 1`))[0]!['guests']);
    for (const url of ['rv_stays_claimed/1/dry-run', 'rv_stays_claimed/1']) {
      const res = await call(url.endsWith('dry-run') ? 'POST' : 'PATCH', url, { values: { guests: 3 } }, { session });
      expect(res.statusCode, res.body).toBe(400);
      expect(refusal(res)).toMatchObject({ code: 'PUBLIC_WRITE_REFUSED', params: { column: 'guests', reason: 'too-many' } });
    }
    expect(await guests()).toBe(2);
    // A family room sleeps four: the same three guests fit once the room changes with them.
    const moved = await call('PATCH', 'rv_stays_claimed/1', { values: { guests: 3, room_type_id: 2 } }, { session });
    expect(moved.statusCode, moved.body).toBe(200);
    expect(await guests()).toBe(3);
    const back = await call('PATCH', 'rv_stays_claimed/1', { values: { guests: 2, room_type_id: 1 } }, { session });
    expect(back.statusCode, back.body).toBe(200);
  });

  it.runIf(available)("an entry's agreement holds on a row visible with its parent", async () => {
    const session = await signIn();
    const extras = await count('stay_extras');
    const three = await call('POST', 'rv_stay_extras_claimed', { values: { stay_id: 1, extra_id: 1, qty: 3 } }, { session });
    expect(three.statusCode, three.body).toBe(400);
    expect(refusal(three)).toMatchObject({ code: 'PUBLIC_WRITE_REFUSED', params: { column: 'qty', reason: 'too-many' } });
    expect(await count('stay_extras')).toBe(extras);
    const two = await call('POST', 'rv_stay_extras_claimed', { values: { stay_id: 1, extra_id: 1, qty: 2 } }, { session });
    expect(two.statusCode, two.body).toBe(201);
  });

  it.runIf(available)("a project hook's refusal of the row a tree writes keeps its own words", async () => {
    const stays = h!.real('stays');
    vi.spyOn(NO_RECORD_HOOKS, 'wants').mockImplementation(async (timing, action, target) => timing === 'before' && action === 'create' && target.table.name === stays);
    vi.spyOn(NO_RECORD_HOOKS, 'before').mockImplementation(async (event) => {
      if (event.target.table.name === stays) throw new HookRejectedError('No stays on the night of the gala.', 'hooks/stays');
    });
    const res = await call('POST', 'rv_stays', { values: { room_type_id: 1, guests: 1 } }, { proof: true });
    expect(res.statusCode, res.body).toBe(400);
    expect(refusal(res)).toMatchObject({ code: 'PUBLIC_WRITE_REJECTED', message: 'No stays on the night of the gala.' });
  });

  it.runIf(available)('a quote of a change runs no hook and says the save may differ; without one it says it is exact', async () => {
    const session = await signIn();
    const plain = await call('POST', 'rv_stays_claimed/1/dry-run', { values: { guests: 1 } }, { session });
    expect(plain.statusCode, plain.body).toBe(200);
    expect(plain.json()).toMatchObject({ data: { guests: 1 }, exact: true });
    const stays = h!.real('stays');
    vi.spyOn(NO_RECORD_HOOKS, 'wants').mockImplementation(async (timing, action, target) => timing === 'before' && action === 'update' && target.table.name === stays);
    const ran = vi.spyOn(NO_RECORD_HOOKS, 'before').mockImplementation(async () => undefined);
    const hooked = await call('POST', 'rv_stays_claimed/1/dry-run', { values: { guests: 1 } }, { session });
    expect(hooked.statusCode, hooked.body).toBe(200);
    expect(hooked.json()).toMatchObject({ data: { guests: 1 }, exact: false });
    expect(ran).not.toHaveBeenCalled();
    // The save runs it.
    const saved = await call('PATCH', 'rv_stays_claimed/1', { values: { guests: 1 } }, { session });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(ran).toHaveBeenCalled();
  });

  it.runIf(available)('a lock race the engine gave up inside a tree is a moment to wait, not a refused write; nothing is kept', async () => {
    const before = [await count('orders'), await count('tickets')];
    const tickets = h!.real('tickets');
    const restore = loseRaceAt(dialect, new RegExp(`insert into (?:[\`"]?\\w+[\`"]?\\.)?[\`"]?${tickets}[\`"]? `, 'i'));
    let res;
    try {
      res = await save(order([{ ticket_type_id: 1 }], { email: 'racer@example.com' }));
    } finally {
      restore();
    }
    expect(res.statusCode, res.body).toBe(409);
    expect(refusal(res).code).toBe('PUBLIC_SLOT_BUSY');
    expect([await count('orders'), await count('tickets')]).toEqual(before);
    // The same write a moment later goes through.
    const again = await save(order([{ ticket_type_id: 1 }], { email: 'racer@example.com' }));
    expect(again.statusCode, again.body).toBe(201);
  });

  it.runIf(available)('a retry of the order that filled a signed-in guest\'s last place answers that order; a new one is still refused', async () => {
    const session = await signIn();
    const key = 'filled-last-place-0123456789';
    const first = await save(order([{ ticket_type_id: 1 }], { client_key: key }), session);
    expect(first.statusCode, first.body).toBe(201);
    const again = await save(order([{ ticket_type_id: 1 }], { client_key: key }), session);
    expect(again.statusCode, again.body).toBe(200);
    expect(again.json()).toMatchObject({ replayed: true, data: (first.json() as { data: unknown }).data });
    const other = await save(order([{ ticket_type_id: 1 }], { client_key: 'another-order-0123456789ab' }), session);
    expect(other.statusCode, other.body).toBe(409);
    expect(refusal(other).code).toBe('PUBLIC_LIMIT_REACHED');
    await h!.rows(`update ${h!.real('orders')} set status = 'done' where buyer_id = 1`);
  });

  it.runIf(available)("the anonymous caps are handed back when the guest's own value is refused, and kept when anything else is", async () => {
    const tooLong = { ticket_type_id: 1, holder: 'x'.repeat(41) };
    // Three refusals of the guest's own value, each handed back: the fourth try, right, goes through.
    for (let i = 0; i < 3; i += 1) {
      const res = await save(order([tooLong], { email: 'own@example.com' }));
      expect(res.statusCode, res.body).toBe(400);
      expect(refusal(res).params).toMatchObject({ column: 'holder', reason: 'too-long' });
    }
    expect((await save(order([{ ticket_type_id: 1 }], { email: 'own@example.com' }))).statusCode).toBe(201);
    // A refusal the guest's value did not make (a hidden type) keeps what it counted: two, and the address is spent.
    for (let i = 0; i < 2; i += 1) {
      const res = await save(order([{ ticket_type_id: 2 }], { email: 'kept@example.com' }));
      expect(refusal(res).params).toMatchObject({ reason: 'not-offered' });
    }
    const spent = await save(order([{ ticket_type_id: 1 }], { email: 'kept@example.com' }));
    expect(spent.statusCode, spent.body).toBe(409);
    expect(refusal(spent).code).toBe('PUBLIC_LIMIT_REACHED');
  });

  it.runIf(available)('a saved order climbs into what its type has sold', async () => {
    const sold = async () => Number((await h!.rows(`select coalesce(sold, 0) as n from ${h!.real('ticket_types')} where id = 1`))[0]!['n']);
    const was = await sold();
    const res = await save(order([{ ticket_type_id: 1 }, { ticket_type_id: 1 }], { email: 'two@example.com' }));
    expect(res.statusCode, res.body).toBe(201);
    expect(cents((res.json() as { data: Record<string, unknown> }).data['total'])).toBe('50.00');
    expect(await sold()).toBe(was + 2);
  });
});
