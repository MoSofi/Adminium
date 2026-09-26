// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Three app manifests shaped like the apps that sell to guests — a pickup
 * kitchen (an order, its lines, each line's options), a box office (an order
 * of tickets for one show) and a guest house (a stay priced by the night,
 * with extras that follow it) — each using the vocabulary those apps need:
 * child rows in one write, agreements and counts, a dry run and a price
 * check, a retry key, a person found by address, the row's own link,
 * forgetting, a read for a signed-in guest alone, totals that count and
 * climb, days between dates, prices by the night, copies that follow, a
 * joined name, and a document listing several sources.
 *
 * Each validates as it is; each test breaks one thing and reads the sentence.
 */
import { validateManifest } from '../src/index.js';

export type Doc = Record<string, unknown>;

const id = { ref: 'id', type: 'int', role: 'pk' };
const money = (ref: string, rules?: Doc) => ({ ref, type: 'decimal', scale: 'currency', nullable: true, ...(rules === undefined ? {} : { rules }) });
const text = (ref: string, maxLength = 120, more: Doc = {}) => ({ ref, type: 'text', maxLength, ...more });
const fk = (ref: string, references: string, more: Doc = {}) => ({ ref, type: 'fk', references, ...more });
const email = (ref = 'email') => text(ref, 254, { rules: { validation: { format: 'email' } } });
/** A person who signs in by an emailed link: one row per address, forgettable. */
const customers = (ref = 'customers') => ({
  ref,
  columns: [
    id,
    text('email', 254, { nullable: true, unique: true, rules: { normalize: 'email', validation: { format: 'email' } } }),
    text('name', 120, { nullable: true }),
    text('phone', 32, { nullable: true }),
    { ref: 'forgotten_at', type: 'timestamptz', nullable: true },
  ],
});
const linkToken = { ref: 'link_token', type: 'text', maxLength: 16, nullable: true, rules: { code: { length: 16 } } };
const clientKey = text('client_key', 64, { nullable: true, unique: true });

function envelope(key: string, tables: Doc[], publicAccess: Doc[], more: Doc = {}): Doc {
  return {
    kind: 'app',
    manifestVersion: 1,
    key,
    name: key,
    version: '0.2.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    description: { key: 'd', fallback: 'An app' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.3.0' },
    requiredSchema: { prefixed: true, tables },
    pages: [{ ref: 'home', template: 'page-crud', title: { key: 't', fallback: 'Home' }, nav: { group: 'records', icon: 'list', order: 1 } }],
    frontends: [
      { side: 'staff', kind: 'spa', placement: 'internal' },
      { side: 'customer', kind: 'spa' },
    ],
    publicAccess,
    publicKeys: { link: {} },
    ...more,
  };
}

/** The customer key's person and their own orders, and the link key's own row. */
function personEntries(table: string, select: string[]): Doc[] {
  return [
    {
      table: 'customers',
      methods: ['GET', 'PATCH'],
      select: ['name', 'email'],
      writable: ['name'],
      claim: { verify: 'email-link', email: 'email' },
      humanCheck: true,
      forget: { columns: ['email', 'name', 'phone'], stamp: 'forgotten_at' },
    },
    { table, methods: ['GET'], level: 'verified', claimedBy: { table: 'customers', column: 'customer_id' }, select },
    { table, key: 'link', methods: ['GET', 'PATCH'], select, writable: ['note'], claim: { by: 'token', column: 'link_token', stopped: 'link_stopped', own: true } },
  ];
}

/** A pickup kitchen: an order, its lines, each line's options. */
export function kitchen(): Doc {
  const tables: Doc[] = [
    { ref: 'settings', columns: [id, { ref: 'max_items', type: 'int', default: 12 }, text('bank_name', 80, { nullable: true })] },
    customers(),
    { ref: 'menu_items', columns: [id, text('name'), { ref: 'price', type: 'decimal', scale: 2, default: 0 }, { ref: 'available', type: 'bool', default: true }] },
    { ref: 'modifier_groups', columns: [id, fk('item_id', 'menu_items'), text('name'), { ref: 'min', type: 'int', default: 0 }, { ref: 'max', type: 'int', nullable: true }] },
    { ref: 'modifiers', columns: [id, fk('group_id', 'modifier_groups'), text('name'), { ref: 'price', type: 'decimal', scale: 2, default: 0 }] },
    {
      ref: 'orders',
      columns: [
        id,
        { ref: 'number', type: 'int', nullable: true, rules: { sequence: { gapless: true } } },
        fk('customer_id', 'customers', { nullable: true }),
        email(),
        text('name'),
        text('phone', 32, { nullable: true }),
        { ref: 'pickup_at', type: 'timestamptz' },
        text('note', 500, { nullable: true }),
        clientKey,
        linkToken,
        { ref: 'link_stopped', type: 'bool', default: false },
        { ref: 'status', type: 'enum', enum: ['placed', 'ready', 'collected'], default: 'placed' },
        money('subtotal', { rollup: { from: 'order_items', via: 'order_id', sum: 'line_total' } }),
        money('tax', { formula: { round: { div: [{ mul: ['subtotal', 8.25] }, 100] } } }),
        money('total', { formula: { add: ['subtotal', { coalesce: ['tax', 0] }] } }),
        { ref: 'item_count', type: 'int', nullable: true, rules: { rollup: { from: 'order_items', via: 'order_id', count: true } } },
      ],
    },
    {
      ref: 'order_items',
      columns: [
        id,
        fk('order_id', 'orders'),
        fk('menu_item_id', 'menu_items'),
        { ref: 'qty', type: 'int', default: 1, rules: { validation: { min: 1, max: 20 } } },
        text('note', 200, { nullable: true }),
        { ref: 'position', type: 'int', nullable: true },
        money('unit_price', { copy: { via: 'menu_item_id', from: 'price' } }),
        money('options_total', { rollup: { from: 'order_item_modifiers', via: 'order_item_id', sum: 'price' } }),
        money('line_total', { formula: { mul: ['qty', { add: ['unit_price', { coalesce: ['options_total', 0] }] }] } }),
      ],
    },
    {
      ref: 'order_item_modifiers',
      columns: [
        id,
        fk('order_item_id', 'order_items'),
        fk('modifier_id', 'modifiers'),
        text('name', 120, { nullable: true, rules: { copy: { via: 'modifier_id', from: 'name' } } }),
        money('price', { copy: { via: 'modifier_id', from: 'price' } }),
      ],
    },
  ];
  const select = ['id', 'number', 'status', 'subtotal', 'tax', 'total', 'pickup_at'];
  return envelope('kitchen', tables, [
    ...personEntries('orders', select),
    { table: 'menu_items', methods: ['GET'], select: ['id', 'name', 'price'], filters: [{ column: 'available', op: 'eq', value: true }] },
    { table: 'modifier_groups', methods: ['GET'], select: ['id', 'item_id', 'name', 'min', 'max'] },
    { table: 'modifiers', methods: ['GET'], select: ['id', 'group_id', 'name', 'price'] },
    {
      table: 'orders',
      methods: ['POST'],
      humanCheck: true,
      level: 'verified',
      select,
      writable: ['email', 'name', 'phone', 'pickup_at', 'note', 'client_key'],
      requires: ['email', 'name'],
      claimedBy: { table: 'customers', column: 'customer_id', optional: true },
      identity: { table: 'customers', email: 'email', link: 'customer_id', fill: { name: 'name' } },
      shareLink: 'link_token',
      anonymous: { perValue: { columns: ['email'], n: 10 }, perKeyHour: 300, plainText: ['note'] },
      children: {
        order_items: {
          via: 'order_id',
          writable: ['menu_item_id', 'qty', 'note'],
          select: ['id', 'qty', 'line_total'],
          position: 'position',
          min: 1,
          max: 40,
          plainText: ['note'],
          sumMax: { column: 'qty', max: { table: 'settings', column: 'max_items' } },
          children: {
            order_item_modifiers: {
              via: 'order_item_id',
              writable: ['modifier_id'],
              max: 20,
              agrees: [{ column: 'modifier_id', path: ['group_id', 'item_id'], eq: { parent: 'menu_item_id' } }],
              counts: [{ by: ['modifier_id', 'group_id'], every: { column: 'item_id', eq: { parent: 'menu_item_id' } }, min: 'min', max: 'max' }],
            },
          },
        },
      },
      dryRun: true,
      expect: 'total',
      clientKey: 'client_key',
    },
    { table: 'order_items', key: 'link', methods: ['GET'], level: 'verified', visibleWith: { table: 'orders', via: 'order_id' }, select: ['id', 'qty', 'line_total'] },
    { table: 'settings', methods: ['GET'], level: 'verified', select: ['bank_name'] },
  ]);
}

/** A box office: an order of tickets for one show, and a ticket passed to a friend by its own link. */
export function boxOffice(): Doc {
  const tables: Doc[] = [
    customers(),
    { ref: 'events', columns: [id, text('name'), { ref: 'starts_at', type: 'timestamptz' }] },
    { ref: 'ticket_types', columns: [id, fk('event_id', 'events'), text('name'), { ref: 'price', type: 'decimal', scale: 2, default: 0 }] },
    {
      ref: 'orders',
      columns: [
        id,
        fk('customer_id', 'customers', { nullable: true }),
        fk('event_id', 'events'),
        email(),
        text('name'),
        text('note', 500, { nullable: true }),
        clientKey,
        linkToken,
        { ref: 'link_stopped', type: 'bool', default: false },
        money('total', { rollup: { from: 'tickets', via: 'order_id', sum: 'price' } }),
        { ref: 'ticket_count', type: 'int', nullable: true, rules: { rollup: { from: 'tickets', via: 'order_id', count: true } } },
      ],
    },
    {
      ref: 'tickets',
      columns: [
        id,
        fk('order_id', 'orders'),
        fk('ticket_type_id', 'ticket_types'),
        text('holder_name', 120, { nullable: true }),
        text('holder_email', 254, { nullable: true, rules: { validation: { format: 'email' } } }),
        fk('holder_customer_id', 'customers', { nullable: true }),
        { ref: 'code', type: 'text', maxLength: 12, nullable: true, rules: { code: { length: 12 } } },
        linkToken,
        money('price', { copy: { via: 'ticket_type_id', from: 'price' } }),
      ],
    },
  ];
  const select = ['id', 'total', 'ticket_count'];
  return envelope('boxoffice', tables, [
    ...personEntries('orders', select),
    { table: 'events', methods: ['GET'], select: ['id', 'name', 'starts_at'] },
    { table: 'ticket_types', methods: ['GET'], select: ['id', 'event_id', 'name', 'price'] },
    {
      table: 'orders',
      methods: ['POST'],
      humanCheck: true,
      level: 'verified',
      select,
      writable: ['event_id', 'email', 'name', 'client_key'],
      requires: ['email', 'name'],
      claimedBy: { table: 'customers', column: 'customer_id', optional: true },
      identity: { table: 'customers', email: 'email', link: 'customer_id' },
      shareLink: 'link_token',
      anonymous: { perValue: { columns: ['email'], n: 10 } },
      children: {
        tickets: {
          via: 'order_id',
          writable: ['ticket_type_id', 'holder_name'],
          select: ['id', 'code', 'price'],
          min: 1,
          max: 12,
          plainText: ['holder_name'],
          agrees: [{ column: 'ticket_type_id', path: ['event_id'], eq: { parent: 'event_id' } }],
        },
      },
      dryRun: true,
      expect: 'total',
      clientKey: 'client_key',
    },
    // A ticket's own link: the friend it was sent to accepts it, and is found by their address.
    {
      table: 'tickets',
      key: 'ticket',
      methods: ['GET', 'PATCH'],
      select: ['id', 'holder_name'],
      writable: ['holder_name', 'holder_email'],
      claim: { by: 'token', column: 'link_token', own: true },
      identity: { table: 'customers', email: 'holder_email', link: 'holder_customer_id' },
    },
  ], { publicKeys: { link: {}, ticket: {} } });
}

/** A guest house: a stay priced by the night, extras that follow it, a folio listing both. */
export function guestHouse(): Doc {
  const tables: Doc[] = [
    { ref: 'settings', columns: [id, text('bank_name', 80, { nullable: true }), text('account_number', 34, { nullable: true })] },
    customers('guests'),
    { ref: 'room_types', columns: [id, text('name'), { ref: 'base_rate', type: 'decimal', scale: 2, default: 0 }, { ref: 'sleeps', type: 'int', default: 2 }] },
    {
      ref: 'rate_rules',
      columns: [
        id,
        fk('room_type_id', 'room_types', { nullable: true }),
        text('weekdays', 32, { nullable: true }),
        { ref: 'from_date', type: 'date', nullable: true },
        { ref: 'to_date', type: 'date', nullable: true },
        { ref: 'amount', type: 'decimal', scale: 2, default: 0 },
        text('name', 40),
        { ref: 'active', type: 'bool', default: true },
      ],
    },
    { ref: 'extras', columns: [id, text('name'), { ref: 'each', type: 'decimal', scale: 2, default: 0 }, { ref: 'per', type: 'enum', enum: ['stay', 'night', 'person-night'], default: 'stay' }] },
    {
      ref: 'stays',
      columns: [
        id,
        fk('customer_id', 'guests', { nullable: true }),
        email(),
        text('first_name', 60),
        text('last_name', 60),
        text('guest_name', 121, { nullable: true, rules: { formula: { join: ['first_name', ' ', 'last_name'] } } }),
        fk('room_type_id', 'room_types'),
        { ref: 'arrive', type: 'date' },
        { ref: 'depart', type: 'date' },
        { ref: 'guests', type: 'int', default: 1, rules: { validation: { min: 1, max: 6 } } },
        text('note', 500, { nullable: true }),
        clientKey,
        linkToken,
        { ref: 'link_stopped', type: 'bool', default: false },
        { ref: 'nights', type: 'int', nullable: true, rules: { formula: { daysBetween: ['arrive', 'depart'] } } },
        money('room_total', {
          perNight: {
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
          },
        }),
        money('extras_total', { rollup: { from: 'stay_extras', via: 'stay_id', sum: 'amount', where: { column: 'removed', eq: false } } }),
        money('total', { formula: { add: [{ coalesce: ['room_total', 0] }, { coalesce: ['extras_total', 0] }] } }),
      ],
    },
    {
      ref: 'stay_extras',
      columns: [
        id,
        fk('stay_id', 'stays'),
        fk('extra_id', 'extras'),
        text('label', 120, { nullable: true, rules: { copy: { via: 'extra_id', from: 'name' } } }),
        money('each', { copy: { via: 'extra_id', from: 'each' } }),
        { ref: 'per', type: 'enum', enum: ['stay', 'night', 'person-night'], nullable: true, rules: { copy: { via: 'extra_id', from: 'per' } } },
        { ref: 'nights', type: 'int', nullable: true, rules: { copy: { via: 'stay_id', from: 'nights', mode: 'always', follow: true } } },
        { ref: 'guests', type: 'int', nullable: true, rules: { copy: { via: 'stay_id', from: 'guests', mode: 'always', follow: true } } },
        money('amount', {
          formula: {
            if: [{ eq: ['per', 'person-night'] }, { mul: ['each', 'guests', 'nights'] }, { if: [{ eq: ['per', 'night'] }, { mul: ['each', 'nights'] }, 'each'] }],
          },
        }),
        { ref: 'removed', type: 'bool', default: false },
      ],
    },
  ];
  const personal = personEntries('stays', ['id', 'arrive', 'depart', 'total']).map((entry) => ({ ...entry, ...(entry['table'] === 'customers' ? { table: 'guests' } : {}) }));
  (personal[1]!['claimedBy'] as Doc)['table'] = 'guests';
  // A guest changes their own dates through the stay's link, seeing the new price first.
  Object.assign(personal[2]!, { writable: ['arrive', 'depart', 'note'], dryRun: true, expect: 'total' });
  return envelope('guesthouse', tables, [
    ...personal,
    { table: 'room_types', methods: ['GET'], select: ['id', 'name', 'base_rate', 'sleeps'] },
    { table: 'extras', methods: ['GET'], select: ['id', 'name', 'each', 'per'] },
    {
      table: 'stays',
      methods: ['POST'],
      humanCheck: true,
      level: 'verified',
      select: ['id', 'nights', 'room_total', 'extras_total', 'total'],
      writable: ['email', 'first_name', 'last_name', 'room_type_id', 'arrive', 'depart', 'guests', 'client_key'],
      requires: ['email', 'first_name', 'last_name'],
      claimedBy: { table: 'guests', column: 'customer_id', optional: true },
      identity: { table: 'guests', email: 'email', link: 'customer_id', fill: { name: 'last_name' } },
      shareLink: 'link_token',
      anonymous: { perValue: { columns: ['email'], n: 5 } },
      agrees: [{ column: 'guests', lte: { via: 'room_type_id', column: 'sleeps' } }],
      children: { stay_extras: { via: 'stay_id', writable: ['extra_id'], max: 10 } },
      dryRun: true,
      expect: 'total',
      clientKey: 'client_key',
    },
    { table: 'settings', methods: ['GET'], level: 'verified', select: ['bank_name', 'account_number'] },
  ], {
    addOns: { requires: [{ key: 'invoices', range: '>=1.0.6', reason: { 'en-US': 'Folios are drawn by this add-on.' } }] },
    documents: [
      {
        kind: 'invoice',
        addOn: 'invoices',
        table: 'stays',
        name: { 'en-US': 'Folio' },
        mapping: {
          customerName: { column: 'guest_name' },
          items: {
            collections: [
              { nightly: 'room_total', columns: { date: 'date', desc: 'room_type_id.name', qty: 'qty', rate: 'rate', amount: 'rate' } },
              { table: 'stay_extras', via: 'stay_id', orderBy: 'id', unless: 'removed', columns: { desc: 'label', qty: 'nights', rate: 'each', amount: 'amount' } },
            ],
          },
        },
      },
    ],
  });
}

export const tableOf = (m: Doc, ref: string) => (m['requiredSchema'] as { tables: Doc[] }).tables.find((t) => t['ref'] === ref)!;
export const columnOf = (m: Doc, table: string, ref: string) => (tableOf(m, table)['columns'] as Doc[]).find((c) => c['ref'] === ref)!;
/** The entry on `table` (and `key`) with `method`: the create, a person's read, a link's change. */
export const entryOf = (m: Doc, table: string, method: string, key?: string) =>
  (m['publicAccess'] as Doc[]).find((e) => e['table'] === table && e['key'] === key && (e['methods'] as string[]).includes(method))!;

export function messages(m: Doc): string[] {
  const result = validateManifest(m);
  return result.ok ? [] : result.issues.map((i) => `${i.path}: ${i.message}`);
}

/** The issues of a manifest, as one text, for `toContain`. */
export const issuesText = (m: Doc) => messages(m).join('\n');
