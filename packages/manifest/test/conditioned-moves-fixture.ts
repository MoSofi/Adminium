// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A small venue app whose moves wait for things: tickets let in once, only
 * for a paid order and inside the doors' hours; orders held for ten minutes
 * and moved on by the clock; stays whose check-in turns the room occupied.
 * Shared by the tests of moments, conditioned moves, timed moves, deadline
 * stamps and windows. Each test breaks one thing.
 */
import { validateManifest } from '../src/index.js';

export type Doc = Record<string, unknown>;

const id = { ref: 'id', type: 'int', role: 'pk' };
const setting = (column: string) => ({ table: 'settings', column });

function tables(): Doc[] {
  return [
    {
      ref: 'settings',
      columns: [
        id,
        { ref: 'refund_days', type: 'int', default: 7 },
        { ref: 'cancel_hours', type: 'int', default: 48 },
        { ref: 'hold_minutes', type: 'int', default: 10 },
        { ref: 'transfer_days', type: 'int', default: 5 },
        { ref: 'cutoff_days', type: 'int', default: 3 },
        { ref: 'arrive_from', type: 'text', maxLength: 5, default: '15:00' },
        { ref: 'no_show_at', type: 'text', maxLength: 5, default: '10:00' },
        { ref: 'transfer_time', type: 'text', maxLength: 5, default: '18:00' },
        { ref: 'short_time', type: 'text', maxLength: 3, nullable: true },
        { ref: 'door_on', type: 'bool', default: true },
      ],
    },
    {
      ref: 'hours',
      columns: [
        id,
        { ref: 'weekday', type: 'enum', enum: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] },
        { ref: 'open', type: 'bool', default: true },
        { ref: 'opens', type: 'text', maxLength: 5, nullable: true },
        { ref: 'closes', type: 'text', maxLength: 5, nullable: true },
      ],
    },
    {
      ref: 'events',
      columns: [
        id,
        { ref: 'name', type: 'text', maxLength: 120 },
        { ref: 'starts_at', type: 'timestamptz' },
        { ref: 'doors_at', type: 'timestamptz' },
        { ref: 'refund_until', type: 'timestamptz', nullable: true },
        { ref: 'refunds_on', type: 'bool', default: true },
      ],
    },
    {
      ref: 'orders',
      columns: [
        id,
        { ref: 'event_id', type: 'fk', references: 'events' },
        { ref: 'email', type: 'text', maxLength: 200 },
        { ref: 'pay', type: 'enum', enum: ['paid', 'door', 'none', 'transfer'], default: 'none' },
        { ref: 'status', type: 'enum', enum: ['held', 'awaiting_transfer', 'paid', 'expired', 'released', 'cancelled'], default: 'held' },
        { ref: 'held_until', type: 'timestamptz', nullable: true, rules: { stamp: { set: { addMinutes: { minutes: setting('hold_minutes') } }, on: 'create' } } },
        {
          ref: 'pay_by',
          type: 'timestamptz',
          nullable: true,
          rules: {
            stamp: {
              set: {
                deadline: {
                  days: setting('transfer_days'),
                  time: setting('transfer_time'),
                  notAfter: { via: 'event_id', column: 'starts_at', minus: { days: setting('cutoff_days') } },
                },
              },
              on: { column: 'status', values: ['awaiting_transfer'] },
            },
          },
        },
      ],
      states: {
        column: 'status',
        initial: 'held',
        moves: { held: ['awaiting_transfer', 'paid', 'expired'], awaiting_transfer: ['paid', 'released'], paid: ['cancelled'] },
        timed: [
          { from: 'held', to: 'expired', at: { column: 'held_until' } },
          { from: 'awaiting_transfer', to: 'released', at: { column: 'pay_by', plus: { hours: 24 } } },
        ],
      },
    },
    {
      ref: 'tickets',
      columns: [
        id,
        { ref: 'order_id', type: 'fk', references: 'orders' },
        { ref: 'event_id', type: 'fk', references: 'events' },
        { ref: 'status', type: 'enum', enum: ['valid', 'checked_in', 'refund_asked'], default: 'valid' },
        { ref: 'valid_to', type: 'timestamptz' },
        { ref: 'door', type: 'text', maxLength: 40, nullable: true },
        { ref: 'holder_email', type: 'text', maxLength: 200, nullable: true, rules: { personal: true } },
        { ref: 'checked_in_at', type: 'timestamptz', nullable: true, rules: { stamp: { set: 'now', on: { column: 'status', values: ['checked_in'] } } } },
      ],
      states: {
        column: 'status',
        initial: 'valid',
        strict: { show: ['door'] },
        moves: {
          valid: [
            {
              to: 'checked_in',
              requires: {
                linked: [{ via: 'order_id', where: [{ column: 'pay', in: ['paid', 'door', 'none'] }] }],
                time: { after: { via: 'event_id', column: 'doors_at', minus: { minutes: 30 } }, before: { column: 'valid_to' } },
                setting: [{ table: 'settings', column: 'door_on', eq: true }],
              },
            },
            'refund_asked',
          ],
        },
      },
    },
    {
      ref: 'rooms',
      columns: [id, { ref: 'status', type: 'enum', enum: ['ready', 'occupied', 'cleaning'], default: 'ready' }],
      states: { column: 'status', initial: 'ready', moves: { ready: ['occupied'], occupied: ['cleaning'], cleaning: ['ready'] } },
    },
    {
      ref: 'stays',
      columns: [
        id,
        { ref: 'room_id', type: 'fk', references: 'rooms', nullable: true },
        { ref: 'arrive', type: 'date' },
        { ref: 'status', type: 'enum', enum: ['booked', 'in_house', 'departed', 'cancelled', 'no_show'], default: 'booked' },
        { ref: 'late_cancel', type: 'bool', default: false },
        {
          ref: 'cancel_by',
          type: 'timestamptz',
          nullable: true,
          rules: { stamp: { set: { moment: { column: 'arrive', time: setting('arrive_from'), minus: { hours: setting('cancel_hours') } } }, on: { columns: ['arrive'] } } },
        },
      ],
      states: {
        column: 'status',
        initial: 'booked',
        moves: {
          booked: [{ to: 'in_house', requires: { linked: [{ via: 'room_id', where: [{ column: 'status', eq: 'ready' }] }] } }, 'cancelled', 'no_show'],
          in_house: ['departed'],
        },
        late: [
          {
            to: 'cancelled',
            from: ['booked'],
            moment: { column: 'arrive', time: setting('arrive_from') },
            within: { hours: setting('cancel_hours') },
            mode: 'flag',
            flag: 'late_cancel',
          },
        ],
        timed: [{ from: 'booked', to: 'no_show', at: { column: 'arrive', plus: { days: 1 }, time: setting('no_show_at') } }],
        effects: [
          { on: { to: 'in_house' }, via: 'room_id', set: { status: 'occupied' } },
          { on: { to: 'departed' }, via: 'room_id', set: { status: 'cleaning' } },
        ],
      },
    },
    {
      ref: 'pickups',
      columns: [
        id,
        { ref: 'pickup_at', type: 'timestamptz' },
        { ref: 'status', type: 'enum', enum: ['ready', 'collected', 'not_collected'], default: 'ready' },
      ],
      states: {
        column: 'status',
        initial: 'ready',
        moves: { ready: ['collected', 'not_collected'] },
        timed: [
          {
            from: 'ready',
            to: 'not_collected',
            at: { column: 'pickup_at', time: { hours: { table: 'hours', weekday: 'weekday', open: 'open', opens: 'opens', closes: 'closes' }, edge: 'closes' } },
          },
        ],
      },
    },
  ];
}

export function venue(): Doc {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'venue',
    name: 'Venue',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    description: { key: 'venue.description', fallback: 'A venue' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: '0.3.1' },
    requiredSchema: { prefixed: true, tables: tables() },
    pages: [{ ref: 'overview', template: 'page-dashboard', title: { key: 't', fallback: 'Overview' }, nav: { group: 'venue', icon: 'home', order: 1 } }],
    frontends: [{ side: 'staff', kind: 'spa' }, { side: 'customer', kind: 'spa' }],
    publicAccess: [
      {
        table: 'orders',
        methods: ['GET', 'PATCH'],
        select: ['status', 'event_id'],
        claim: { verify: 'email-link', email: 'email' },
        humanCheck: true,
        writable: ['status'],
        writableValues: { status: ['cancelled'] },
        writableWhen: {
          status: ['paid'],
          event_id: {
            before: { column: 'refund_until', or: [{ via: 'event_id', column: 'starts_at', minus: { days: setting('refund_days') } }] },
            where: [{ column: 'refunds_on', eq: true }],
          },
        },
      },
    ],
  };
}

export const tableOf = (m: Doc, ref: string) => ((m['requiredSchema'] as { tables: Doc[] }).tables).find((t) => t['ref'] === ref)!;
export const statesOf = (m: Doc, ref: string) => tableOf(m, ref)['states'] as Doc;
export const columnOf = (m: Doc, table: string, ref: string) => (tableOf(m, table)['columns'] as Doc[]).find((c) => c['ref'] === ref)!;
export const entryOf = (m: Doc) => (m['publicAccess'] as Doc[])[0]!;
/** The one move of `from` to `to`, written as an object. */
export const moveOf = (m: Doc, table: string, from: string, to: string) =>
  ((statesOf(m, table)['moves'] as Record<string, unknown[]>)[from]!).find((move) => typeof move === 'object' && (move as Doc)['to'] === to) as Doc;

export function issuesText(m: Doc): string {
  const result = validateManifest(m);
  return result.ok ? '' : result.issues.map((i) => `${i.path}: ${i.message}`).join('\n');
}
