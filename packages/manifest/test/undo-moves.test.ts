// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A move that takes back the one before it (`undo` on a listed move), the
 * stamps it empties (`stamp.clearOnBack`) and a message that waits a few
 * seconds before it may go (`holdSeconds`), so an undo drops it.
 *
 * A kitchen's orders validate as they are; each test breaks one thing and
 * reads the sentence.
 */
import { describe, expect, it } from 'vitest';

import { validateManifest } from '../src/index.js';

type Doc = Record<string, unknown>;

const id = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength = 120) => ({ ref, type: 'text', maxLength, nullable: true });
const stamp = (ref: string, type: string, set: string, state: string, clearOnBack = false) => ({
  ref,
  type,
  nullable: true,
  rules: { stamp: { set, on: { column: 'status', values: [state] }, ...(clearOnBack ? { clearOnBack: true } : {}) } },
});

function kitchen(): Doc {
  return {
    manifestVersion: 1,
    kind: 'app',
    key: 'kitchen',
    name: 'Kitchen',
    version: '1.0.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    description: { key: 'd', fallback: 'Orders a kitchen works through.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.3.0' },
    frontends: [{ side: 'staff', kind: 'spa', placement: 'internal' }],
    pages: [{ ref: 'kitchen-orders', template: 'page-crud', title: { key: 'k.orders', fallback: 'Orders' }, nav: { group: 'records', icon: 'list', order: 1 } }],
    requiredSchema: {
      tables: [
        { ref: 'customers', columns: [id, { ref: 'email', type: 'text', maxLength: 254, nullable: true }, text('name')] },
        {
          ref: 'orders',
          columns: [
            id,
            { ref: 'customer_id', type: 'fk', references: 'customers', nullable: true },
            { ref: 'status', type: 'enum', enum: ['placed', 'confirmed', 'preparing', 'ready', 'picked_up'], default: 'placed' },
            stamp('confirmed_by', 'text', 'user-name', 'confirmed'),
            stamp('preparing_at', 'timestamptz', 'now', 'preparing'),
            stamp('ready_at', 'timestamptz', 'now', 'ready', true),
            stamp('ready_by', 'text', 'user-name', 'ready', true),
          ],
          states: {
            column: 'status',
            initial: 'placed',
            moves: {
              placed: ['confirmed'],
              confirmed: ['preparing', { to: 'placed', undo: true }],
              preparing: ['ready', { to: 'confirmed', undo: true }],
              ready: ['picked_up', { to: 'preparing', undo: true, requires: { time: { before: { column: 'ready_at', plus: { minutes: 1 } } } } }],
            },
          },
        },
        {
          ref: 'messages',
          columns: [
            id,
            { ref: 'kind', type: 'enum', enum: ['order-ready'] },
            { ref: 'status', type: 'enum', enum: ['queued', 'sent', 'failed', 'skipped'], default: 'queued' },
            text('to_address', 254),
            { ref: 'order_id', type: 'fk', references: 'orders', nullable: true },
            { ref: 'due', type: 'timestamptz', nullable: true },
            text('skip_reason', 24),
            { ref: 'sent_at', type: 'timestamptz', nullable: true },
            text('error', 200),
          ],
        },
      ],
    },
    outbox: {
      table: 'messages',
      columns: { kind: 'kind', status: 'status', to: 'to_address', due: 'due', sentAt: 'sent_at', error: 'error', skipReason: 'skip_reason' },
      links: { order: 'order_id' },
      recipient: { via: 'order_id', table: 'orders', email: 'customer_id' },
      kinds: { 'order-ready': 'kitchen-ready' },
      producers: [
        {
          kind: 'order-ready',
          link: 'order_id',
          onChange: { table: 'orders', column: 'status', to: 'ready' },
          holdSeconds: 20,
          dropWhen: [{ column: 'status', in: ['placed', 'confirmed', 'preparing'], reason: 'no-longer-needed' }],
        },
      ],
    },
    emailTemplates: [{ key: 'kitchen-ready', name: 'Ready', locales: { 'en-US': { subject: 'Ready', blocks: [{ block: 'email.text', data: { text: 'Ready.' } }] } } }],
  };
}

const orders = (m: Doc) => ((m['requiredSchema'] as { tables: Doc[] }).tables.find((t) => t['ref'] === 'orders') as Doc);
const column = (m: Doc, ref: string) => (orders(m)['columns'] as Doc[]).find((c) => c['ref'] === ref) as Doc;
const moves = (m: Doc) => (orders(m)['states'] as { moves: Record<string, unknown[]> }).moves;
const producer = (m: Doc) => ((m['outbox'] as { producers: Doc[] }).producers[0] as Doc);
const messages = (doc: unknown) => {
  const result = validateManifest(doc);
  return result.ok ? [] : result.issues.map((issue) => issue.message);
};

describe('a move that takes back the one before it', () => {
  it('validates, with its stamps emptied by the undo and a message that waits', () => {
    const recipient = kitchen();
    // A recipient's email column: the orders' own email, not a link.
    (orders(recipient)['columns'] as Doc[]).push({ ref: 'email', type: 'text', maxLength: 254, nullable: true });
    (recipient['outbox'] as Doc)['recipient'] = { via: 'order_id', table: 'orders', email: 'email' };
    expect(messages(recipient)).toEqual([]);
  });

  it('refuses an undo that takes back no listed move, and one a timed move or an effect would make', () => {
    const m = withEmail(kitchen());
    moves(m)['placed'] = ['confirmed', { to: 'ready', undo: true }];
    expect(messages(m)).toContain('no listed move goes from "ready" to "placed", so this move takes nothing back');

    const timed = withEmail(kitchen());
    (orders(timed)['states'] as Doc)['timed'] = [{ from: 'ready', to: 'preparing', at: { column: 'ready_at', plus: { minutes: 5 } } }];
    expect(messages(timed)).toContain('the move from "ready" to "preparing" is an undo, which only a person makes');
  });

  it('refuses a stamp emptied by an undo that no undo leaves, that watches no state, or that cannot be empty', () => {
    const none = withEmail(kitchen());
    Object.assign((column(none, 'confirmed_by')['rules'] as { stamp: Doc }).stamp, { clearOnBack: true });
    moves(none)['confirmed'] = ['preparing'];
    moves(none)['preparing'] = ['ready'];
    expect(messages(none)).toContain('no move marked undo leaves "confirmed", so nothing ever empties it');

    const unwatched = withEmail(kitchen());
    (column(unwatched, 'ready_at')['rules'] as { stamp: Doc }).stamp = { set: 'now', on: 'create', clearOnBack: true };
    expect(messages(unwatched)).toContain("only a stamp written when the state moves is emptied by an undo: watch the table's state column");

    const required = withEmail(kitchen());
    column(required, 'ready_by')['nullable'] = false;
    column(required, 'ready_by')['default'] = 'nobody';
    expect(messages(required)).toContain('"orders.ready_by" is not nullable, so an undo cannot empty it');
  });

  it('refuses a wait with no due column, or beside another way of waiting', () => {
    const noDue = withEmail(kitchen());
    delete ((noDue['outbox'] as Doc)['columns'] as Doc)['due'];
    expect(messages(noDue)).toContain("a message waits in the outbox's due column, and none is named");

    const held = withEmail(kitchen());
    producer(held)['hold'] = true;
    expect(messages(held)).toContain('a message that waits a few seconds takes no hold as well');

    const bounds = withEmail(kitchen());
    producer(bounds)['holdSeconds'] = 0;
    expect(messages(bounds)).not.toEqual([]);
    producer(bounds)['holdSeconds'] = 3601;
    expect(messages(bounds)).not.toEqual([]);

    // Without the wait, the drop has nothing to drop: a message that goes at once.
    const unheld = withEmail(kitchen());
    delete producer(unheld)['holdSeconds'];
    expect(messages(unheld)).toContain('only a message that waits (held, or due later) can be dropped');
  });
});

/** The kitchen with the recipient read from the order's own email column. */
function withEmail(m: Doc): Doc {
  (orders(m)['columns'] as Doc[]).push({ ref: 'email', type: 'text', maxLength: 254, nullable: true });
  (m['outbox'] as Doc)['recipient'] = { via: 'order_id', table: 'orders', email: 'email' };
  return m;
}

/** The kitchen that takes a hand-over back: the way it was paid is emptied with it. */
function handedBack(): Doc {
  const m = withEmail(kitchen());
  (orders(m)['columns'] as Doc[]).push(
    { ref: 'paid_method', type: 'enum', enum: ['cash', 'card'], nullable: true },
    { ref: 'channel', type: 'enum', enum: ['online', 'phone'], default: 'online' },
  );
  moves(m)['picked_up'] = [{ to: 'ready', undo: true, clears: ['paid_method'] }];
  return m;
}

describe('the further columns an undo empties', () => {
  it('validates a take-back that empties how the order was paid', () => {
    expect(messages(handedBack())).toEqual([]);
  });

  it('refuses them on a move not marked undo', () => {
    const m = handedBack();
    moves(m)['ready'] = [{ to: 'picked_up', clears: ['paid_method'] }, { to: 'preparing', undo: true }];
    expect(messages(m)).toContain('only a move marked undo empties columns as it goes');
  });

  it('refuses a column the row lacks, the state, the key, one that cannot be empty, one another rule writes, one named twice', () => {
    const cases: [unknown[], string][] = [
      [['nope'], '"orders" has no column "nope"'],
      [['status'], 'the state moves by the move itself, not by what it empties'],
      [['id'], '"orders.id" is the key, which never changes'],
      [['channel'], '"orders.channel" is not nullable, so an undo cannot empty it'],
      [['ready_at'], '"orders.ready_at" is written by another rule already'],
      [['paid_method', 'paid_method'], '"paid_method" is named twice'],
    ];
    for (const [clears, sentence] of cases) {
      const m = handedBack();
      moves(m)['picked_up'] = [{ to: 'ready', undo: true, clears }];
      expect(messages(m), sentence).toContain(sentence);
    }
    const empty = handedBack();
    moves(empty)['picked_up'] = [{ to: 'ready', undo: true, clears: [] }];
    expect(messages(empty)).not.toEqual([]);
  });
});
