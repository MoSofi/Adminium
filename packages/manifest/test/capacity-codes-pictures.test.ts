// SPDX-License-Identifier: AGPL-3.0-only
/**
 * LIMITS OF THREE KINDS, CODES A GUEST TYPES, CODES THAT RENEW, AND PICTURES
 * ANYONE MAY SEE — the manifest's words for them, and the checks that name a
 * mistake in them.
 *
 * One venue uses every one: a pickup slot and a code's uses on its orders;
 * tickets that take from their type, within a sales window, up to a number an
 * order, inside the hall's cap, held while an order is held (or a waitlist
 * offer lasts) and kept back when returned; portions of a dish for the day it
 * is stocked; stays that take a room of a type (or the type of the room
 * given) and one room a night; parking that takes from an extra on its stay's
 * nights. It validates; each test then breaks one thing and reads the
 * sentence that names it. A slot rule a released app wrote validates exactly
 * as before and parses to exactly what was written.
 */
import { describe, expect, it } from 'vitest';

import { validateManifest } from '../src/index.js';

const id = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength = 80, nullable = false) => ({ ref, type: 'text', maxLength, ...(nullable ? { nullable: true } : {}) });
const int = (ref: string, nullable = false) => ({ ref, type: 'int', ...(nullable ? { nullable: true } : { default: 0 }) });
const fk = (ref: string, references: string, nullable = false) => ({ ref, type: 'fk', references, ...(nullable ? { nullable: true } : {}) });
const date = (ref: string, nullable = false) => ({ ref, type: 'date', ...(nullable ? { nullable: true } : {}) });
const time = (ref: string, nullable = true) => ({ ref, type: 'timestamptz', ...(nullable ? { nullable: true } : {}) });
const bool = (ref: string) => ({ ref, type: 'bool', default: true });
const stamped = (ref: string) => ({ ...time(ref), rules: { stamp: { set: 'now', on: 'create' } } });
const status = (values: string[]) => ({ ref: 'status', type: 'enum', enum: values, default: values[0] });
const setting = (column: string) => ({ table: 'settings', column });

function tables() {
  return [
    {
      ref: 'settings',
      columns: [id, int('slot_capacity'), int('slot_minutes'), int('lead_minutes'), int('max_nights'), int('ahead_days'), text('opens_at', 5)],
    },
    { ref: 'hours', columns: [id, { ref: 'weekday', type: 'enum', enum: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] }, bool('open'), text('opens', 5), text('closes', 5)] },
    { ref: 'closures', columns: [id, date('from_date'), date('to_date'), bool('active')] },
    { ref: 'slot_pauses', columns: [id, time('slot_at', false), bool('active')] },
    { ref: 'halls', columns: [id, int('capacity')] },
    { ref: 'events', columns: [id, text('name'), fk('hall_id', 'halls')] },
    {
      ref: 'ticket_types',
      columns: [
        id,
        fk('event_id', 'events'),
        text('name'),
        int('capacity', true),
        int('max_per_order'),
        time('sales_start'),
        time('sales_end'),
        { ref: 'visibility', type: 'enum', enum: ['public', 'code', 'box'], default: 'public' },
      ],
    },
    { ref: 'waitlist', columns: [id, text('email', 254), stamped('offered_until')] },
    {
      ref: 'codes',
      columns: [
        id,
        { ...text('code', 32), unique: true, rules: { normalize: 'code' } },
        bool('active'),
        time('valid_until'),
        fk('event_id', 'events', true),
        fk('unlocks_type_id', 'ticket_types', true),
        int('max_uses', true),
      ],
    },
    {
      ref: 'orders',
      columns: [
        id,
        status(['held', 'paid', 'released', 'cancelled']),
        stamped('held_until'),
        time('pickup_at', false),
        text('code_text', 32, true),
        {
          ...fk('code_id', 'codes', true),
          rules: {
            lookup: {
              from: 'code_text',
              table: 'codes',
              column: 'code',
              where: [{ column: 'active', eq: true }, { column: 'valid_until', notBefore: 'now', orEmpty: true }],
              scope: [{ column: 'event_id', equals: 'event_id', orEmpty: true }],
            },
          },
        },
        fk('event_id', 'events', true),
        fk('waitlist_id', 'waitlist', true),
      ],
      capacity: [
        {
          kind: 'slot',
          slot: 'pickup_at',
          amount: 1,
          perSlot: setting('slot_capacity'),
          countWhere: { column: 'status', values: ['held', 'paid'] },
          slotMinutes: setting('slot_minutes'),
          windowDays: 1,
          hours: { table: 'hours', weekday: 'weekday', open: 'open', opens: 'opens', closes: 'closes' },
          closures: { table: 'closures', from: 'from_date', to: 'to_date', active: 'active' },
          pauses: { table: 'slot_pauses', slot: 'slot_at', active: 'active' },
          noticeMinutes: setting('lead_minutes'),
          hold: { column: 'held_until', states: ['held'] },
        },
        {
          kind: 'parent',
          via: 'code_id',
          size: { column: 'max_uses' },
          countWhere: { column: 'status', values: ['held', 'paid'] },
          window: { closes: 'valid_until' },
          hold: { column: 'held_until', states: ['held'] },
        },
      ],
    },
    {
      ref: 'tickets',
      columns: [
        id,
        fk('order_id', 'orders'),
        { ...fk('ticket_type_id', 'ticket_types'), index: true },
        { ...fk('event_id', 'events', true), rules: { copy: { via: 'ticket_type_id', from: 'event_id' } } },
        status(['valid', 'returned', 'refunded', 'checked_in']),
        text('holder_email', 254),
        text('holder_name'),
        { ...text('code', 12, true), rules: { code: { length: 8, renew: { on: [{ column: 'holder_email', changed: true }, { column: 'status', values: ['valid'] }] } } } },
      ],
      capacity: {
        kind: 'parent',
        via: 'ticket_type_id',
        size: { column: 'capacity' },
        countWhere: [
          { column: 'status', values: ['valid', 'returned', 'checked_in'] },
          { column: 'status', values: ['held', 'paid'], via: 'order_id' },
        ],
        window: { opens: 'sales_start', closes: 'sales_end' },
        perWrite: { max: { column: 'max_per_order' }, within: 'order_id' },
        also: [{ via: 'event_id', size: { via: 'hall_id', column: 'capacity' } }],
        lockBy: 'event_id',
        hold: { column: { column: 'offered_until', via: 'waitlist_id', or: [{ column: 'held_until' }] }, states: ['held'], via: 'order_id' },
        reserved: { states: ['returned'] },
      },
    },
    { ref: 'menu_items', columns: [id, text('name'), { ...text('image', 400, true), semantic: 'image' }, int('stock_today', true), date('stock_on', true)] },
    {
      ref: 'order_items',
      columns: [id, { ...fk('order_id', 'orders'), index: true }, fk('menu_item_id', 'menu_items'), int('qty')],
      capacity: {
        kind: 'parent',
        via: 'menu_item_id',
        size: { column: 'stock_today', onDay: 'stock_on' },
        amount: 'qty',
        countWhere: { column: 'status', values: ['held', 'paid'], via: 'order_id' },
        day: { column: 'pickup_at', via: 'order_id' },
      },
    },
    { ref: 'room_types', columns: [id, int('sleeps')] },
    { ref: 'rooms', columns: [id, fk('room_type_id', 'room_types')] },
    { ref: 'room_closures', columns: [id, fk('room_id', 'rooms'), date('from_date'), date('to_date', true), bool('active')] },
    {
      ref: 'stays',
      columns: [id, fk('room_type_id', 'room_types'), fk('room_id', 'rooms', true), date('arrive'), date('depart'), status(['held', 'booked', 'in_house', 'cancelled']), stamped('held_until')],
      capacity: [
        {
          kind: 'night',
          from: 'arrive',
          to: 'depart',
          countWhere: { column: 'status', values: ['held', 'booked', 'in_house'] },
          pool: {
            via: 'room_type_id',
            count: { table: 'rooms', column: 'room_type_id', outOfService: { table: 'room_closures', room: 'room_id', from: 'from_date', to: 'to_date', active: 'active' } },
            fits: { column: 'sleeps' },
            given: { via: 'room_id', column: 'room_type_id' },
          },
          nights: { min: 1, max: setting('max_nights'), minByArrival: { sat: 2 }, aheadDays: setting('ahead_days') },
          hold: { column: 'held_until', states: ['held'] },
        },
        { kind: 'night', from: 'arrive', to: 'depart', countWhere: { column: 'status', values: ['held', 'booked', 'in_house'] }, pool: { via: 'room_id', size: 1 } },
      ],
    },
    { ref: 'extras', columns: [id, int('limit', true)] },
    {
      ref: 'stay_extras',
      columns: [id, fk('stay_id', 'stays'), fk('extra_id', 'extras')],
      capacity: {
        kind: 'night',
        from: { via: 'stay_id', column: 'arrive' },
        to: { via: 'stay_id', column: 'depart' },
        countWhere: { column: 'status', values: ['booked', 'in_house'], via: 'stay_id' },
        pool: { via: 'extra_id', size: { column: 'limit' } },
      },
    },
  ];
}

function venue() {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'venue',
    name: 'Venue',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    description: { key: 'd', fallback: 'A venue' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.3.0' },
    requiredSchema: { prefixed: true, tables: tables() },
    pages: [{ ref: 'orders', template: 'page-crud', title: { key: 't', fallback: 'Orders' }, nav: { group: 'records', icon: 'list', order: 1 }, bindings: { rows: 'orders' } }],
    frontends: [
      { side: 'staff', kind: 'spa', placement: 'internal' },
      { side: 'customer', kind: 'spa' },
    ],
    publicAccess: [
      { table: 'orders', kind: 'availability', methods: ['GET'] },
      { table: 'tickets', kind: 'availability', methods: ['GET'], showLeft: { belowShare: 15 }, under: 'event_id' },
      { table: 'stays', kind: 'availability', methods: ['GET'], rule: 0, showLeft: { below: 3 } },
      { table: 'ticket_types', methods: ['GET'], select: ['id', 'name'], filters: [{ column: 'visibility', op: 'eq', value: 'public' }] },
      {
        table: 'ticket_types',
        methods: ['GET'],
        select: ['id', 'name'],
        filters: [{ column: 'visibility', op: 'neq', value: 'box' }],
        unlockBy: { table: 'codes', column: 'code', link: 'unlocks_type_id', where: [{ column: 'active', eq: true }, { column: 'valid_until', notBefore: 'now', orEmpty: true }] },
      },
      { table: 'menu_items', methods: ['GET'], select: ['id', 'name', 'image'], pictures: ['image'] },
      { table: 'orders', methods: ['POST'], select: ['id'], writable: ['pickup_at', 'code_text'] },
    ],
  };
}

type Doc = ReturnType<typeof venue>;
type Loose = Record<string, unknown>;

const issuesOf = (doc: unknown): string => {
  const result = validateManifest(doc);
  return result.ok ? '' : result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n');
};
function changed(edit: (doc: Doc) => void): Doc {
  const doc = structuredClone(venue());
  edit(doc);
  return doc;
}
const table = (doc: Doc, ref: string) => doc.requiredSchema.tables.find((t) => t.ref === ref)! as unknown as Loose & { columns: Loose[] };
const column = (doc: Doc, tableRef: string, ref: string) => table(doc, tableRef).columns.find((c) => c['ref'] === ref)!;
const capacity = (doc: Doc, tableRef: string, rule?: number) => {
  const value = table(doc, tableRef)['capacity'] as Loose | Loose[];
  return (Array.isArray(value) ? value[rule ?? 0] : value) as Loose;
};
const entry = (doc: Doc, i: number) => doc.publicAccess[i] as Loose;

describe('a venue using every limit, code and picture', () => {
  it('validates', () => {
    expect(issuesOf(venue())).toBe('');
  });

  it('gives back each rule as written: no kind is added', () => {
    const result = validateManifest(venue());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.kind === 'app' && result.manifest.requiredSchema.tables).toEqual(venue().requiredSchema.tables);
  });
});

describe('a slot rule a released app wrote', () => {
  const pos = () =>
    changed((doc) => {
      table(doc, 'orders')['capacity'] = {
        slot: 'pickup_at',
        amount: 'party',
        perSlot: setting('slot_capacity'),
        countWhere: { column: 'status', values: ['held', 'paid'] },
        slotMinutes: 15,
        windowDays: setting('slot_minutes'),
        opens: setting('opens_at'),
        closes: '21:00',
        cancelHours: 2,
      };
      table(doc, 'orders').columns.push(int('party'));
      doc.publicAccess.splice(0, 1);
    });

  it('validates and parses to exactly what was written', () => {
    expect(issuesOf(pos())).toBe('');
    const result = validateManifest(pos());
    if (!result.ok || result.manifest.kind !== 'app') throw new Error('invalid');
    const parsed = result.manifest.requiredSchema.tables.find((t) => t.ref === 'orders')!.capacity;
    expect(JSON.stringify(parsed)).toBe(JSON.stringify(table(pos(), 'orders')['capacity']));
    expect(parsed).not.toHaveProperty('kind');
  });

  it('is checked as it always was, in the same words', () => {
    const broken = changed((doc) => {
      table(doc, 'orders')['capacity'] = { slot: 'when', amount: 'party', perSlot: { table: 'settings', column: 'seats' }, slotMinutes: 15 };
      doc.publicAccess.splice(0, 1);
    });
    expect(issuesOf(broken)).toBe(
      [
        'requiredSchema.tables.9.capacity.slot: "orders" has no column "when"',
        'requiredSchema.tables.9.capacity.amount: "orders" has no column "party"',
        'requiredSchema.tables.9.capacity.perSlot: "settings" has no column "seats"',
      ].join('\n'),
    );
  });

  it('is asked nothing it was never asked, so no released app is refused now', () => {
    // A kind of column the new kinds would refuse — a slot that is a date, an amount that is text.
    const released = changed((doc) => {
      table(doc, 'orders')['capacity'] = { slot: 'code_text', amount: 'code_text', perSlot: 4, slotMinutes: 0, countWhere: { column: 'status', values: ['held'] } };
      doc.publicAccess.splice(0, 1);
    });
    expect(issuesOf(released)).toBe('');
  });
});

describe('the shape of a limit', () => {
  it('takes at most three rules, of a kind it knows', () => {
    expect(issuesOf(changed((doc) => {
      const rules = table(doc, 'stays')['capacity'] as Loose[];
      rules.push(rules[1]!, rules[1]!);
    }))).toMatch(/capacity: Too big/);
    expect(issuesOf(changed((doc) => {
      capacity(doc, 'tickets')['kind'] = 'shelf';
    }))).toMatch(/capacity\.kind: Invalid discriminator/);
    expect(issuesOf(changed((doc) => {
      delete capacity(doc, 'tickets')['via'];
    }))).toMatch(/capacity\.via: Invalid input/);
    expect(issuesOf(changed((doc) => {
      capacity(doc, 'stays', 1)['perSlot'] = 4;
    }))).toMatch(/capacity\.1: Unrecognized key: "perSlot"/);
  });

  it('holds a hold only on states it names', () => {
    expect(issuesOf(changed((doc) => {
      delete (capacity(doc, 'tickets')['hold'] as Loose)['states'];
    }))).toMatch(/capacity\.hold\.states: Invalid input/);
  });
});

describe('what a limit names', () => {
  const cases: [string, (doc: Doc) => void, string][] = [
    ['one slot limit a table', (doc) => (table(doc, 'orders')['capacity'] as Loose[]).push(capacity(doc, 'orders', 0)), 'requiredSchema.tables.9.capacity: a table has one slot limit'],
    ['the pool is a foreign key', (doc) => (capacity(doc, 'tickets')['via'] = 'status'), 'requiredSchema.tables.10.capacity.via: "tickets.status" must be a foreign key'],
    ['the size is a column of the pool', (doc) => (capacity(doc, 'tickets')['size'] = { column: 'cap' }), 'requiredSchema.tables.10.capacity.size.column: "ticket_types" has no column "cap"'],
    ['the size is a number', (doc) => (capacity(doc, 'tickets')['size'] = { column: 'name' }), '"ticket_types.name" must be a number'],
    ['the window is two times', (doc) => (capacity(doc, 'tickets')['window'] = { opens: 'name' }), '"ticket_types.name" must be a timestamptz'],
    ['a wider pool is two hops', (doc) => (capacity(doc, 'tickets')['also'] = [{ via: 'event_id', size: { via: 'name', column: 'capacity' } }]), '"events.name" must be a foreign key'],
    ['a count reads its own values', (doc) => (capacity(doc, 'tickets')['countWhere'] = { column: 'status', values: ['sold'] }), '"sold" is not a value of "tickets.status"'],
    ['a hold counts', (doc) => ((capacity(doc, 'tickets')['hold'] as Loose)['states'] = ['released']), '"released" is not counted, so it holds nothing'],
    ['a hold needs a count at its level', (doc) => (capacity(doc, 'tickets')['countWhere'] = { column: 'status', values: ['valid'] }), 'nothing says which rows of "order_id" count, so it holds nothing'],
    ['a hold ends by a stamp', (doc) => delete column(doc, 'orders', 'held_until')['rules'], 'a hold ends when Adminium says: "orders.held_until" needs a stamp'],
    ['nothing watches a hold\'s end: a stamp', (doc) => (table(doc, 'orders')['columns'] as Loose[]).push({ ref: 'noted_at', type: 'timestamptz', nullable: true, rules: { stamp: { set: 'now', on: { columns: ['held_until'] } } } }), '"orders.held_until" is a hold\'s end, which a new hold writes directly as it lets the old one go, so the stamp of "noted_at" may not watch it'],
    ['nothing watches a hold\'s end: a follow', (doc) => (table(doc, 'tickets')['columns'] as Loose[]).push({ ref: 'order_until', type: 'timestamptz', nullable: true, rules: { copy: { via: 'order_id', from: 'held_until', mode: 'always', follow: true } } }), '"orders.held_until" is a hold\'s end, which a new hold writes directly as it lets the old one go, so "tickets.order_until", which follows it, may not watch it'],
    ['a linked hold is a time', (doc) => ((capacity(doc, 'tickets')['hold'] as Loose)['column'] = { column: 'email', via: 'waitlist_id' }), '"waitlist.email" must be a timestamptz'],
    ['a linked hold follows a link', (doc) => ((capacity(doc, 'tickets')['hold'] as Loose)['column'] = { column: 'offered_until', via: 'status' }), '"orders.status" must be a foreign key'],
    ['a rule reads one owner', (doc) => (capacity(doc, 'order_items')['countWhere'] = { column: 'name', values: ['x'], via: 'menu_item_id' }), 'a rule reads one owner: "menu_item_id" and "order_id" differ'],
    ['the lock follows a pool', (doc) => (capacity(doc, 'tickets')['lockBy'] = 'order_id'), 'the lock follows a pool: "ticket_type_id" or "event_id"'],
    ['a wider pool locks only when it is copied', (doc) => delete column(doc, 'tickets', 'event_id')['rules'], 'the lock must follow the pool: copy "event_id" from "ticket_type_id"'],
    ['a kept-back place counts', (doc) => (capacity(doc, 'tickets')['reserved'] = { states: ['refunded'] }), '"refunded" is not counted, so it keeps no place'],
    ['a held place is not kept back', (doc) => (capacity(doc, 'tickets')['reserved'] = { states: ['held'], via: 'order_id' }), '"held" is held, so it is not also kept back'],
    ['a size for one day is a date', (doc) => ((capacity(doc, 'order_items')['size'] as Loose)['onDay'] = 'name'), '"menu_items.name" must be a date'],
    ['a size for one day counts by day', (doc) => delete capacity(doc, 'order_items')['day'], 'a size for one day needs a rule that counts by day (day)'],
    ['a day is a time', (doc) => (capacity(doc, 'order_items')['day'] = { column: 'status', via: 'order_id' }), '"orders.status" must be a timestamptz'],
    ['the slot is a time', (doc) => (capacity(doc, 'orders', 0)['slot'] = 'code_text'), '"orders.code_text" must be a timestamptz'],
    ['hours or opens', (doc) => (capacity(doc, 'orders', 0)['opens'] = '11:00'), 'the hours come from the hours table, not from opens and closes'],
    ['the hours name every weekday', (doc) => (column(doc, 'hours', 'weekday')['enum'] = ['mon', 'tue']), '"hours.weekday" must be an enum of mon, tue, wed, thu, fri, sat, sun'],
    ['closures are dates', (doc) => ((capacity(doc, 'orders', 0)['closures'] as Loose)['from'] = 'active'), '"closures.active" must be a date'],
    ['a pause is a slot time', (doc) => ((capacity(doc, 'orders', 0)['pauses'] as Loose)['table'] = 'nowhere'), '"nowhere" is not a table of this app'],
    ['a setting is a number', (doc) => (capacity(doc, 'orders', 0)['noticeMinutes'] = setting('opens_at')), '"settings.opens_at" must be a number'],
    ['the grid is a minute at least', (doc) => (capacity(doc, 'orders', 0)['slotMinutes'] = 0), 'the grid is at least one minute'],
    ['a stay is two dates', (doc) => (capacity(doc, 'stays', 0)['from'] = 'held_until'), '"stays.held_until" must be a date'],
    ['a child stay reads its stay', (doc) => (capacity(doc, 'stay_extras')['from'] = { via: 'stay_id', column: 'arrival' }), '"stays" has no column "arrival"'],
    ['rooms point at the type', (doc) => (((capacity(doc, 'stays', 0)['pool'] as Loose)['count'] as Loose)['column'] = 'id'), '"rooms.id" must be a foreign key'],
    ['a closure is of a room', (doc) => ((((capacity(doc, 'stays', 0)['pool'] as Loose)['count'] as Loose)['outOfService'] as Loose)['room'] = 'active'), '"room_closures.active" must be a foreign key'],
    ['the room given has a type', (doc) => ((capacity(doc, 'stays', 0)['pool'] as Loose)['given'] = { via: 'room_id', column: 'id' }), '"rooms.id" must be a foreign key'],
    ['the room given points at a type', (doc) => ((capacity(doc, 'stays', 0)['pool'] as Loose)['given'] = { via: 'room_type_id', column: 'sleeps' }), '"room_types.sleeps" must be a foreign key'],
    ['a pool size is a number', (doc) => ((capacity(doc, 'stay_extras')['pool'] as Loose)['size'] = { column: 'id_text' }), '"extras" has no column "id_text"'],
    ['the shortest stay is the shorter', (doc) => (capacity(doc, 'stays', 0)['nights'] = { min: 5, max: 3 }), 'the shortest stay is not longer than the longest'],
    ['how far ahead is a setting number', (doc) => (capacity(doc, 'stays', 0)['nights'] = { aheadDays: setting('nothing') }), '"settings" has no column "nothing"'],
    ['an index is for a pool', (doc) => (column(doc, 'tickets', 'holder_name')['index'] = true), '"tickets.holder_name" is indexed only as a foreign key a limit or a total counts by'],
    ['an index is not on a unique column', (doc) => Object.assign(column(doc, 'tickets', 'ticket_type_id'), { unique: true }), '"tickets.ticket_type_id" is unique, so it is indexed already'],
  ];
  for (const [name, edit, message] of cases) {
    it(name, () => {
      expect(issuesOf(changed(edit))).toContain(message);
    });
  }

  it('indexes a key a total adds up by', () => {
    const doc = changed((d) => {
      column(d, 'orders', 'pickup_at');
      table(d, 'orders').columns.push({ ref: 'items', type: 'int', nullable: true, rules: { rollup: { from: 'order_items', via: 'order_id', sum: 'qty' } } });
    });
    expect(issuesOf(doc)).toBe('');
    // Without the total, nothing counts by it.
    expect(issuesOf(venue())).toBe('');
    expect(issuesOf(changed((d) => (column(d, 'order_items', 'menu_item_id')['index'] = true)))).toBe('');
  });
});

describe('an availability entry', () => {
  const cases: [string, (doc: Doc) => void, string][] = [
    ['names a rule the table has', (doc) => (entry(doc, 0)['rule'] = 2), 'publicAccess.0.rule: "orders" has 2 limits, so rule is 0 to 1'],
    ['shows what is left of a pool only', (doc) => (entry(doc, 0)['showLeft'] = { below: 3 }), 'what is left is shown of a pool: a parent or night limit'],
    ['asks a parent pool by its column', (doc) => (entry(doc, 1)['under'] = 'hall_id'), '"ticket_types" has no column "hall_id"'],
    ['asks by a column only a parent pool', (doc) => (entry(doc, 2)['under'] = 'arrive'), 'under asks a parent limit by a column of its pools'],
    ['answers a pool, not a room', (doc) => (entry(doc, 2)['rule'] = 1), 'availability answers a pool, not one row'],
    ['is the only entry shaped so', (doc) => (entry(doc, 3)['showLeft'] = { below: 2 }), 'showLeft shapes an availability answer, and this entry reads rows'],
    ['shapes a limit the table has', (doc) => Object.assign(entry(doc, 5), { kind: 'availability', rule: 0, pictures: undefined, select: undefined }), 'rule answers a limit, and "menu_items" has none'],
  ];
  for (const [name, edit, message] of cases) {
    it(name, () => {
      expect(issuesOf(changed(edit))).toContain(message);
    });
  }
});

describe('a code a guest types', () => {
  const lookup = (doc: Doc) => (column(doc, 'orders', 'code_id')['rules'] as Loose)['lookup'] as Loose;
  const cases: [string, (doc: Doc) => void, string][] = [
    ['fills a nullable link', (doc) => delete column(doc, 'orders', 'code_id')['nullable'], 'a lookup fills this table\'s link to "codes": the column is a nullable foreign key to it'],
    ['fills a link to its table', (doc) => (lookup(doc)['table'] = 'events'), 'a lookup fills this table\'s link to "events"'],
    ['is typed into short text', (doc) => (column(doc, 'orders', 'code_text')['maxLength'] = 200), 'the code is typed into a nullable text column of up to 64 characters'],
    ['is typed into a column', (doc) => (lookup(doc)['from'] = 'typed'), '"orders" has no column "typed"'],
    ['finds one row', (doc) => delete column(doc, 'codes', 'code')['unique'], 'a code finds one row: make "codes.code" unique (or unique with its scope)'],
    ['is compared as a code', (doc) => delete column(doc, 'codes', 'code')['rules'], '"codes.code" is compared as a code: give it normalize "code"'],
    ['reads its conditions', (doc) => (lookup(doc)['where'] = [{ column: 'active', eq: 'yes' }]), '"yes" is not a value of "codes.active"'],
    ['bounds by a date', (doc) => (lookup(doc)['where'] = [{ column: 'max_uses', notBefore: 'now' }]), '"codes.max_uses" is not a date'],
    ['scopes by the same thing', (doc) => (lookup(doc)['scope'] = [{ column: 'event_id', equals: 'waitlist_id' }]), '"orders.waitlist_id" and "codes.event_id" hold different things'],
    ['is the one rule on its column', (doc) => ((column(doc, 'orders', 'code_id')['rules'] as Loose)['copy'] = { via: 'waitlist_id', from: 'id' }), 'a column is decided by one rule, and this one has copy, lookup'],
    ['is never written by a browser', (doc) => (entry(doc, 6)['writable'] = ['pickup_at', 'code_text', 'code_id']), '"code_id" is decided by Adminium and cannot be written publicly'],
    [
      'is at most two a table',
      (doc) => {
        const rules = column(doc, 'orders', 'code_id')['rules'];
        table(doc, 'orders').columns.push({ ...fk('code_2', 'codes', true), rules }, { ...fk('code_3', 'codes', true), rules });
      },
      'a table resolves at most two typed codes',
    ],
    ['is stored as a code only in text', (doc) => (column(doc, 'codes', 'max_uses')['rules'] = { normalize: 'code' }), 'only text is stored trimmed or in lower case'],
  ];
  for (const [name, edit, message] of cases) {
    it(name, () => {
      expect(issuesOf(changed(edit))).toContain(message);
    });
  }
});

describe('rows a code unlocks', () => {
  const unlock = (doc: Doc) => entry(doc, 4)['unlockBy'] as Loose;
  const cases: [string, (doc: Doc) => void, string][] = [
    ['only reads', (doc) => (entry(doc, 4)['methods'] = ['GET', 'POST']), 'publicAccess.4.methods: an unlock only reads'],
    ['is its own entry', (doc) => (entry(doc, 4)['kind'] = 'availability'), 'an unlock is its own entry'],
    ['is a table of the app', (doc) => (unlock(doc)['table'] = 'coupons'), '"coupons" is not a table of this app'],
    ['links to the rows it unlocks', (doc) => (unlock(doc)['link'] = 'event_id'), '"codes.event_id" does not point at "ticket_types"'],
    ['finds one code', (doc) => delete column(doc, 'codes', 'code')['unique'], 'publicAccess.4.unlockBy.column: a code finds one row'],
    ['compares as a code', (doc) => delete column(doc, 'codes', 'code')['rules'], 'publicAccess.4.unlockBy.column: "codes.code" is compared as a code'],
    ['bounds by a date', (doc) => (unlock(doc)['where'] = [{ column: 'active', notAfter: 'today' }]), '"codes.active" is not a date'],
  ];
  for (const [name, edit, message] of cases) {
    it(name, () => {
      expect(issuesOf(changed(edit))).toContain(message);
    });
  }
});

describe('a code that renews', () => {
  const renew = (doc: Doc, on: unknown) => (((column(doc, 'tickets', 'code')['rules'] as Loose)['code'] as Loose)['renew'] = { on });
  const cases: [string, (doc: Doc) => void, string][] = [
    ['by another column', (doc) => renew(doc, { column: 'code', changed: true }), 'a code is renewed by another column'],
    ['by a column there is', (doc) => renew(doc, { column: 'holder', changed: true }), '"tickets" has no column "holder"'],
    ['by a value of its column', (doc) => renew(doc, { column: 'status', values: ['sent'] }), '"sent" is not a value of "tickets.status"'],
    ['by a change a person makes', (doc) => renew(doc, { column: 'event_id', changed: true }), 'a code is renewed by a change a person makes, or a stamp'],
    ['by one to three triggers', (doc) => renew(doc, [{ column: 'status', values: ['valid'] }]), 'Too small'],
  ];
  for (const [name, edit, message] of cases) {
    it(name, () => {
      expect(issuesOf(changed(edit))).toContain(message);
    });
  }

  it('by a column a stamp writes in the same change', () => {
    const doc = changed((d) => {
      table(d, 'tickets').columns.push({ ref: 'pending_email', type: 'text', maxLength: 254, nullable: true });
      column(d, 'tickets', 'holder_email')['rules'] = { stamp: { set: { copy: 'pending_email' }, on: { column: 'status', values: ['valid'] } } };
      renew(d, { column: 'holder_email', changed: true });
    });
    expect(issuesOf(doc)).toBe('');
  });
});

describe('pictures anyone may see', () => {
  const cases: [string, (doc: Doc) => void, string][] = [
    ['are image columns', (doc) => (entry(doc, 5)['pictures'] = ['name']), '"menu_items.name" is not an image column: text with semantic "image"'],
    ['are columns there are', (doc) => (entry(doc, 5)['pictures'] = ['photo']), '"menu_items" has no column "photo"'],
    ['are shown by the entry', (doc) => (entry(doc, 5)['select'] = ['id', 'name']), '"image" is not one of the columns the entry shows'],
    ['are never written by a browser', (doc) => Object.assign(entry(doc, 5), { methods: ['GET', 'POST'], writable: ['image'] }), '"image" is a picture anyone sees, so a browser never writes it'],
    ['are shown by an entry that only reads', (doc) => (entry(doc, 5)['methods'] = ['GET', 'POST']), 'pictures are shown through an entry that only reads rows'],
    ['are for every visitor', (doc) => (entry(doc, 5)['visibleWith'] = { table: 'orders', via: 'id' }), "pictures are for every visitor; a signed-in person's own files are `files`"],
    ['are not behind a code', (doc) => (entry(doc, 5)['unlockBy'] = entry(doc, 4)['unlockBy']), 'pictures are for every visitor; rows a code unlocks are read only by whoever gave the code'],
    ['are not kept from readers', (doc) => (column(doc, 'menu_items', 'image')['rules'] = { secret: true }), '"menu_items.image" is kept from readers, so it is no picture for everyone'],
    ['are not personal', (doc) => (column(doc, 'menu_items', 'image')['rules'] = { personal: true }), '"menu_items.image" is personal data, so it is no picture for everyone'],
    ['are at most four', (doc) => (entry(doc, 5)['pictures'] = ['image', 'image', 'image', 'image', 'image']), 'Too big'],
  ];
  for (const [name, edit, message] of cases) {
    it(name, () => {
      expect(issuesOf(changed(edit))).toContain(message);
    });
  }
});
