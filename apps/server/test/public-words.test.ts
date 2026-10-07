// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A PUBLIC ENTRY AN ADD-ON ANSWERS IN ITS OWN STOCK WORDS.
 *
 * A page asks about the rows it shows — at most sixty, by their ids — and
 * hears in, low or out for each one a guest may see. The add-on is asked
 * once for all of them, and not again for five seconds. How many are left
 * is said only under the owner's setting and only for today. An add-on that
 * cannot answer says nothing: every row then reads as in, and nothing is
 * written about it.
 */
import { publicKeysRepo, publicScopesRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { LedgerRuntime } from '../src/ledgers/registry.js';
import { generatePublishableKey } from '../src/public-api/keys.js';
import { compileScope } from '../src/public-api/scope.js';
import { answerWords, askedIds, couldBeKey, createWordsCache, type WordsCache } from '../src/routes/public/words-availability.js';
import { LEGS } from './invoicing-install.helpers.js';
import { ledgerWorld, type LedgerWorld } from './ledger.helpers.js';
import { ORIGIN, servePublic, type Served } from './public-lane.helpers.js';

describe.each(LEGS)('stock words through a public key — %s', (dialect, available) => {
  let w: LedgerWorld;
  let served: Served;
  let token = '';
  let scopeDoc: Record<string, unknown>;
  const trusted = process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
  const NOW = new Date('2031-01-02T12:00:00.000Z');
  const ask = (query: string) => served.composed.app.inject({ method: 'GET', url: `/api/v1/public/availability/stock${query}`, headers: { authorization: `Bearer ${token}`, origin: ORIGIN } });
  const data = (res: { json: () => unknown }) => (res.json() as { data: unknown[] }).data;

  /** The same question, asked of the function itself: with a clock, a cache and a runtime the test holds. */
  const direct = (under: string, over: { date?: string; cache?: WordsCache; ledgers?: LedgerRuntime | undefined; now?: Date; warn?: (...args: unknown[]) => void; app?: string | null; signedIn?: boolean; table?: string } = {}) => {
    const at = w.target(over.table ?? 'ledger_kit_accounts');
    return answerWords({
      query: { under, ...(over.date === undefined ? {} : { date: over.date }) },
      connectionId: w.h.connectionId,
      words: { addOn: 'ledger-kit', id: 'units-left' },
      app: over.app ?? null,
      ...(over.signedIn === undefined ? {} : { signedIn: over.signedIn }),
      byRef: compileScope(scopeDoc).byRef,
      timezone: 'UTC',
      view: at.view,
      table: at.table,
      db: at.db,
      dialect: at.dialect,
      now: over.now ?? NOW,
      ledgers: 'ledgers' in over ? over.ledgers : w.runtime,
      cache: over.cache ?? createWordsCache(),
      rollupsOf: () => [],
      log: { warn: (over.warn ?? (() => undefined)) as never },
    });
  };
  /** The world's runtime, counting how often an add-on is asked and for how many rows. */
  const counting = () => {
    const calls: number[] = [];
    const runtime: LedgerRuntime = { ...w.runtime, actionOf: (...args) => w.runtime.actionOf!(...args) };
    const cache = createWordsCache();
    return {
      calls,
      cache,
      ask: async (under: string, now = NOW) => {
        let asked = 0;
        const answer = await direct(under, { cache, now, ledgers: { ...runtime, actionOf: (...args) => ((asked += 1), runtime.actionOf!(...args)) } });
        calls.push(asked);
        return answer;
      },
    };
  };

  beforeAll(async () => {
    if (!available) return;
    w = await ledgerWorld(dialect, { notes: { columns: 'body VARCHAR(20) NULL', postings: [] } });
    const row = (id: number, name: string, balance: number, reorder: number) => `(${String(id)}, '${name}', ${String(balance)}, 0, ${String(balance)}, ${w.flag(false)}, ${String(reorder)})`;
    // Plenty; the T-shirt, L (18); the tote at its reorder level with 4; the T-shirt that is out; one no public read shows.
    await w.h.rows(`INSERT INTO ledger_kit_accounts (id, name, opening, taken, balance, allow_below, reorder_at) VALUES ${[row(1, 'Flour', 10, 2), row(2, 'T-shirt L', 18, 2), row(3, 'T-shirt S', 0, 2), row(4, 'Tote', 4, 4), row(5, 'Hidden', 0, 2), row(6, 'Cap', 0, 2)].join(', ')}`);
    for (let id = 10; id < 80; id += 1) await w.h.rows(`INSERT INTO ledger_kit_accounts (id, name, opening, taken, balance, allow_below, reorder_at) VALUES ${row(id, `Item ${String(id)}`, 9, 1)}`);
    await w.h.rows("INSERT INTO notes (id, body) VALUES (3, 'a note'), (4, 'another')");
    if ((await w.count('ledger_kit_settings')) === 0) await w.h.rows('INSERT INTO ledger_kit_settings (id) VALUES (1)');
    // The owner's own setting: a customer is told how many are left below five. The sample states none.
    await w.h.rows('UPDATE ledger_kit_settings SET show_left_below = 5');

    const table = w.target('ledger_kit_accounts').table.id;
    scopeDoc = {
      version: 1,
      side: 'customer',
      timezone: 'UTC',
      resources: [
        { ref: 'items', table, actions: ['read'], expose: ['id', 'name'], where: [{ column: 'name', op: 'neq', value: 'Hidden' }] },
        { ref: 'stock', table, actions: ['read'], expose: ['id'], kind: 'availability', words: { addOn: 'ledger-kit', id: 'units-left' } },
        // Kept for signed-in guests: every row, the hidden one too.
        { ref: 'members', table, actions: ['read'], expose: ['id', 'name'], sessionOnly: true },
        // Another table altogether, whose rows share ids with the accounts.
        { ref: 'notes', table: w.target('notes').table.id, actions: ['read'], expose: ['id'] },
      ],
    };
    const scope = await publicScopesRepo(w.h.meta).create({ connectionId: w.h.connectionId, side: 'customer', name: 'Shop', timezone: 'UTC', document: JSON.stringify(scopeDoc), createdBy: null });
    const key = generatePublishableKey();
    await publicKeysRepo(w.h.meta).create({ name: 'Site', prefix: key.prefix, tokenHash: key.tokenHash, tokenEncrypted: 'not-needed-here', scopeId: scope.id, side: 'customer', origins: [] });
    token = key.token;
    // The composed server loads the kit's deciding file from the harness's own store, as a developer's server does.
    process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = 'ledger-kit';
    served = await servePublic(w.h as never, null, { ADMINIUM_DATA_DIR: w.h.dataDir });
    // The server loads an add-on's code once it is up: until then the entry says in for every row (as it must). Wait for the kit.
    // (An ask too early is answered in, and leaves the kit alone for five seconds: give the load a moment first.)
    await new Promise((resolve) => setTimeout(resolve, 400));
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && JSON.stringify(data(await ask('?under=3'))) !== JSON.stringify([{ id: '3', state: 'out' }])) await new Promise((resolve) => setTimeout(resolve, 100));
  }, 240_000);
  afterAll(async () => {
    if (trusted === undefined) delete process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
    else process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = trusted;
    if (!available) return;
    await served?.close();
    await w?.close();
  });

  it.skipIf(!available)('the out T-shirt answers out; the tote, 4 left and shown below 5, answers low with left 4; plenty answers in with no figure', async () => {
    const res = await ask('?under=3,4,2,1');
    expect(res.statusCode, res.body).toBe(200);
    expect(data(res)).toEqual([
      { id: '3', state: 'out' },
      { id: '4', state: 'low', left: 4 },
      // Eighteen are left: above what the owner shows, so no figure.
      { id: '2', state: 'in' },
      { id: '1', state: 'in' },
    ]);
    // Nothing a staff member sees beside the state leaves through a key.
    expect(res.body).not.toMatch(/exact|batch|expires|first|soon|cause|Tote|18/);
  });

  it.skipIf(!available)('an id the key cannot read is left out, whatever its stock; so is one that is no row at all', async () => {
    expect(data(await ask('?under=5,3,999,abc,03,99999999999,1e3'))).toEqual([{ id: '3', state: 'out' }]);
    expect(data(await ask('?under=abc'))).toEqual([]);
    expect([couldBeKey('12', 'integer'), couldBeKey('-3', 'integer'), couldBeKey('012', 'integer'), couldBeKey('2147483648', 'integer'), couldBeKey('2147483648', 'bigint'), couldBeKey('1.5', 'bigint')]).toEqual([true, true, false, false, true, false]);
    expect([couldBeKey('6f1c2a34-0000-4000-8000-000000000001', 'uuid'), couldBeKey('abc', 'uuid'), couldBeKey('SKU-1', 'text'), couldBeKey('SKU-1', 'varchar'), couldBeKey('x'.repeat(64), 'text'), couldBeKey('x'.repeat(65), 'text'), couldBeKey('a\u0000b', 'text')]).toEqual([true, false, true, true, true, false, false]);
    // A key of a kind no id is typed for: nothing is handed to the database to be read as one.
    expect(['date', 'decimal', 'timestamptz', 'boolean', 'json'].map((type) => couldBeKey('2031-01-02', type))).toEqual([false, false, false, false, false]);
    // A read kept for signed-in guests shows its rows to nobody else: the hidden row is answered only with a session.
    const anonymous = await direct('5,3');
    expect(anonymous.ok && anonymous.data).toEqual([{ id: '3', state: 'out' }]);
    const member = await direct('5,3', { signedIn: true });
    expect(member.ok && member.data).toEqual([{ id: '5', state: 'out' }, { id: '3', state: 'out' }]);
    expect(data(await ask('?under=5'))).toEqual([]);
  });

  it.skipIf(!available)('only under and date are taken; no row named, or more than sixty, is refused', async () => {
    for (const query of ['', '?date=2031-01-02', '?under=%20,', '?under=1&qty=2', '?under=1&party=2', '?under=1&from=2031-01-02', '?under=1&code=X', `?under=${Array.from({ length: 61 }, (_, index) => String(index + 10)).join(',')}`]) {
      const res = await ask(query);
      expect(res.statusCode, query).toBe(400);
      expect((res.json() as { error: { code: string } }).error.code, query).toBe('PUBLIC_QUERY_REFUSED');
    }
    // An id named twice is one id.
    expect(askedIds(' 4 ,4,, 3 ')).toEqual(['4', '3']);
  });

  it.skipIf(!available)('sixty ids are answered by one question to the add-on', async () => {
    const c = counting();
    const ids = Array.from({ length: 60 }, (_, index) => String(index + 10));
    const answer = await c.ask(ids.join(','));
    expect(answer.ok && answer.data.map((line) => line.id)).toEqual(ids);
    expect(c.calls).toEqual([1]);
  });

  it.skipIf(!available)('a second ask inside five seconds asks the add-on for the new ids only; after five seconds, for all again', async () => {
    const c = counting();
    await c.ask('1,3');
    // Both are remembered: nobody is asked.
    await c.ask('3,1', new Date(NOW.getTime() + 4_999));
    expect(c.calls).toEqual([1, 0]);
    // What is remembered is what was said, even though the shelf has moved since.
    await w.h.rows('UPDATE ledger_kit_accounts SET balance = 9, opening = 9 WHERE id = 3');
    try {
      const mixed = await c.ask('3,4', new Date(NOW.getTime() + 4_999));
      expect(mixed.ok && mixed.data).toEqual([{ id: '3', state: 'out' }, { id: '4', state: 'low', left: 4 }]);
      expect(c.calls).toEqual([1, 0, 1]);
      const later = await c.ask('3', new Date(NOW.getTime() + 5_000));
      expect(later.ok && later.data).toEqual([{ id: '3', state: 'in' }]);
      expect(c.calls).toEqual([1, 0, 1, 1]);
    } finally {
      await w.h.rows('UPDATE ledger_kit_accounts SET balance = 0, opening = 0 WHERE id = 3');
    }
  });

  it.skipIf(!available)('left is never said without the owner\'s setting, for another day, or at 0', async () => {
    const today = await direct('4,3');
    expect(today.ok && today.data).toEqual([{ id: '4', state: 'low', left: 4 }, { id: '3', state: 'out' }]);
    const sameDay = await direct('4', { date: '2031-01-02' });
    expect(sameDay.ok && sameDay.data).toEqual([{ id: '4', state: 'low', left: 4 }]);
    // Another day: the state alone — and from the same remembered answer.
    const cache = createWordsCache();
    await direct('4', { cache });
    const tomorrow = await direct('4', { date: '2031-01-03', cache });
    expect(tomorrow.ok && tomorrow.data).toEqual([{ id: '4', state: 'low' }]);
    for (const setting of ['0', 'NULL']) {
      await w.h.rows(`UPDATE ledger_kit_settings SET show_left_below = ${setting}`);
      try {
        const none = await direct('4');
        expect(none.ok && none.data, setting).toEqual([{ id: '4', state: 'low' }]);
      } finally {
        await w.h.rows('UPDATE ledger_kit_settings SET show_left_below = 5');
      }
    }
  });

  it.skipIf(!available)('with the add-on off, or its code failing, every id answers in — said once in the log, never audited, never remembered', async () => {
    const audits = async () => Number((await w.h.meta.db.selectFrom('adminium_audit_log').select((eb) => eb.fn.countAll().as('n')).executeTakeFirst())!.n);
    const before = await audits();
    const cache = createWordsCache();
    const warned: unknown[] = [];
    const warn = (...args: unknown[]) => warned.push(args);
    // Its code is not loaded.
    const off = await direct('3,4', { cache, warn, ledgers: { ...w.runtime, actionOf: () => null } });
    expect(off.ok && off.data).toEqual([{ id: '3', state: 'in' }, { id: '4', state: 'in' }]);
    expect(warned).toHaveLength(1);
    // A server with no add-on runtime at all.
    const none = await direct('3', { cache: createWordsCache(), ledgers: undefined });
    expect(none.ok && none.data).toEqual([{ id: '3', state: 'in' }]);
    // One of its tables is gone (a read that throws): the same answer, never an error.
    const gone = await direct('3', { cache: createWordsCache(), warn, ledgers: { ...w.runtime, ledgerOf: () => { throw new Error('relation does not exist'); } } });
    expect(gone.ok && gone.data).toEqual([{ id: '3', state: 'in' }]);
    expect(warned).toHaveLength(2);
    // Its code throws — through the key, on the composed server.
    await w.misbehave('throw');
    try {
      // The cap is out, and nobody has asked about it yet (the server remembers an answer for five seconds).
      const failing = await ask('?under=6');
      expect(failing.statusCode, failing.body).toBe(200);
      expect(data(failing)).toEqual([{ id: '6', state: 'in' }]);
    } finally {
      await w.misbehave(null);
    }
    expect(await audits()).toBe(before);
    // Nothing of the failure was kept as an answer.
    expect(cache.size).toBe(0);
  });
});

describe.each(LEGS)('stock words: who is asked, and how often — %s', (dialect, available) => {
  let w: LedgerWorld;
  let scope: ReturnType<typeof compileScope>;
  const NOW = new Date('2031-01-02T12:00:00.000Z');
  /** Asks with a runtime that counts how often the add-on is reached. */
  const world = (over: Partial<LedgerRuntime> = {}) => {
    let asked = 0;
    const cache = createWordsCache();
    const warned: unknown[] = [];
    const ledgers: LedgerRuntime = { ...w.runtime, actionOf: (...args) => ((asked += 1), w.runtime.actionOf!(...args)), ...over };
    const ask = (under: string, more: { now?: Date; app?: string | null; table?: string } = {}) => {
      const at = w.target(more.table ?? 'ledger_kit_accounts');
      return answerWords({ query: { under }, connectionId: w.h.connectionId, words: { addOn: 'ledger-kit', id: 'units-left' }, app: more.app ?? null, byRef: scope.byRef, timezone: 'UTC', view: at.view, table: at.table, db: at.db, dialect: at.dialect, now: more.now ?? NOW, ledgers, cache, rollupsOf: () => [], log: { warn: ((...args: unknown[]) => warned.push(args)) as never } });
    };
    return { ask, cache, warned, asked: () => asked };
  };

  beforeAll(async () => {
    if (!available) return;
    w = await ledgerWorld(dialect, { notes: { columns: 'body VARCHAR(20) NULL', postings: [] } });
    await w.h.rows(`INSERT INTO ledger_kit_accounts (id, name, opening, taken, balance, allow_below, reorder_at) VALUES (3, 'T-shirt S', 0, 0, 0, ${w.flag(false)}, 2), (4, 'Tote', 4, 0, 4, ${w.flag(false)}, 4)`);
    await w.h.rows("INSERT INTO notes (id, body) VALUES (3, 'a note')");
    scope = compileScope({
      version: 1,
      side: 'customer',
      timezone: 'UTC',
      resources: [
        { ref: 'items', table: w.target('ledger_kit_accounts').table.id, actions: ['read'], expose: ['id'] },
        { ref: 'notes', table: w.target('notes').table.id, actions: ['read'], expose: ['id'] },
      ],
    });
  }, 240_000);
  afterAll(async () => {
    if (available) await w.close();
  });

  it.skipIf(!available)('an add-on switched off for the key\'s app, or not attached to it, answers nothing through that key — and is not asked', async () => {
    // The kit is attached to no app: a key of the app `pos` hears in for every row.
    const detached = world();
    const told = await detached.ask('3,4', { app: 'pos' });
    expect(told.ok && told.data).toEqual([{ id: '3', state: 'in' }, { id: '4', state: 'in' }]);
    expect(detached.asked()).toBe(0);
    // Nor is another key's remembered answer read for it.
    await detached.ask('3', { app: null });
    const still = await detached.ask('3', { app: 'pos' });
    expect(still.ok && still.data).toEqual([{ id: '3', state: 'in' }]);
    // Attached and on: answered. So is the add-on's own key, and a key the owner made.
    const on = world({ onFor: (_connection, addOn, app) => addOn === 'ledger-kit' && app === 'pos' });
    for (const app of ['pos', 'ledger-kit', null]) {
      const heard = await on.ask('3', { app, now: new Date(NOW.getTime() + 10_000 * (app === null ? 1 : app.length)) });
      expect(heard.ok && heard.data, String(app)).toEqual([{ id: '3', state: 'out' }]);
    }
    const other = await on.ask('3', { app: 'hotel' });
    expect(other.ok && other.data).toEqual([{ id: '3', state: 'in' }]);
  });

  it.skipIf(!available)('an add-on that failed is left alone for five seconds: in for every row, nobody asked, one line in the log — then asked again', async () => {
    let broken = true;
    const failing = world({ actionOf: (...args) => (broken ? null : w.runtime.actionOf!(...args)) });
    const first = await failing.ask('3');
    expect(first.ok && first.data).toEqual([{ id: '3', state: 'in' }]);
    expect(failing.warned).toHaveLength(1);
    broken = false;
    // Mended, and still inside the five seconds: not asked, not logged, nothing kept.
    const second = await failing.ask('3,4', { now: new Date(NOW.getTime() + 4_999) });
    expect(second.ok && second.data).toEqual([{ id: '3', state: 'in' }, { id: '4', state: 'in' }]);
    expect(failing.warned).toHaveLength(1);
    expect(failing.cache.size).toBe(0);
    const third = await failing.ask('3,4', { now: new Date(NOW.getTime() + 5_000) });
    expect(third.ok && third.data).toEqual([{ id: '3', state: 'out' }, { id: '4', state: 'low' }]);
  });

  it.skipIf(!available)('two asks for the same rows at once are one question to the add-on', async () => {
    const one = world();
    const [a, b] = await Promise.all([one.ask('3,4'), one.ask('3,4')]);
    expect(a).toEqual(b);
    expect(a.ok && a.data.map((line) => line.state)).toEqual(['out', 'low']);
    expect(one.asked()).toBe(1);
    // Once answered, the question is over: the same rows, asked when the answers are old, are asked of the add-on again.
    await one.ask('3,4', { now: new Date(NOW.getTime() + 5_000) });
    expect(one.asked()).toBe(2);
  });

  it.skipIf(!available)('words over an item answer only for the items\' own table: a row of another table with the same id is not that item', async () => {
    // Note 3 is a row a guest may see; account 3 is out. The entry is over the notes: nothing of account 3 is said.
    const misplaced = world();
    const told = await misplaced.ask('3', { table: 'notes' });
    expect(told.ok && told.data).toEqual([{ id: '3', state: 'in' }]);
    expect(misplaced.asked()).toBe(0);
    expect(misplaced.warned).toHaveLength(1);
  });
});

describe('the answers kept for five seconds', () => {
  it('are forgotten once old, and never more than the most kept: the oldest go first', () => {
    const cache = createWordsCache(3, 100);
    cache.set('a', { state: 'in' }, 0);
    cache.set('b', { state: 'low', left: 2 }, 10);
    cache.set('c', { state: 'out' }, 20);
    expect(cache.get('b', 50)).toEqual({ state: 'low', left: 2 });
    // Full of live answers: the oldest leaves.
    cache.set('d', { state: 'in' }, 30);
    expect(cache.size).toBe(3);
    expect(cache.get('a', 30)).toBeUndefined();
    expect(cache.get('d', 30)).toEqual({ state: 'in' });
    // Full again, of two answers past their time and one still good: the old ones make the room, the good one stays.
    cache.set('e', { state: 'in' }, 125);
    expect(cache.size).toBe(2);
    expect(cache.get('d', 125)).toEqual({ state: 'in' });
    expect(cache.get('e', 125)).toEqual({ state: 'in' });
    // At its time an answer is gone.
    expect(cache.get('d', 130)).toBeUndefined();
    expect(cache.size).toBe(1);
  });
});
