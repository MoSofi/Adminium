// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A guest house's app, using the vocabulary for a create with its child rows,
 * a person found by address, the row's own link, a read for a signed-in guest
 * alone, a price by the night, copies that follow, a count, days between
 * dates and a joined name: the manifest the round-trip tests install.
 */
import { invoicingManifest } from './invoicing-install.helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength = 120, more: Record<string, unknown> = {}) => ({ ref, type: 'text', maxLength, ...more });
const money = (ref: string, rules?: Record<string, unknown>) => ({ ref, type: 'decimal', scale: 2, nullable: true, ...(rules === undefined ? {} : { rules }) });

export const PER_NIGHT = {
  from: 'arrive',
  to: 'depart',
  rate: { via: 'room_type_id', column: 'base_rate' },
  adjust: {
    table: 'rate_rules',
    match: { via: 'room_type_id', weekdays: 'weekdays', from: 'from_date', to: 'to_date' },
    add: 'amount',
    name: 'name',
    where: { column: 'active', eq: true },
  },
};

export const EXTRAS_CHILD = {
  via: 'stay_id',
  writable: ['extra_id', 'note'],
  select: ['id', 'amount'],
  position: 'position',
  min: 0,
  max: 10,
  plainText: ['note'],
  agrees: [{ column: 'extra_id', when: { in: [1, 2] }, eq: { via: 'extra_id', column: 'id' } }],
  counts: [{ by: ['extra_id', 'group_id'], every: { column: 'room_type_id', eq: { parent: 'room_type_id' } }, min: 'min', max: 'max' }],
  sumMax: { column: 'amount', max: { table: 'settings', column: 'max_items' } },
  children: { stay_extra_notes: { via: 'stay_extra_id', writable: ['text'], max: 3, plainText: ['text'] } },
};

function tables(): Record<string, unknown>[] {
  return [
    { ref: 'settings', columns: [id, { ref: 'max_items', type: 'int', default: 12 }, text('bank_name', 80, { nullable: true })] },
    {
      ref: 'customers',
      columns: [
        id,
        text('email', 254, { nullable: true, unique: true, rules: { normalize: 'email', validation: { format: 'email' } } }),
        text('name', 120, { nullable: true }),
        text('phone', 32, { nullable: true }),
        { ref: 'forgotten_at', type: 'timestamptz', nullable: true },
      ],
    },
    { ref: 'room_types', columns: [id, text('name'), { ref: 'base_rate', type: 'decimal', scale: 2, default: 0 }, { ref: 'sleeps', type: 'int', default: 2 }] },
    {
      ref: 'rate_rules',
      columns: [
        id,
        { ref: 'room_type_id', type: 'fk', references: 'room_types', nullable: true },
        text('weekdays', 32, { nullable: true }),
        { ref: 'from_date', type: 'date', nullable: true },
        { ref: 'to_date', type: 'date', nullable: true },
        { ref: 'amount', type: 'decimal', scale: 2, default: 0 },
        text('name', 40),
        { ref: 'active', type: 'bool', default: true },
      ],
    },
    { ref: 'extra_groups', columns: [id, { ref: 'room_type_id', type: 'fk', references: 'room_types', nullable: true }, { ref: 'min', type: 'int', default: 0 }, { ref: 'max', type: 'int', nullable: true }] },
    { ref: 'extras', columns: [id, { ref: 'group_id', type: 'fk', references: 'extra_groups', nullable: true }, text('name'), { ref: 'each', type: 'decimal', scale: 2, default: 0 }] },
    {
      ref: 'stays',
      columns: [
        id,
        { ref: 'customer_id', type: 'fk', references: 'customers', nullable: true },
        text('email', 254, { rules: { validation: { format: 'email' } } }),
        text('first_name', 60),
        text('last_name', 60),
        text('ref_prefix', 8, { nullable: true }),
        text('ref_code', 8, { nullable: true }),
        text('reference', 17, { nullable: true, rules: { formula: { join: ['ref_prefix', '-', 'ref_code'] } } }),
        { ref: 'room_type_id', type: 'fk', references: 'room_types' },
        { ref: 'arrive', type: 'date' },
        { ref: 'depart', type: 'date' },
        { ref: 'guests', type: 'int', default: 1, rules: { validation: { min: 1, max: 6 } } },
        text('note', 500, { nullable: true }),
        text('client_key', 64, { nullable: true, unique: true }),
        { ref: 'link_token', type: 'text', maxLength: 16, nullable: true, rules: { code: { length: 16 } } },
        { ref: 'link_stopped', type: 'bool', default: false },
        { ref: 'nights', type: 'int', nullable: true, rules: { formula: { daysBetween: ['arrive', 'depart'] } } },
        money('room_total', { perNight: PER_NIGHT }),
        money('extras_total', { rollup: { from: 'stay_extras', via: 'stay_id', sum: 'amount', where: { column: 'removed', eq: false } } }),
        { ref: 'extra_count', type: 'int', nullable: true, rules: { rollup: { from: 'stay_extras', via: 'stay_id', count: true } } },
        money('total', { formula: { add: [{ coalesce: ['room_total', 0] }, { coalesce: ['extras_total', 0] }] } }),
      ],
    },
    {
      ref: 'stay_extras',
      columns: [
        id,
        { ref: 'stay_id', type: 'fk', references: 'stays' },
        { ref: 'extra_id', type: 'fk', references: 'extras' },
        text('note', 200, { nullable: true }),
        { ref: 'position', type: 'int', nullable: true },
        money('each', { copy: { via: 'extra_id', from: 'each' } }),
        { ref: 'nights', type: 'int', nullable: true, rules: { copy: { via: 'stay_id', from: 'nights', mode: 'always', follow: true } } },
        { ref: 'guests', type: 'int', nullable: true, rules: { copy: { via: 'stay_id', from: 'guests', mode: 'always', follow: true } } },
        money('amount', { formula: { mul: ['each', 'nights', 'guests'] } }),
        { ref: 'removed', type: 'bool', default: false },
      ],
    },
    { ref: 'stay_extra_notes', columns: [id, { ref: 'stay_extra_id', type: 'fk', references: 'stay_extras' }, text('text', 200)] },
  ];
}

export const STAY_SELECT = ['id', 'nights', 'room_total', 'extras_total', 'total'];

export function lodgeManifest(): Record<string, unknown> {
  const manifest = invoicingManifest(tables());
  (manifest['pages'] as { bindings: Record<string, string> }[])[0]!.bindings = { rows: 'stays' };
  manifest['frontends'] = [
    { side: 'staff', kind: 'spa', entry: 'index.html' },
    { side: 'customer', kind: 'spa', entry: 'index.html' },
  ];
  manifest['publicKeys'] = { link: {} };
  manifest['publicAccess'] = [
    {
      table: 'customers',
      methods: ['GET', 'PATCH'],
      select: ['name', 'email'],
      writable: ['name'],
      claim: { verify: 'email-link', email: 'email' },
      humanCheck: true,
      forget: { columns: ['email', 'name', 'phone'], stamp: 'forgotten_at' },
    },
    { table: 'stays', methods: ['GET'], level: 'verified', claimedBy: { table: 'customers', column: 'customer_id' }, select: STAY_SELECT },
    {
      table: 'stays',
      methods: ['POST'],
      humanCheck: true,
      level: 'verified',
      select: STAY_SELECT,
      writable: ['email', 'first_name', 'last_name', 'room_type_id', 'arrive', 'depart', 'guests', 'note', 'client_key'],
      requires: ['email', 'first_name', 'last_name'],
      claimedBy: { table: 'customers', column: 'customer_id', optional: true },
      identity: { table: 'customers', email: 'email', link: 'customer_id', fill: { name: 'last_name' } },
      shareLink: 'link_token',
      anonymous: { perValue: { columns: ['email'], n: 5 } },
      agrees: [{ column: 'guests', lte: { via: 'room_type_id', column: 'sleeps' } }],
      children: { stay_extras: EXTRAS_CHILD },
      dryRun: true,
      expect: 'total',
      clientKey: 'client_key',
    },
    {
      table: 'stays',
      key: 'link',
      methods: ['GET', 'PATCH'],
      select: ['id', 'arrive', 'depart', 'total'],
      writable: ['arrive', 'depart', 'note'],
      claim: { by: 'token', column: 'link_token', stopped: 'link_stopped', own: true },
      dryRun: true,
      expect: 'total',
    },
    { table: 'stay_extras', key: 'link', methods: ['GET'], level: 'verified', visibleWith: { table: 'stays', via: 'stay_id' }, select: ['id', 'amount'] },
    { table: 'room_types', methods: ['GET'], select: ['id', 'name', 'base_rate', 'sleeps'] },
    { table: 'extras', methods: ['GET'], select: ['id', 'name', 'each'] },
    { table: 'settings', methods: ['GET'], level: 'verified', select: ['bank_name'] },
  ];
  return manifest;
}
