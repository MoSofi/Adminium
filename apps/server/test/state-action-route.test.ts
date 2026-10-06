// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A RECORD'S OWN ACTION, MADE.
 *
 * A record page sends an action's id, the state it saw the row in and the few
 * values the action asks for. The target state and the columns the action
 * sets are the rule's: a browser cannot name them. And the save is the
 * PATCH's own — the same refusals, the same audit row, the same Undo.
 */
import { overridesRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LEGS } from './invoicing-install.helpers.js';
import { errorOf, shop, type Shop } from './state-action.helpers.js';

const ALL = { read: true, create: true, update: true, delete: true };

describe.each(LEGS)('a record\'s own action — %s', (dialect, available) => {
  let s: Shop;
  beforeAll(async () => {
    if (!available) return;
    s = await shop(dialect);
    // A clerk writes orders; the keeper holds the app's manager role as well; the runner may set a state and a note, nothing else.
    await s.person('clerk', { orders: ALL, order_lines: ALL });
    await s.person('keeper', { orders: ALL, order_lines: ALL }, ['shop-manager']);
    // Reads an order's customer and nothing else of it, yet may change it.
    await s.person('blind', { orders: { read: true, update: true, readLimit: { readable: ['id', 'customer'] } } });
    await s.person('runner', { orders: { read: true, update: true, updateLimit: { writable: ['status', 'note'], writableValues: { status: ['sent'] } } } });
  }, 240_000);
  afterAll(async () => {
    if (available) await s.close();
  });
  const sent = async () => {
    const id = await s.order();
    expect((await s.act(id, 'send', { from: 'draft' })).statusCode).toBe(200);
    return id;
  };
  const on = (value: unknown) => value === true || value === 1 || value === '1';

  it.skipIf(!available)('a move is made by its id: the state is the rule\'s, and so is what it sets — at the server\'s time', async () => {
    const id = await s.order();
    const before = Date.now();
    const res = await s.act(id, 'send', { from: 'draft' }, 'clerk');
    expect(res.statusCode, res.body).toBe(200);
    const row = await s.row('orders', id);
    expect(row['status']).toBe('sent');
    expect(on(row['no_email'])).toBe(true);
    // The time is the server's own, told back as an instant.
    const told = (res.json() as { data: { sent_at: string } }).data.sent_at;
    expect(Math.abs(new Date(told).getTime() - before)).toBeLessThan(60_000);
    expect((res.json() as { data: { status: string } }).data.status).toBe('sent');
  });

  it.skipIf(!available)('the browser cannot name the state: a body with `to` is refused', async () => {
    const id = await s.order();
    const res = await s.act(id, 'send', { from: 'draft', to: 'done' });
    expect(res.statusCode, res.body).toBe(422);
    expect((await s.row('orders', id))['status']).toBe('draft');
  });

  it.skipIf(!available)('a value outside `ask` is refused, by name — a column the action sets among them', async () => {
    const id = await sent();
    const stray = await s.act(id, 'close', { from: 'sent', values: { reason: 'done', note: 'and this' } }, 'keeper');
    expect(stray.statusCode, stray.body).toBe(422);
    expect(errorOf(stray).details).toMatchObject({ fields: { note: { code: 'not-writable' } } });
    const other = await s.order();
    // What the action sets is not the caller's to send, whatever they send.
    for (const values of [{ no_email: false }, { sent_at: '2001-01-01T00:00:00.000Z' }, { status: 'done' }]) {
      const res = await s.act(other, 'send', { from: 'draft', values });
      expect(res.statusCode, res.body).toBe(422);
    }
    expect((await s.row('orders', other))['status']).toBe('draft');
  });

  it.skipIf(!available)('what it asks for is written with the move', async () => {
    const id = await sent();
    const res = await s.act(id, 'close', { from: 'sent', values: { reason: 'Collected' } }, 'keeper');
    expect(res.statusCode, res.body).toBe(200);
    expect(await s.row('orders', id)).toMatchObject({ status: 'done', reason: 'Collected' });
  });

  it.skipIf(!available)('a move kept for a role is refused to another, as a change of the row is', async () => {
    const id = await sent();
    const res = await s.act(id, 'close', { from: 'sent', values: { reason: 'x' } }, 'clerk');
    expect(res.statusCode, res.body).toBe(409);
    expect(errorOf(res)).toMatchObject({ code: 'STATE_MOVE_REFUSED', details: { from: 'sent', to: 'done' } });
    expect((await s.row('orders', id))['status']).toBe('sent');
  });

  it.skipIf(!available)('a row moved on since is refused, never moved from where it is', async () => {
    const id = await sent();
    // The page still shows a draft: its Cancel would be a move from sent, which waits for a line.
    const stale = await s.act(id, 'cancel', { from: 'draft' });
    expect(stale.statusCode, stale.body).toBe(409);
    expect(errorOf(stale)).toMatchObject({ code: 'STATE_MOVE_REFUSED' });
    expect((await s.row('orders', id))['status']).toBe('sent');
    // And two pages sending the same move: the second is told, not made twice.
    const again = await s.act(id, 'send', { from: 'draft' });
    expect(again.statusCode, again.body).toBe(409);
  });

  it.skipIf(!available)('a move pressed on a row already there is refused: its columns are not written again, by anybody', async () => {
    const id = await sent();
    const first = (await s.row('orders', id))['sent_at'];
    await s.h.rows(`UPDATE ${s.h.real('orders')} SET no_email = ${dialect === 'postgres' ? 'false' : '0'} WHERE id = ${String(id)}`);
    // The runner may set sent; the row is sent. Nothing changes, so nothing would judge the move: it is refused outright.
    for (const who of ['runner', 'clerk', 'boss']) {
      const res = await s.act(id, 'send', { from: 'sent' }, who);
      expect(res.statusCode, res.body).toBe(409);
      expect(errorOf(res)).toMatchObject({ code: 'STATE_MOVE_REFUSED', details: { from: 'sent', to: 'sent' } });
    }
    const row = await s.row('orders', id);
    expect(on(row['no_email'])).toBe(false);
    expect(row['sent_at']).toEqual(first);
    // A move kept for a role, on a row already moved: the same answer, not the move's columns.
    await s.h.rows(`UPDATE ${s.h.real('orders')} SET status = 'done' WHERE id = ${String(id)}`);
    const kept = await s.act(id, 'close', { from: 'done', values: { reason: 'Rewritten' } }, 'clerk');
    expect(kept.statusCode, kept.body).toBe(409);
    expect((await s.row('orders', id))['reason']).toBeNull();
  });

  it.skipIf(!available)('an action that only sets writes its columns and moves nothing', async () => {
    const id = await sent();
    const res = await s.act(id, 'send-again', { from: 'sent', values: { note: 'Asked by phone' } }, 'clerk');
    expect(res.statusCode, res.body).toBe(200);
    const row = await s.row('orders', id);
    expect(row).toMatchObject({ status: 'sent', note: 'Asked by phone' });
    expect(Number(row['resends'])).toBe(1);
    expect(row['resent_at']).not.toBeNull();
  });

  it.skipIf(!available)('a set action on a row that left its state is refused ROW_CHANGED; one never offered in that state is refused as a move is', async () => {
    const id = await sent();
    await s.h.rows(`UPDATE ${s.h.real('orders')} SET status = 'done' WHERE id = ${String(id)}`);
    const moved = await s.act(id, 'send-again', { from: 'sent' });
    expect(moved.statusCode, moved.body).toBe(409);
    expect(errorOf(moved)).toMatchObject({ code: 'ROW_CHANGED', details: { column: 'status' } });
    const never = await s.act(id, 'send-again', { from: 'done' });
    expect(never.statusCode, never.body).toBe(409);
    expect(errorOf(never)).toMatchObject({ code: 'STATE_MOVE_REFUSED', details: { from: 'done' } });
    expect((await s.row('orders', id))['resent_at']).toBeNull();
  });

  it.skipIf(!available)('a set action is held to the role\'s update limit; a move\'s own columns are not', async () => {
    const id = await s.order();
    // The runner may set the state to sent: the time and the flag the move sets are the move's.
    const moved = await s.act(id, 'send', { from: 'draft' }, 'runner');
    expect(moved.statusCode, moved.body).toBe(200);
    expect(on((await s.row('orders', id))['no_email'])).toBe(true);
    // Send again writes two columns their role may not: refused, and nothing written.
    const set = await s.act(id, 'send-again', { from: 'sent' }, 'runner');
    expect(set.statusCode, set.body).toBe(403);
    expect(errorOf(set)).toMatchObject({ code: 'COLUMN_FORBIDDEN', details: { reason: 'update-limit' } });
    expect((await s.row('orders', id))['resent_at']).toBeNull();
    // And a state their role may not set is refused through an action as through a form.
    const other = await s.order();
    const cancel = await s.act(other, 'cancel', { from: 'draft' }, 'runner');
    expect(cancel.statusCode, cancel.body).toBe(403);
    expect(errorOf(cancel)).toMatchObject({ code: 'COLUMN_FORBIDDEN', details: { column: 'status' } });
  });

  it.skipIf(!available)('the action\'s save is the PATCH\'s save: the same audit row, the same offer of an Undo', async () => {
    const [a, b] = [await s.order(), await s.order()];
    const acted = await s.act(a, 'cancel', { from: 'draft' });
    const patched = await s.api('PATCH', `/data/${s.h.connectionId}/${encodeURIComponent(s.id('orders'))}/${String(b)}`, { values: { status: 'cancelled' }, from: 'draft' });
    expect([acted.statusCode, patched.statusCode], `${acted.body} ${patched.body}`).toEqual([200, 200]);
    // No move leads back from cancelled, so neither door offers an Undo of it.
    expect((acted.json() as { undoToken: string | null }).undoToken).toBe((patched.json() as { undoToken: string | null }).undoToken);
    const audit = await s.h.meta.db.selectFrom('adminium_audit_log').select(['action', 'entityId', 'changes']).where('action', '=', 'record.update').orderBy('createdAt', 'desc').limit(10).execute();
    const entry = (key: number) => audit.find((one) => String(one.entityId) === String(key) && JSON.stringify(one.changes).includes('cancelled'));
    expect(entry(a)).toBeDefined();
    expect(Object.keys(JSON.parse(JSON.stringify(entry(a)!.changes)) as object).sort()).toEqual(Object.keys(JSON.parse(JSON.stringify(entry(b)!.changes)) as object).sort());
    // A write that moves nothing answers as the same change through the form does, Undo and all.
    const [c, d] = [await sent(), await sent()];
    const set = await s.act(c, 'send-again', { from: 'sent', values: { note: 'Once more' } });
    const form = await s.api('PATCH', `/data/${s.h.connectionId}/${encodeURIComponent(s.id('orders'))}/${String(d)}`, { values: { note: 'Once more', resends: 1 }, seen: { status: 'sent' } });
    expect([set.statusCode, form.statusCode], `${set.body} ${form.body}`).toEqual([200, 200]);
    expect(typeof (set.json() as { undoToken: unknown }).undoToken).toBe(typeof (form.json() as { undoToken: unknown }).undoToken);
  });

  it.skipIf(!available)('a link, a child form, an action of another table and no action at all are one answer: not found', async () => {
    const id = await sent();
    for (const action of ['open', 'add-line', 'no-such']) {
      const res = await s.act(id, action, { from: 'sent' });
      expect(res.statusCode, `${action} ${res.body}`).toBe(404);
      expect(errorOf(res).code).toBe('NOT_FOUND');
    }
    const gone = await s.act(999_999, 'cancel', { from: 'draft' });
    expect(gone.statusCode).toBe(404);
    expect(errorOf(gone).message).toBe(errorOf(await s.act(id, 'no-such', { from: 'sent' })).message);
    // Nobody signed in, and somebody with no update here, are refused before any of that.
    expect((await s.act(id, 'cancel', { from: 'sent' }, '')).statusCode).toBe(401);
  });

  it.skipIf(!available)('a refused move tells a read-limited role nothing of the row', async () => {
    const id = await sent();
    const open = await s.act(id, 'cancel', { from: 'sent' });
    const kept = await s.act(id, 'cancel', { from: 'sent' }, 'blind');
    expect([open.statusCode, kept.statusCode], kept.body).toEqual([409, 409]);
    expect(JSON.stringify(errorOf(open))).toContain('cancelled');
    // Neither the state it is in nor the one it would go to: the role does not read that column.
    expect(errorOf(kept).message).toBe('This move cannot be made now.');
    expect(JSON.stringify(errorOf(kept))).not.toMatch(/"from"|"to"|cancelled|sent/);
  });

  it.skipIf(!available)('`set` is the rule\'s, whatever the body says — even where an owner\'s rule asks for the same column', async () => {
    // A manifest may not ask for a column it sets; a rule saved by hand may. The rule's value still wins.
    const rules = overridesRepo(s.h.meta);
    const stored = (await rules.listForConnection(s.h.connectionId, { status: 'active' })).find((row) => row.op === 'table.states' && row.tableName === s.id('orders'))!;
    const value = structuredClone(stored.value) as { actions: Record<string, unknown>[] };
    value.actions.push({ id: 'flag', label: 'Flag', set: { no_email: true }, in: ['draft'], ask: ['no_email'] });
    await rules.delete(stored.id);
    await rules.create({ connectionId: s.h.connectionId, op: 'table.states', tableName: stored.tableName, columnName: null, value, origin: 'app' } as never);
    const id = await s.order();
    const res = await s.act(id, 'flag', { from: 'draft', values: { no_email: false } });
    expect(res.statusCode, res.body).toBe(200);
    expect(on((await s.row('orders', id))['no_email'])).toBe(true);
  });

  it.skipIf(!available)('a move that waits for something is refused with what it waits for', async () => {
    const id = await sent();
    const res = await s.act(id, 'cancel', { from: 'sent' });
    expect(res.statusCode, res.body).toBe(409);
    expect(errorOf(res)).toMatchObject({ code: 'STATE_MOVE_REFUSED', details: { from: 'sent', to: 'cancelled' } });
    expect(errorOf(res).details).toHaveProperty('requires');
  });
});
