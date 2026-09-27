// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A small guest house, installed for real, for the rules a stay's life needs
 * beyond its moves:
 *
 *  - payments tied to the stay's state apart for a new payment and a change
 *    of one: taken while the stay is booked or in house, voided (or deleted)
 *    while it is booked, in house or cancelled too;
 *  - a guest moved to another room while in house: the old room to cleaning,
 *    the new one to occupied — which only a ready room may be — in the write
 *    that moves them;
 *  - rooms counted by the night (per type, and each room once), with rooms
 *    closed for some nights; a stay whose guest has arrived judged from the
 *    venue's today on;
 *  - the guest's own arrival time on the stay: the moment the house expects
 *    them (a stamp), a check-in allowed from two hours before it, and a no-show
 *    made by the clock six hours after it;
 *  - the settings the house reads, in its one-row settings table.
 */
const id = { ref: 'id', type: 'int', role: 'pk' };
const setting = (column: string) => ({ table: 'settings', column });

export type Doc = Record<string, unknown>;

export function houseTables(): Doc[] {
  const closures = { table: 'room_closures', room: 'room_id', from: 'from_date', to: 'to_date' };
  const counted = { column: 'status', values: ['booked', 'in_house'] };
  const arrived = { states: ['in_house'] };
  return [
    { ref: 'settings', columns: [id, { ref: 'early_hours', type: 'int', default: 2 }, { ref: 'arrive_from', type: 'text', maxLength: 5, default: '15:00' }] },
    { ref: 'room_types', columns: [id, { ref: 'name', type: 'text', maxLength: 40 }] },
    {
      ref: 'rooms',
      columns: [
        id,
        { ref: 'number', type: 'text', maxLength: 10 },
        { ref: 'room_type_id', type: 'fk', references: 'room_types' },
        { ref: 'status', type: 'enum', enum: ['ready', 'occupied', 'cleaning'], default: 'ready' },
      ],
      states: { column: 'status', initial: 'ready', moves: { ready: ['cleaning', 'occupied'], occupied: ['cleaning'], cleaning: ['ready'] } },
    },
    {
      ref: 'room_closures',
      columns: [id, { ref: 'room_id', type: 'fk', references: 'rooms' }, { ref: 'from_date', type: 'date' }, { ref: 'to_date', type: 'date' }],
    },
    {
      ref: 'stays',
      columns: [
        id,
        { ref: 'guest', type: 'text', maxLength: 60 },
        { ref: 'room_type_id', type: 'fk', references: 'room_types' },
        { ref: 'room_id', type: 'fk', references: 'rooms', nullable: true },
        { ref: 'arrive', type: 'date' },
        { ref: 'depart', type: 'date' },
        { ref: 'arrival_time', type: 'text', maxLength: 5, nullable: true },
        {
          ref: 'expected_at',
          type: 'timestamptz',
          nullable: true,
          rules: { stamp: { set: { moment: { column: 'arrive', time: { column: 'arrival_time' }, or: [{ column: 'arrive', time: setting('arrive_from') }] } }, on: { columns: ['arrive', 'arrival_time'] } } },
        },
        { ref: 'status', type: 'enum', enum: ['booked', 'in_house', 'departed', 'cancelled', 'no_show'], default: 'booked' },
      ],
      capacity: [
        {
          kind: 'night',
          from: 'arrive',
          to: 'depart',
          countWhere: counted,
          pool: { via: 'room_type_id', count: { table: 'rooms', column: 'room_type_id', outOfService: closures }, given: { via: 'room_id', column: 'room_type_id' } },
          arrived,
        },
        { kind: 'night', from: 'arrive', to: 'depart', countWhere: counted, pool: { via: 'room_id', size: 1, outOfService: closures }, arrived },
      ],
      states: {
        column: 'status',
        initial: 'booked',
        moves: {
          booked: [
            {
              to: 'in_house',
              requires: { time: { after: { column: 'arrive', time: { column: 'arrival_time' }, minus: { hours: setting('early_hours') }, or: [{ column: 'arrive', time: '00:00' }] } } },
            },
            'cancelled',
            'no_show',
          ],
          in_house: ['departed'],
        },
        children: { payments: { via: 'stay_id', createIn: ['booked', 'in_house'], changeIn: ['booked', 'in_house', 'cancelled'] } },
        timed: [{ from: 'booked', to: 'no_show', at: { column: 'arrive', time: { column: 'arrival_time' }, plus: { hours: 6 } } }],
        effects: [
          { on: { to: 'in_house' }, via: 'room_id', set: { status: 'occupied' } },
          { on: { to: 'departed' }, via: 'room_id', set: { status: 'cleaning' } },
          { on: { change: 'room_id', in: ['in_house'] }, old: { set: { status: 'cleaning' } }, new: { set: { status: 'occupied' } } },
        ],
      },
    },
    {
      ref: 'payments',
      columns: [
        id,
        { ref: 'stay_id', type: 'fk', references: 'stays' },
        { ref: 'amount', type: 'decimal', scale: 2, default: 0 },
        { ref: 'voided', type: 'bool', default: false },
      ],
    },
  ];
}

export function houseManifest(tables: Doc[] = houseTables()): Doc {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'house',
    name: 'House',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    description: { key: 'house.description', fallback: 'A guest house' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: '0.3.1' },
    requiredSchema: { prefixed: true, tables },
    pages: [{ ref: 'overview', template: 'page-dashboard', title: { key: 't', fallback: 'Overview' }, nav: { group: 'house', icon: 'home', order: 1 } }],
    frontends: [{ side: 'staff', kind: 'spa' }],
  };
}
