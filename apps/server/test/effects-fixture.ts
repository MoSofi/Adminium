// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Two box offices whose moves move a row of another table (`states.effects`)
 * that a limit or a total reads: door sales, where a ticket collected pays its
 * order (the order owns the tickets its state counts, keeps their total, and
 * climbs into what its event took in); and a waitlist, whose entry follows
 * the order made for its offer (the entry owns the orders held until its
 * offer ends; its list counts the entries that claimed).
 */
type Doc = Record<string, unknown>;
const id = { ref: 'id', type: 'int', role: 'pk' };
const money = (ref: string, rules?: Doc) => ({ ref, type: 'decimal', scale: 2, nullable: true, ...(rules === undefined ? {} : { rules }) });
const setting = (column: string) => ({ table: 'settings', column });
const settings = { ref: 'settings', columns: [id, { ref: 'hold_minutes', type: 'int', default: 10 }, { ref: 'offer_minutes', type: 'int', default: 720 }] };
/** A hold's end, as Adminium stamps it: minutes from when the row is made (or moved to `on`). */
const until = (ref: string, minutes: string, on: unknown = 'create') => ({ ref, type: 'timestamptz', nullable: true, rules: { stamp: { set: { addMinutes: { minutes: setting(minutes) } }, on } } });

function app(key: string, tables: Doc[]): Doc {
  return {
    kind: 'app',
    manifestVersion: 1,
    key,
    name: key,
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    description: { key: 'd', fallback: 'A box office' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: '0.3.1' },
    requiredSchema: { prefixed: true, tables },
    pages: [{ ref: 'overview', template: 'page-dashboard', title: { key: 't', fallback: 'Overview' }, nav: { group: key, icon: 'home', order: 1 } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  };
}

/** Door sales: a ticket collected pays its order; the event adds up what its paid orders came to. */
export function door(): Doc {
  return app('door', [
    settings,
    { ref: 'events', columns: [id, { ref: 'name', type: 'text', maxLength: 40 }, money('paid_total', { rollup: { from: 'orders', via: 'event_id', sum: 'total', where: { column: 'status', eq: 'paid' } } })] },
    { ref: 'ticket_types', columns: [id, { ref: 'event_id', type: 'fk', references: 'events' }, { ref: 'capacity', type: 'int', nullable: true }] },
    {
      ref: 'orders',
      columns: [
        id,
        { ref: 'event_id', type: 'fk', references: 'events' },
        { ref: 'status', type: 'enum', enum: ['held', 'door', 'paid', 'expired'], default: 'held' },
        until('held_until', 'hold_minutes'),
        money('total', { rollup: { from: 'tickets', via: 'order_id', sum: 'price' } }),
      ],
      states: { column: 'status', initial: 'held', moves: { held: ['door', 'paid', 'expired'], door: ['paid'] } },
    },
    {
      ref: 'tickets',
      columns: [
        id,
        { ref: 'order_id', type: 'fk', references: 'orders' },
        { ref: 'ticket_type_id', type: 'fk', references: 'ticket_types' },
        { ref: 'price', type: 'decimal', scale: 2, default: 0 },
        { ref: 'status', type: 'enum', enum: ['valid', 'collected'], default: 'valid' },
      ],
      capacity: {
        kind: 'parent',
        via: 'ticket_type_id',
        size: { column: 'capacity' },
        countWhere: [
          { column: 'status', values: ['valid', 'collected'] },
          { via: 'order_id', column: 'status', values: ['held', 'door', 'paid'] },
        ],
        hold: { via: 'order_id', states: ['held'], column: 'held_until' },
      },
      states: { column: 'status', initial: 'valid', moves: { valid: ['collected'] }, effects: [{ on: { to: 'collected' }, via: 'order_id', set: { status: 'paid' } }] },
    },
  ]);
}

/** A waitlist: an entry offered places follows the order made for the offer. */
export function waitlist(): Doc {
  return app('wait', [
    settings,
    // How many of a list's entries claimed their places: a total the entry's move climbs into.
    { ref: 'lists', columns: [id, { ref: 'name', type: 'text', maxLength: 40 }, { ref: 'claimed', type: 'int', nullable: true, rules: { rollup: { from: 'waitlist', via: 'list_id', count: true, where: { column: 'status', eq: 'claimed' } } } }] },
    {
      ref: 'waitlist',
      columns: [
        id,
        { ref: 'list_id', type: 'fk', references: 'lists', nullable: true },
        { ref: 'email', type: 'text', maxLength: 80 },
        until('offered_until', 'offer_minutes', { column: 'status', values: ['offered'] }),
        { ref: 'status', type: 'enum', enum: ['waiting', 'offered', 'claimed', 'missed'], default: 'waiting' },
      ],
      states: { column: 'status', initial: 'waiting', moves: { waiting: ['offered'], offered: ['claimed', 'missed'] } },
    },
    { ref: 'ticket_types', columns: [id, { ref: 'capacity', type: 'int', nullable: true }] },
    {
      ref: 'orders',
      columns: [
        id,
        { ref: 'status', type: 'enum', enum: ['held', 'offered', 'paid', 'expired'], default: 'held' },
        until('held_until', 'hold_minutes'),
        { ref: 'waitlist_id', type: 'fk', references: 'waitlist', nullable: true },
      ],
      states: {
        column: 'status',
        initial: 'held',
        moves: { held: ['offered', 'paid', 'expired'], offered: ['paid', 'expired'] },
        effects: [
          { on: { to: 'paid' }, via: 'waitlist_id', set: { status: 'claimed' } },
          { on: { to: 'expired' }, via: 'waitlist_id', set: { status: 'missed' } },
        ],
      },
    },
    {
      ref: 'tickets',
      columns: [id, { ref: 'order_id', type: 'fk', references: 'orders' }, { ref: 'ticket_type_id', type: 'fk', references: 'ticket_types' }],
      capacity: {
        kind: 'parent',
        via: 'ticket_type_id',
        size: { column: 'capacity' },
        countWhere: { via: 'order_id', column: 'status', values: ['held', 'offered', 'paid'] },
        hold: { via: 'order_id', states: ['held', 'offered'], column: { column: 'offered_until', via: 'waitlist_id', or: [{ column: 'held_until' }] } },
      },
    },
  ]);
}

export const T0 = new Date('2026-07-28T09:00:00Z');
export const later = (minutes: number) => new Date(T0.getTime() + minutes * 60_000).toISOString();

