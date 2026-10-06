// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE BUTTONS A RECORD PAGE IS TOLD IT MAY SHOW.
 *
 * Which of a table's actions one person is offered, and in which states of
 * the row, is the server's answer in the page reply: from the stored rule,
 * the person's roles, and what those roles may write. A move kept for another
 * role, a state their role may not set, a child row they may not make with
 * those values, a link to a page they may not open — none is offered. A move
 * only a ledger makes is offered to nobody.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { SnapshotView } from '../src/crud/identifiers.js';
import { stateActionFacts, type StateActionFact } from '../src/routes/pages/state-actions.js';
import { shop, type Shop } from './state-action.helpers.js';

const ALL = { read: true, create: true, update: true, delete: true };

describe('the actions a record page is told of', () => {
  let s: Shop;
  let view = '';
  const actions = async (as: string): Promise<StateActionFact[] | undefined> => {
    const res = await s.api('GET', `/pages/${s.pageId}`, undefined, as);
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { stateActions?: StateActionFact[] }).stateActions;
  };
  const offered = async (as: string) => Object.fromEntries(((await actions(as)) ?? []).map((action) => [action.id, action.from]));

  beforeAll(async () => {
    s = await shop('sqlite');
    view = `page:${s.pageId}:view`;
    await s.person('clerk', { orders: ALL, order_lines: ALL }, [], [view]);
    await s.person('keeper', { orders: ALL, order_lines: ALL }, ['shop-manager'], [view]);
    // May set the state to sent, and a note: no other state, no other column.
    await s.person('runner', { orders: { read: true, update: true, updateLimit: { writable: ['status', 'note'], writableValues: { status: ['sent'] } } } }, [], [view]);
    // Reads orders and may add lines — one only plain items, the other extras too.
    await s.person('picker', { orders: { read: true }, order_lines: { read: true, create: true, createLimit: { writable: ['order_id', 'qty', 'kind'], writableValues: { kind: ['item'] } } } }, [], [view]);
    await s.person('packer', { orders: { read: true }, order_lines: { read: true, create: true, createLimit: { writable: ['order_id', 'qty', 'kind'], writableValues: { kind: ['extra'] } } } }, [], [view]);
    await s.person('looker', { orders: { read: true } }, [], [view]);
    // Holds the manager's role, and may write the state alone: what Close asks for is not theirs to type.
    // Read orders only in part: one cannot read the note Send again asks for, the other cannot read the state.
    await s.person('half', { orders: { read: true, update: true, readLimit: { readable: ['id', 'customer', 'status', 'reason'] } } }, ['shop-manager'], [view]);
    await s.person('blind', { orders: { read: true, update: true, readLimit: { readable: ['id', 'customer', 'note', 'reason'] } } }, ['shop-manager'], [view]);
    await s.person('stamper', { orders: { read: true, update: true, updateLimit: { writable: ['status'] } } }, ['shop-manager'], [view]);
  }, 240_000);
  afterAll(async () => {
    await s.close();
  });

  it('somebody who may do everything is offered each action in the states it has', async () => {
    expect(await offered('boss')).toEqual({
      send: ['draft'],
      close: ['sent'],
      cancel: ['draft', 'sent'],
      // From sent only a ledger's own row settles an order: that move is nobody's button.
      settle: ['done'],
      'send-again': ['sent'],
      open: ['sent', 'done'],
      // A line is added only while the order is a draft: the tie to its order says so.
      'add-line': ['draft'],
    });
  });

  it('each is told with its words, its tone and what it asks for — and never with what a move or a set writes', async () => {
    const list = (await actions('boss'))!;
    const by = (id: string) => list.find((action) => action.id === id)!;
    expect(by('send')).toEqual({ id: 'send', kind: 'move', label: 'Send', tone: 'primary', confirm: 'Send this order?', from: ['draft'] });
    expect(by('close')).toEqual({ id: 'close', kind: 'move', label: 'Close', tone: 'neutral', from: ['sent'], ask: [{ column: 'reason', label: expect.any(String), required: false }] });
    expect(by('send-again')).toMatchObject({ kind: 'set', ask: [{ column: 'note', required: false }] });
    expect(by('send-again')).not.toHaveProperty('set');
    expect(by('open')).toMatchObject({ kind: 'link', href: '/p/shop-orders?order=' });
    // A child form's fixed values are the page's to send with a plain create: they are told.
    expect(by('add-line')).toEqual({ id: 'add-line', kind: 'child', label: 'Add a line', tone: 'neutral', from: ['draft'], child: { table: s.id('order_lines'), via: 'order_id', form: ['qty'] }, set: { kind: 'extra' } });
  });

  it('a move kept for another role is not offered', async () => {
    expect(await offered('clerk')).not.toHaveProperty('close');
    expect((await offered('keeper'))['close']).toEqual(['sent']);
    // Everything else a clerk may write is there.
    expect(Object.keys(await offered('clerk')).sort()).toEqual(['add-line', 'cancel', 'open', 'send', 'send-again', 'settle']);
  });

  it('a role limited to other states gets no button for this one, and none that writes a column it may not', async () => {
    // Sent is theirs to set; cancelled, done and settled are not. Send again writes two columns outside their limit.
    expect(await offered('runner')).toEqual({ send: ['draft'], open: ['sent', 'done'] });
  });

  it('an action that asks for a column the role may not write is not offered', async () => {
    expect(await offered('stamper')).toEqual({ send: ['draft'], cancel: ['draft', 'sent'], settle: ['done'], open: ['sent', 'done'] });
  });

  it('an action that would only be refused for what the role does not read is not offered', async () => {
    // The note is hidden from them and no update of theirs names it: Send again would be refused at the save.
    expect(await offered('half')).toEqual({ send: ['draft'], close: ['sent'], cancel: ['draft', 'sent'], settle: ['done'], open: ['sent', 'done'] });
    // A write that moves nothing names the state the page saw: somebody who does not read the state cannot.
    expect(await offered('blind')).not.toHaveProperty('send-again');
    expect((await offered('blind'))['close']).toEqual(['sent']);
  });

  it('a child action is offered only where the role may create that row with those values', async () => {
    // The form's fixed value is `kind: extra`: a role that may only make plain items gets no button.
    expect(await offered('picker')).toEqual({ open: ['sent', 'done'] });
    expect(await offered('packer')).toEqual({ open: ['sent', 'done'], 'add-line': ['draft'] });
    // And somebody who may not create there at all.
    expect(await offered('looker')).toEqual({ open: ['sent', 'done'] });
  });

  it('a link to a page the reader may not open is left out', async () => {
    const facts = await stateActionFacts(
      s.h.meta,
      { can: async (permission) => permission !== view, permissions: { superAdmin: true, roleIds: [] } },
      (await viewOf(s)) as SnapshotView,
      s.id('orders'),
    );
    expect(facts!.map((action) => action.id)).not.toContain('open');
    expect(facts!.map((action) => action.id)).toContain('send');
  });

  it('the words are the reader\'s own language where the app has them', async () => {
    const saved = await s.api('PATCH', '/me/prefs', { locale: 'de_DE' }, 'keeper');
    expect(saved.statusCode, saved.body).toBe(200);
    const list = (await actions('keeper'))!;
    expect(list.find((action) => action.id === 'send')!.label).toBe('Senden');
    // A label with one spelling is that spelling for everyone.
    expect(list.find((action) => action.id === 'close')!.label).toBe('Close');
  });

  it('a facts error leaves the key out and the page still reads', async () => {
    const warned: string[] = [];
    const broken = { connectionId: s.h.connectionId, table: () => { throw new Error('the snapshot is gone'); } } as unknown as SnapshotView;
    const facts = await stateActionFacts(s.h.meta, { can: async () => true, permissions: { superAdmin: true, roleIds: [] }, log: { warn: (_details, message) => void warned.push(message) } }, broken, s.id('orders'));
    expect(facts).toBeUndefined();
    expect(warned).toHaveLength(1);
  });

  it('a table with no actions, and a page over one, say nothing', async () => {
    expect(await stateActionFacts(s.h.meta, { can: async () => true, permissions: { superAdmin: true, roleIds: [] } }, (await viewOf(s)) as SnapshotView, s.id('order_lines'))).toBeUndefined();
  });
});

/** The shop's tables as a page's facts read them. */
async function viewOf(s: Shop): Promise<unknown> {
  const { factsViewFor } = await import('../src/routes/pages/column-facts.js');
  return factsViewFor(s.h.meta, s.h.connectionId);
}
