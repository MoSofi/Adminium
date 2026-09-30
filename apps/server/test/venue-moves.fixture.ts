// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A small venue app whose moves wait for things, installed for real: tickets
 * let in once, only for a paid order, from half an hour before the doors and
 * before the ticket's day ends, while door scanning is switched on; a
 * check-in recorded per ticket per day, only for a valid ticket on its day;
 * orders held for ten minutes and released by the clock; stays whose
 * check-in needs a ready room and turns it occupied, whose check-out turns it
 * to cleaning, whose late cancellation is flagged; pickups not collected by
 * closing; waitlist offers that lapse.
 *
 * `timed: false` leaves the timed moves out, for the tests of moves made by a
 * writer only.
 */
const id = { ref: 'id', type: 'int', role: 'pk' };
const setting = (column: string) => ({ table: 'settings', column });

export type Doc = Record<string, unknown>;

export interface VenueOptions {
  timed?: boolean;
  /** An outbox telling a buyer their held tickets went back on sale. */
  outbox?: boolean;
  /** An order's cancel code kept unique, so a timed move writing it can meet the database's refusal. */
  uniqueCode?: boolean;
}

export function venueTables(opts: VenueOptions = {}): Doc[] {
  const timed = opts.timed !== false;
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
        { ref: 'offer_hours', type: 'int', default: 12 },
        { ref: 'grace_hours', type: 'int', default: 24 },
        { ref: 'reminder_hours', type: 'int', default: 24 },
        { ref: 'arrive_from', type: 'text', maxLength: 5, default: '15:00' },
        { ref: 'no_show_at', type: 'text', maxLength: 5, default: '10:00' },
        { ref: 'transfer_time', type: 'text', maxLength: 5, default: '18:00' },
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
        { ref: 'lead_hours', type: 'int', nullable: true },
      ],
    },
    {
      ref: 'orders',
      columns: [
        id,
        { ref: 'event_id', type: 'fk', references: 'events' },
        { ref: 'email', type: 'text', maxLength: 200 },
        { ref: 'account', type: 'int', nullable: true },
        { ref: 'pay', type: 'enum', enum: ['paid', 'door', 'none', 'transfer'], default: 'none' },
        { ref: 'status', type: 'enum', enum: ['held', 'awaiting_transfer', 'overdue', 'paid', 'expired', 'released', 'cancelled'], default: 'held' },
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
        { ref: 'cancel_code', type: 'text', maxLength: 20, nullable: true, ...(opts.uniqueCode === true ? { unique: true } : {}) },
        { ref: 'show_at', type: 'timestamptz', nullable: true },
      ],
      states: {
        column: 'status',
        initial: 'held',
        moves: {
          held: ['awaiting_transfer', 'paid', 'expired', 'cancelled'],
          awaiting_transfer: ['paid', 'overdue', 'released'],
          overdue: ['paid', 'released'],
          paid: ['cancelled'],
        },
        ...(timed
          ? {
              timed: [
                { from: 'held', to: 'expired', at: { column: 'held_until' } },
                { from: 'awaiting_transfer', to: 'overdue', at: { column: 'pay_by' } },
                { from: 'overdue', to: 'released', at: { column: 'pay_by', plus: { hours: setting('grace_hours') } }, set: { cancel_code: 'unpaid' } },
              ],
            }
          : {}),
      },
    },
    {
      ref: 'tickets',
      columns: [
        id,
        { ref: 'order_id', type: 'fk', references: 'orders' },
        { ref: 'event_id', type: 'fk', references: 'events' },
        { ref: 'status', type: 'enum', enum: ['valid', 'checked_in', 'refund_asked'], default: 'valid' },
        { ref: 'valid_from', type: 'timestamptz' },
        { ref: 'valid_to', type: 'timestamptz' },
        { ref: 'door', type: 'text', maxLength: 40, nullable: true },
        { ref: 'holder_email', type: 'text', maxLength: 200, nullable: true, rules: { personal: true } },
        { ref: 'checked_in_at', type: 'timestamptz', nullable: true, rules: { stamp: { set: 'now', on: { column: 'status', values: ['checked_in'] } } } },
        { ref: 'checked_in_by', type: 'text', maxLength: 120, nullable: true, rules: { personal: false, stamp: { set: 'user-name', on: { column: 'status', values: ['checked_in'] } } } },
        { ref: 'asked_at', type: 'timestamptz', nullable: true, rules: { stamp: { set: 'now', on: { column: 'status', values: ['refund_asked'] } } } },
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
      ref: 'check_ins',
      columns: [
        id,
        { ref: 'ticket_id', type: 'fk', references: 'tickets' },
        { ref: 'day', type: 'date' },
        { ref: 'status', type: 'enum', enum: ['in'], default: 'in' },
      ],
      states: {
        column: 'status',
        initial: 'in',
        moves: {},
        create: {
          requires: {
            linked: [{ via: 'ticket_id', where: [{ column: 'status', eq: 'valid' }] }],
            time: { after: { via: 'ticket_id', column: 'valid_from' }, before: { via: 'ticket_id', column: 'valid_to' } },
            setting: [{ table: 'settings', column: 'door_on', eq: true }],
          },
        },
      },
    },
    {
      ref: 'rooms',
      columns: [id, { ref: 'number', type: 'text', maxLength: 8 }, { ref: 'status', type: 'enum', enum: ['ready', 'occupied', 'cleaning'], default: 'ready' }],
      states: { column: 'status', initial: 'ready', moves: { ready: ['occupied'], occupied: ['cleaning'], cleaning: ['ready'] } },
    },
    {
      ref: 'stays',
      columns: [
        id,
        { ref: 'room_id', type: 'fk', references: 'rooms', nullable: true },
        // A stay sold with a show (a festival's package): the show's form lists them.
        { ref: 'event_id', type: 'fk', references: 'events', nullable: true },
        { ref: 'arrive', type: 'date' },
        { ref: 'arrival_time', type: 'text', maxLength: 5, nullable: true },
        { ref: 'depart', type: 'date', nullable: true },
        { ref: 'status', type: 'enum', enum: ['booked', 'in_house', 'departed', 'cancelled', 'no_show'], default: 'booked' },
        { ref: 'late_cancel', type: 'bool', default: false },
        // Who cancelled: a cancellation by the house is never late.
        { ref: 'cancel_code', type: 'enum', enum: ['guest', 'no_card', 'house'], default: 'guest' },
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
            where: [{ column: 'cancel_code', in: ['guest', 'no_card'] }],
          },
        ],
        // A stay in the house leaves no earlier by a change of its date; a booked one may.
        onlyLater: [{ column: 'depart', in: ['in_house'] }],
        ...(timed ? { timed: [{ from: 'booked', to: 'no_show', at: { column: 'arrive', plus: { days: 1 }, time: setting('no_show_at') } }] } : {}),
        effects: [
          { on: { to: 'in_house' }, via: 'room_id', set: { status: 'occupied' } },
          { on: { to: 'departed' }, via: 'room_id', set: { status: 'cleaning' } },
        ],
      },
    },
    {
      ref: 'bookings',
      columns: [
        id,
        { ref: 'arrive', type: 'date' },
        { ref: 'status', type: 'enum', enum: ['booked', 'cancelled'], default: 'booked' },
        { ref: 'email', type: 'text', maxLength: 200 },
      ],
      states: {
        column: 'status',
        initial: 'booked',
        moves: { booked: ['cancelled'] },
        late: [
          {
            to: 'cancelled',
            moment: { column: 'arrive', time: setting('arrive_from') },
            within: { hours: setting('cancel_hours') },
            mode: 'refuse',
          },
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
        moves: { ready: ['collected', { to: 'not_collected', roles: ['manager'] }] },
        ...(timed
          ? {
              timed: [
                {
                  from: 'ready',
                  to: 'not_collected',
                  at: { column: 'pickup_at', time: { hours: { table: 'hours', weekday: 'weekday', open: 'open', opens: 'opens', closes: 'closes' }, edge: 'closes' } },
                },
              ],
            }
          : {}),
      },
    },
    {
      ref: 'waitlist',
      columns: [
        id,
        { ref: 'event_id', type: 'fk', references: 'events' },
        { ref: 'email', type: 'text', maxLength: 200 },
        { ref: 'status', type: 'enum', enum: ['waiting', 'offered', 'claimed', 'missed'], default: 'waiting' },
        { ref: 'offered_until', type: 'timestamptz', nullable: true, rules: { stamp: { set: { addMinutes: { hours: setting('offer_hours') } }, on: { column: 'status', values: ['offered'] } } } },
        { ref: 'blocked', type: 'bool', default: false },
      ],
      states: {
        column: 'status',
        initial: 'waiting',
        moves: { waiting: ['offered'], offered: ['claimed', { to: 'missed', requires: { where: [{ column: 'blocked', eq: false }] } }] },
        ...(timed ? { timed: [{ from: 'offered', to: 'missed', at: { column: 'offered_until' } }] } : {}),
      },
    },
    ...(opts.outbox === true
      ? [
          {
            ref: 'messages',
            columns: [
              id,
              { ref: 'kind', type: 'enum', enum: ['released', 'reminder', 'soon'] },
              { ref: 'due_at', type: 'timestamptz', nullable: true },
              { ref: 'status', type: 'enum', enum: ['queued', 'held', 'sent', 'failed', 'skipped'], default: 'queued' },
              { ref: 'order_id', type: 'fk', references: 'orders', nullable: true },
              { ref: 'to_address', type: 'text', maxLength: 254, nullable: true },
              { ref: 'sent_at', type: 'timestamptz', nullable: true },
              { ref: 'error', type: 'text', maxLength: 400, nullable: true },
            ],
          },
        ]
      : []),
  ];
}

export function venueManifest(opts: VenueOptions = {}): Doc {
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
    roles: [{ key: 'manager', name: 'Manager', permissions: ['app:@:staff'] }],
    requiredSchema: { prefixed: true, tables: venueTables(opts) },
    pages: [{ ref: 'overview', template: 'page-dashboard', title: { key: 't', fallback: 'Overview' }, nav: { group: 'venue', icon: 'home', order: 1 } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
    ...(opts.outbox === true
      ? {
          outbox: {
            table: 'messages',
            columns: { kind: 'kind', status: 'status', to: 'to_address', due: 'due_at', sentAt: 'sent_at', error: 'error' },
            recipient: { via: 'order_id', table: 'orders', email: 'email' },
            links: { order: 'order_id' },
            kinds: { released: 'venue-released', reminder: 'venue-released', soon: 'venue-released' },
            producers: [
              { kind: 'released', link: 'order_id', onChange: { table: 'orders', column: 'status', to: 'released' } },
              // The day before, at 09:00 on the venue's clock.
              {
                kind: 'reminder',
                link: 'order_id',
                before: { table: 'orders', at: 'show_at', lead: { via: 'event_id', table: 'events', column: 'lead_hours', fallback: setting('reminder_hours'), max: 48, at: '09:00' } },
              },
              // Three hours before, to the hour.
              { kind: 'soon', link: 'order_id', before: { table: 'orders', at: 'show_at', lead: { via: 'event_id', table: 'events', column: 'lead_hours', fallback: setting('reminder_hours'), max: 3 } } },
            ],
          },
          emailTemplates: [
            {
              key: 'venue-released',
              name: 'Released',
              locales: { 'en-US': { subject: 'Your tickets went back on sale', blocks: [{ block: 'email.text', data: { text: 'The transfer did not arrive in time.' } }] } },
            },
          ],
        }
      : {}),
  };
}
