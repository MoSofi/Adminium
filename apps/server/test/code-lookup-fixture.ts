// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A box office whose guests type codes: a discount off the order (a share,
 * or an amount off one type of ticket), a code with so many uses, and a
 * presale code that shows a ticket type nobody else sees. Installed by the
 * real installer, on every engine this run can reach.
 */
import { installInvoicing, invoicingManifest, type Dialect, type InvoicingHarness } from './invoicing-install.helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength = 120, more: Record<string, unknown> = {}) => ({ ref, type: 'text', maxLength, nullable: true, ...more });
const money = (ref: string, rules?: Record<string, unknown>) => ({ ref, type: 'decimal', scale: 2, nullable: true, ...(rules === undefined ? {} : { rules }) });
const fk = (ref: string, references: string, more: Record<string, unknown> = {}) => ({ ref, type: 'fk', references, ...more });

/** A code is good while it is on and not past its day; an empty day is no end. */
const GOOD = [
  { column: 'active', eq: true },
  { column: 'valid_until', notBefore: 'now', orEmpty: true },
];

export const LOOKUP = {
  from: 'code_text',
  table: 'codes',
  column: 'code',
  where: GOOD,
  // This show's codes, or one the whole venue takes.
  scope: [{ column: 'event_id', equals: 'event_id', orEmpty: true }],
};

export const UNLOCK = { table: 'codes', column: 'code', link: 'unlocks_type_id', where: GOOD };

export function boxOfficeManifest(): Record<string, unknown> {
  const manifest = invoicingManifest([
    { ref: 'events', columns: [id, text('name')] },
    {
      ref: 'ticket_types',
      columns: [
        id,
        fk('event_id', 'events'),
        text('name', 60),
        { ref: 'number', type: 'int', nullable: true },
        { ref: 'price', type: 'decimal', scale: 2, default: 0 },
        { ref: 'capacity', type: 'int', nullable: true },
        { ref: 'visibility', type: 'enum', enum: ['public', 'code', 'box'], default: 'public' },
      ],
    },
    {
      ref: 'codes',
      columns: [
        id,
        { ref: 'code', type: 'text', maxLength: 32, unique: true, rules: { normalize: 'code' } },
        { ref: 'kind', type: 'enum', enum: ['percent', 'amount', 'unlock'], default: 'percent' },
        money('value'),
        { ref: 'active', type: 'bool', default: true },
        { ref: 'valid_until', type: 'timestamptz', nullable: true },
        fk('event_id', 'events', { nullable: true }),
        // The one type an amount off is for, by its number (a formula compares numbers).
        { ref: 'type_no', type: 'int', nullable: true },
        fk('unlocks_type_id', 'ticket_types', { nullable: true }),
        { ref: 'max_uses', type: 'int', nullable: true },
      ],
    },
    {
      ref: 'orders',
      columns: [
        id,
        { ref: 'status', type: 'enum', enum: ['held', 'paid', 'cancelled'], default: 'held' },
        { ref: 'held_until', type: 'timestamptz', nullable: true, rules: { stamp: { set: { addMinutes: { minutes: 15 } }, on: 'create' } } },
        fk('event_id', 'events'),
        text('email', 254),
        text('name', 80),
        text('code_text', 32),
        fk('code_id', 'codes', { nullable: true, rules: { lookup: LOOKUP } }),
        text('code_kind', 16, { rules: { copy: { via: 'code_id', from: 'kind' } } }),
        money('code_value', { copy: { via: 'code_id', from: 'value' } }),
        { ref: 'code_type_no', type: 'int', nullable: true, rules: { copy: { via: 'code_id', from: 'type_no' } } },
        money('subtotal', { rollup: { from: 'tickets', via: 'order_id', sum: 'price' } }),
        money('eligible', { rollup: { from: 'tickets', via: 'order_id', sum: 'eligible_price' } }),
        money('discount', {
          formula: {
            if: [
              { eq: ['code_kind', 'percent'] },
              { round: [{ mul: [{ coalesce: ['eligible', 0] }, { div: ['code_value', 100] }] }, 2] },
              { if: [{ eq: ['code_kind', 'amount'] }, { min: ['code_value', { coalesce: ['eligible', 0] }] }, 0] },
            ],
          },
        }),
        money('total', { formula: { sub: [{ coalesce: ['subtotal', 0] }, { coalesce: ['discount', 0] }] } }),
      ],
      // A code with so many uses: each held (until its hold ends) or paid order takes one.
      capacity: [{ kind: 'parent', via: 'code_id', size: { column: 'max_uses' }, countWhere: { column: 'status', values: ['held', 'paid'] }, hold: { column: 'held_until', states: ['held'] } }],
    },
    {
      ref: 'tickets',
      columns: [
        id,
        fk('order_id', 'orders'),
        fk('ticket_type_id', 'ticket_types'),
        money('price', { copy: { via: 'ticket_type_id', from: 'price' } }),
        { ref: 'type_no', type: 'int', nullable: true, rules: { copy: { via: 'ticket_type_id', from: 'number' } } },
        { ref: 'code_type_no', type: 'int', nullable: true, rules: { copy: { via: 'order_id', from: 'code_type_no' } } },
        money('eligible_price', {
          formula: {
            if: [{ or: [{ isNull: 'code_type_no' }, { and: [{ gte: ['type_no', 'code_type_no'] }, { lte: ['type_no', 'code_type_no'] }] }] }, 'price', 0],
          },
        }),
        text('code', 12, { rules: { code: { length: 8 } } }),
      ],
      // So many of each type: a ticket of a held (until its hold ends) or paid order takes a place.
      capacity: [{ kind: 'parent', via: 'ticket_type_id', size: { column: 'capacity' }, countWhere: { column: 'status', values: ['held', 'paid'], via: 'order_id' }, hold: { column: 'held_until', states: ['held'], via: 'order_id' } }],
    },
    // A sign-up anyone may make, with a code that names nothing but itself.
    { ref: 'signups', columns: [id, text('name', 80), text('code_text', 32), fk('code_id', 'codes', { nullable: true, rules: { lookup: { from: 'code_text', table: 'codes', column: 'code', where: GOOD } } })] },
  ]);
  manifest['key'] = 'bloom';
  (manifest['pages'] as { bindings: Record<string, string> }[])[0]!.bindings = { rows: 'orders' };
  manifest['frontends'] = [
    { side: 'staff', kind: 'spa', entry: 'index.html' },
    { side: 'customer', kind: 'spa', entry: 'index.html' },
  ];
  manifest['publicAccess'] = [
    { table: 'events', methods: ['GET'], select: ['id', 'name'] },
    { table: 'ticket_types', methods: ['GET'], select: ['id', 'event_id', 'name', 'price'], filters: [{ column: 'visibility', op: 'eq', value: 'public' }] },
    { table: 'ticket_types', methods: ['GET'], select: ['id', 'event_id', 'name', 'price'], filters: [{ column: 'visibility', op: 'neq', value: 'box' }], unlockBy: UNLOCK },
    {
      table: 'orders',
      methods: ['POST'],
      writable: ['event_id', 'email', 'name', 'code_text'],
      requires: ['email', 'name'],
      humanCheck: true,
      select: ['id', 'subtotal', 'discount', 'total'],
      children: {
        tickets: {
          via: 'order_id',
          writable: ['ticket_type_id'],
          select: ['id', 'price'],
          min: 1,
          max: 12,
          agrees: [{ column: 'ticket_type_id', path: ['event_id'], eq: { parent: 'event_id' } }],
        },
      },
      dryRun: true,
      expect: 'total',
    },
    { table: 'signups', methods: ['POST'], writable: ['name', 'code_text'], select: ['id', 'name'] },
    { table: 'tickets', kind: 'availability', methods: ['GET'], under: 'event_id' },
  ];
  return manifest;
}

/** Two shows, their ticket types, and the codes a guest may type. */
export async function boxOffice(dialect: Dialect, manifest: Record<string, unknown> = boxOfficeManifest()): Promise<InvoicingHarness & { reply: Record<string, unknown> }> {
  const h = await installInvoicing(dialect, manifest);
  const t = (on: boolean) => (dialect === 'postgres' ? String(on) : on ? '1' : '0');
  await h.rows(`INSERT INTO ${h.real('events')} (id, name) VALUES (1, 'Static Bloom'), (2, 'Home Studio Basics')`);
  await h.rows(
    `INSERT INTO ${h.real('ticket_types')} (id, event_id, name, number, price, capacity, visibility) VALUES ` +
      `(1, 1, 'Standard', 1, 45, 100, 'public'), (2, 1, 'Balcony', 2, 60, 100, 'public'), (3, 1, 'Presale', 3, 40, 50, 'code'), (4, 1, 'Comp', 4, 0, 10, 'box'), (5, 2, 'Place', 5, 45, 20, 'public')`,
  );
  const code = (row: string) => h.rows(`INSERT INTO ${h.real('codes')} (id, code, kind, value, active, valid_until, event_id, type_no, unlocks_type_id, max_uses) VALUES ${row}`);
  await code(`(1, 'STUDENT10', 'percent', 10, ${t(true)}, NULL, 1, NULL, NULL, NULL)`);
  await code(`(2, 'CREW5', 'amount', 5, ${t(true)}, NULL, 1, 1, NULL, NULL)`);
  await code(`(3, 'BLOOMEARLY', 'unlock', NULL, ${t(true)}, NULL, 1, NULL, 3, NULL)`);
  await code(`(4, 'BOOKO', 'amount', 1, ${t(true)}, NULL, NULL, NULL, NULL, NULL)`);
  await code(`(5, 'BOOK0', 'amount', 2, ${t(true)}, NULL, NULL, NULL, NULL, NULL)`);
  await code(`(6, 'SWITCHEDOFF', 'percent', 50, ${t(false)}, NULL, 1, NULL, 3, NULL)`);
  await code(`(7, 'LASTYEAR', 'percent', 50, ${t(true)}, '2001-01-01 00:00:00', 1, NULL, 3, NULL)`);
  await code(`(8, 'HOMEONLY', 'percent', 20, ${t(true)}, NULL, 2, NULL, NULL, NULL)`);
  await code(`(9, 'VENUE15', 'percent', 15, ${t(true)}, '2999-01-01 00:00:00', NULL, NULL, NULL, NULL)`);
  await code(`(10, 'TWENTY', 'amount', 1, ${t(true)}, NULL, 1, NULL, NULL, 20)`);
  await code(`(11, 'COMPS', 'unlock', NULL, ${t(true)}, NULL, 1, NULL, 4, NULL)`);
  await code(`(12, 'TWO', 'amount', 1, ${t(true)}, NULL, 1, NULL, NULL, 2)`);
  // Rows written with their ids: Postgres's counters are moved past them.
  if (dialect === 'postgres') {
    for (const ref of ['events', 'ticket_types', 'codes']) {
      await h.rows(`SELECT setval(pg_get_serial_sequence('${h.real(ref)}', 'id'), (SELECT max(id) FROM ${h.real(ref)}))`);
    }
  }
  return h;
}
