// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A MOVE MADE THROUGH A RECORD'S ACTION POSTS LIKE A SINGLE SAVE.
 *
 * A record's action is one save of one row, through the PATCH's own body: a
 * table whose rule posts to an add-on's ledger at a state takes, holds and
 * gives back through an action exactly as through the form — one receipt,
 * the ledger's rows, the answer in the reply — and the way back reverses once.
 */
import { overridesRepo, rolesRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from './auth-helpers.js';
import { LEGS } from './invoicing-install.helpers.js';
import { ledgerWorld, type LedgerWorld } from './ledger.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

const ASK = {
  id: 'ask',
  into: { addOn: 'ledger-kit', ledger: 'units', action: 'use' },
  map: { account: 'account_id', quantity: 'qty' },
  reserve: { on: { column: 'status', in: ['sent'] } },
  post: { on: { column: 'status', in: ['done'] } },
  reverse: { on: { column: 'status', in: ['cancelled'] } },
};
const STATES = {
  column: 'status',
  initial: 'draft',
  moves: { draft: ['sent'], sent: ['done', 'cancelled'] },
  actions: [
    { id: 'send', label: 'Send', move: { to: 'sent' } },
    { id: 'finish', label: 'Finish', move: { to: 'done' } },
    { id: 'cancel', label: 'Cancel', move: { to: 'cancelled' }, tone: 'danger' },
  ],
};

describe.each(LEGS)('a move through a record\'s action posts — %s', (dialect, available) => {
  let w: LedgerWorld;
  let served: Served;
  let cookie = '';
  const trusted = process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
  const id = (name: string) => w.target(name).table.id;
  const send = (method: string, url: string, payload: unknown) => served.composed.app.inject({ method: method as 'POST', url: `/api/v1/data/${w.h.connectionId}/${encodeURIComponent(id('asks'))}${url}`, headers: { cookie }, payload: payload as never });
  const act = (row: number, action: string, from: string) => send('POST', `/${String(row)}/actions/${action}`, { from });
  const ask = async (qty: string) => Number((await w.create('asks', { account_id: 1, qty, status: 'draft' }))['id']);
  const balance = async () => Number((await w.h.rows('SELECT balance FROM ledger_kit_accounts WHERE id = 1'))[0]!['balance']);
  const held = (row: number) => w.count('ledger_kit_holds', `state = 'held' AND receipt_id IN (SELECT id FROM ledger_kit_postings WHERE source_row = '${String(row)}' AND posting = 'ask')`);

  beforeAll(async () => {
    if (!available) return;
    const columns = 'account_id INT NULL, qty DECIMAL(12,3) NULL, status VARCHAR(20) NULL';
    w = await ledgerWorld(dialect, { asks: { columns, postings: [ASK] } }, undefined, async (h, idOf) => {
      await overridesRepo(h.meta).create({ connectionId: h.connectionId, op: 'table.states', tableName: idOf('asks'), columnName: null, value: STATES, origin: 'user' } as never);
    });
    await w.h.rows(`INSERT INTO ledger_kit_accounts (id, name, opening, taken, balance, allow_below, reorder_at) VALUES (1, 'Flour', 100, 0, 100, ${w.flag(false)}, 2)`);
    // The composed server loads the kit's deciding file from the harness's own store, as a developer's server does.
    process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = 'ledger-kit';
    served = await servePublic(w.h as never, null, { ADMINIUM_DATA_DIR: w.h.dataDir });
    const desk = await usersRepo(w.h.meta).create({ email: 'desk@actions.dev', name: 'Desk', passwordHash: await adminPasswordHash() });
    await rolesRepo(w.h.meta).assignToUser(desk.id, (await rolesRepo(w.h.meta).findBySlug('super-admin'))!.id);
    const login = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'desk@actions.dev', password: ADMIN_PASSWORD } });
    cookie = sessionCookie(login.headers['set-cookie']);
  }, 240_000);
  afterAll(async () => {
    if (trusted === undefined) delete process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
    else process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = trusted;
    if (!available) return;
    await served?.close();
    await w?.close();
  });

  it.skipIf(!available)('holds at the state the rule names, takes at the next, and says so in the reply — one receipt a step', async () => {
    const row = await ask('3');
    const sent = await act(row, 'send', 'draft');
    expect(sent.statusCode, sent.body).toBe(200);
    expect((sent.json() as { postings?: unknown[] }).postings).toMatchObject([{ ledger: 'units', state: 'ok' }]);
    expect(await held(row)).toBe(1);
    expect(await w.receiptsOf('ask', row)).toEqual(['reserve:1:planned:1']);

    const before = await balance();
    const done = await act(row, 'finish', 'sent');
    expect(done.statusCode, done.body).toBe(200);
    expect((done.json() as { postings?: unknown[] }).postings).toMatchObject([{ ledger: 'units', state: 'ok' }]);
    expect(await held(row)).toBe(0);
    expect(await balance()).toBe(before - 3);
    expect(await w.receiptsOf('ask', row)).toHaveLength(2);
  });

  it.skipIf(!available)('the way back gives the hold back once: a second press is told the row moved, and writes nothing', async () => {
    const row = await ask('2');
    expect((await act(row, 'send', 'draft')).statusCode).toBe(200);
    const back = await act(row, 'cancel', 'sent');
    expect(back.statusCode, back.body).toBe(200);
    expect((back.json() as { postings?: unknown[] }).postings).toMatchObject([{ ledger: 'units', state: 'ok' }]);
    expect(await held(row)).toBe(0);
    const receipts = await w.receiptsOf('ask', row);
    const again = await act(row, 'cancel', 'sent');
    expect(again.statusCode, again.body).toBe(409);
    expect(await w.receiptsOf('ask', row)).toEqual(receipts);
  });

  it.skipIf(!available)('is the form\'s own save: the same move through a PATCH leaves the same receipts', async () => {
    const [a, b] = [await ask('1'), await ask('1')];
    expect((await act(a, 'send', 'draft')).statusCode).toBe(200);
    const form = await send('PATCH', `/${String(b)}`, { values: { status: 'sent' }, from: 'draft' });
    expect(form.statusCode, form.body).toBe(200);
    expect(await w.receiptsOf('ask', a)).toEqual(await w.receiptsOf('ask', b));
    expect((form.json() as { postings?: unknown[] }).postings).toMatchObject([{ ledger: 'units', state: 'ok' }]);
  });

  it.skipIf(!available)('a move the ledger refuses is refused through the action with the ledger\'s own reason, and the row stays', async () => {
    const row = await ask('100000');
    const res = await act(row, 'send', 'draft');
    expect(res.statusCode, res.body).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe('POSTING_REFUSED');
    expect((await w.h.rows(`SELECT status FROM asks WHERE id = ${String(row)}`))[0]).toMatchObject({ status: 'draft' });
    expect(await w.receiptsOf('ask', row)).toEqual([]);
  });
});
