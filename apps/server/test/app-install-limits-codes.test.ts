// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT AN INSTALL WRITES OF A LIMIT, A TYPED CODE, A RENEWING CODE AND A
 * PUBLIC PICTURE READS BACK AS THE APP WROTE IT — on every engine this run
 * can reach.
 *
 * Each rule is stored as an override row (the store's own payload schema
 * decides what survives) and each public entry as an endpoint definition
 * (stored as its printed text). A key either layer forgot would be dropped
 * without a word: a code that should renew would keep working after a
 * ticket changed hands, an unlock entry would list what it hides, a limit
 * would read back smaller than the app asked. So every rule is compared with
 * what the manifest says — tables replaced by their real ids and nothing
 * else — every endpoint's stored text parses and prints back to itself, and
 * an update to the same rules keeps every one of them the app's.
 */
import { parseDatabaseModel } from '@adminium/engine';
import { appTablesRepo, overridesRepo, publicEndpointsRepo, snapshotsRepo } from '@adminium/meta';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { sha512Integrity } from '../src/add-ons/store.js';
import { mapTableRefs } from '../src/apps/real-refs.js';
import { canonicalJson } from '../src/apps/sample-data.js';
import { applyOverrides } from '../src/connections/effective-schema.js';
import { parseDefinition, printDefinition } from '../src/public-api/endpoint.js';
import { packageTarball } from './app-bundle-helpers.js';
import { LEGS, installInvoicing, type InvoicingHarness } from './invoicing-install.helpers.js';
import { servePublic } from './public-lane.helpers.js';

// The rules stored here run in later changes; until then the server refuses
// their tables and suspends their entries. This file proves what is stored
// and served once they run, so the refusal is lifted for it alone.
vi.mock('../src/crud/unbuilt-rules.js', async (original) => ({
  ...(await original<typeof import('../src/crud/unbuilt-rules.js')>()),
  unbuiltEntryRuleOf: () => null,
  refuseUnbuiltTable: () => undefined,
}));

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

const LEGACY = {
  slot: 'starts_at',
  amount: 'party',
  perSlot: setting('slot_capacity'),
  countWhere: { column: 'status', values: ['held', 'paid'] },
  slotMinutes: 15,
  windowDays: setting('slot_minutes'),
  opens: '17:00',
  closes: setting('opens_at'),
  cancelHours: 2,
};

const ORDERS = [
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
];

const TICKETS = {
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
};

const ORDER_ITEMS = {
  kind: 'parent',
  via: 'menu_item_id',
  size: { column: 'stock_today', onDay: 'stock_on' },
  amount: 'qty',
  countWhere: { column: 'status', values: ['held', 'paid'], via: 'order_id' },
  day: { column: 'pickup_at', via: 'order_id' },
};

const STAYS = [
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
];

const STAY_EXTRAS = {
  kind: 'night',
  from: { via: 'stay_id', column: 'arrive' },
  to: { via: 'stay_id', column: 'depart' },
  countWhere: { column: 'status', values: ['booked', 'in_house'], via: 'stay_id' },
  pool: { via: 'extra_id', size: { column: 'limit' } },
};

const LOOKUP = {
  from: 'code_text',
  table: 'codes',
  column: 'code',
  where: [{ column: 'active', eq: true }, { column: 'valid_until', notBefore: 'now', orEmpty: true }],
  scope: [{ column: 'event_id', equals: 'event_id', orEmpty: true }],
};
const RENEW = { length: 8, renew: { on: [{ column: 'holder_email', changed: true }, { column: 'status', values: ['valid'] }] } };
const UNLOCK = { table: 'codes', column: 'code', link: 'unlocks_type_id', where: [{ column: 'active', eq: true }, { column: 'valid_until', notBefore: 'now', orEmpty: true }] };

function venue(version: string): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'venue',
    name: 'Venue',
    version,
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'AGPL-3.0-only',
    description: { key: 'd', fallback: 'A venue.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.1.0', updatesFrom: '>=0.1.0' },
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'settings', columns: [id, int('slot_capacity'), int('slot_minutes'), int('lead_minutes'), int('max_nights'), int('ahead_days'), text('opens_at', 5)] },
        { ref: 'hours', columns: [id, { ref: 'weekday', type: 'enum', enum: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] }, bool('open'), text('opens', 5), text('closes', 5)] },
        { ref: 'closures', columns: [id, date('from_date'), date('to_date'), bool('active')] },
        { ref: 'slot_pauses', columns: [id, time('slot_at', false), bool('active')] },
        { ref: 'halls', columns: [id, int('capacity')] },
        { ref: 'events', columns: [id, text('name'), fk('hall_id', 'halls')] },
        {
          ref: 'ticket_types',
          columns: [id, fk('event_id', 'events'), text('name'), int('capacity', true), int('max_per_order'), time('sales_start'), time('sales_end'), { ref: 'visibility', type: 'enum', enum: ['public', 'code', 'box'], default: 'public' }],
        },
        { ref: 'waitlist', columns: [id, text('email', 254), stamped('offered_until')] },
        {
          ref: 'codes',
          columns: [id, { ...text('code', 32), unique: true, rules: { normalize: 'code' } }, bool('active'), time('valid_until'), fk('event_id', 'events', true), fk('unlocks_type_id', 'ticket_types', true), int('max_uses', true)],
        },
        {
          ref: 'orders',
          columns: [
            id,
            status(['held', 'paid', 'released', 'cancelled']),
            stamped('held_until'),
            time('pickup_at', false),
            text('code_text', 32, true),
            { ...fk('code_id', 'codes', true), rules: { lookup: LOOKUP } },
            fk('event_id', 'events', true),
            fk('waitlist_id', 'waitlist', true),
          ],
          capacity: ORDERS,
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
            { ...text('code', 12, true), rules: { code: RENEW } },
          ],
          capacity: TICKETS,
        },
        { ref: 'menu_items', columns: [id, text('name'), { ...text('image', 400, true), semantic: 'image' }, int('stock_today', true), date('stock_on', true)] },
        { ref: 'order_items', columns: [id, fk('order_id', 'orders'), fk('menu_item_id', 'menu_items'), int('qty')], capacity: ORDER_ITEMS },
        { ref: 'room_types', columns: [id, int('sleeps')] },
        { ref: 'rooms', columns: [id, fk('room_type_id', 'room_types')] },
        { ref: 'room_closures', columns: [id, fk('room_id', 'rooms'), date('from_date'), date('to_date', true), bool('active')] },
        {
          ref: 'stays',
          columns: [id, fk('room_type_id', 'room_types'), fk('room_id', 'rooms', true), date('arrive'), date('depart'), status(['held', 'booked', 'in_house', 'cancelled']), stamped('held_until')],
          capacity: STAYS,
        },
        { ref: 'extras', columns: [id, int('limit', true)] },
        { ref: 'stay_extras', columns: [id, fk('stay_id', 'stays'), fk('extra_id', 'extras')], capacity: STAY_EXTRAS },
        { ref: 'bookings', columns: [id, time('starts_at', false), int('party'), status(['held', 'paid'])], capacity: LEGACY },
      ],
    },
    pages: [{ ref: 'venue-orders', template: 'page-crud', title: { key: 'o', fallback: 'Orders' }, nav: { group: 'records', icon: 'list', order: 1 }, bindings: { rows: 'orders' } }],
    frontends: [
      { side: 'staff', kind: 'spa', entry: 'index.html' },
      { side: 'customer', kind: 'spa' },
    ],
    publicAccess: [
      { table: 'orders', kind: 'availability', methods: ['GET'] },
      { table: 'tickets', kind: 'availability', methods: ['GET'], showLeft: { belowShare: 15 }, under: 'event_id' },
      { table: 'stays', kind: 'availability', methods: ['GET'], rule: 0, showLeft: { below: 3 } },
      { table: 'bookings', kind: 'availability', methods: ['GET'] },
      { table: 'ticket_types', methods: ['GET'], select: ['id', 'name'], filters: [{ column: 'visibility', op: 'eq', value: 'public' }] },
      { table: 'ticket_types', methods: ['GET'], select: ['id', 'name'], filters: [{ column: 'visibility', op: 'neq', value: 'box' }], unlockBy: UNLOCK },
      { table: 'menu_items', methods: ['GET'], select: ['id', 'name', 'image'], pictures: ['image'] },
    ],
  };
}

/** The stored rule an install should write: the manifest's, each table named by its real id. */
const expected = (value: unknown, realId: (ref: string) => string) => {
  const stored = Array.isArray(value) ? { rules: value } : value;
  return mapTableRefs(stored, realId).value;
};

let open: (InvoicingHarness & { reply: Record<string, unknown> }) | null = null;
afterEach(async () => {
  await open?.close();
  open = null;
});

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`limits, typed codes, renewing codes and pictures round-trip — ${dialect}`, () => {
    it('stores every rule and endpoint as the app wrote it, and an update keeps them the app\'s', async () => {
      const h = (open = await installInvoicing(dialect, venue('0.1.0')));
      const reply = h.reply as { rules: { skipped: unknown[] }; publicAccess: { endpoints: string[]; keys: Record<string, string> } };
      expect(reply.rules.skipped).toEqual([]);
      expect(reply.publicAccess.endpoints).toEqual([
        'venue_orders_availability',
        'venue_tickets_availability',
        'venue_stays_availability',
        'venue_bookings_availability',
        'venue_ticket_types',
        'venue_ticket_types_unlocked',
        'venue_menu_items',
      ]);

      const overrides = await overridesRepo(h.meta).listForConnection(h.connectionId);
      const rule = (op: string, table: string, column: string | null = null) => {
        const found = overrides.filter((o) => o.op === op && o.tableName.endsWith(`venue_${table}`) && o.columnName === column);
        expect(found, `${op} on ${table}.${String(column)}`).toHaveLength(1);
        return found[0]!;
      };
      const tableId = rule('table.capacity', 'orders').tableName;
      const realId = (ref: string) => tableId.replace(/venue_orders$/, `venue_${ref}`);
      const same = (actual: unknown, wanted: unknown) => expect(canonicalJson(actual)).toBe(canonicalJson(wanted));

      same(rule('table.capacity', 'orders').value, expected(ORDERS, realId));
      same(rule('table.capacity', 'tickets').value, expected(TICKETS, realId));
      same(rule('table.capacity', 'order_items').value, expected(ORDER_ITEMS, realId));
      same(rule('table.capacity', 'stays').value, expected(STAYS, realId));
      same(rule('table.capacity', 'stay_extras').value, expected(STAY_EXTRAS, realId));
      // A released slot rule is stored as it always was: one object, no kind.
      same(rule('table.capacity', 'bookings').value, expected(LEGACY, realId));
      expect(rule('table.capacity', 'bookings').value).not.toHaveProperty('kind');
      same(rule('column.lookup', 'orders', 'code_id').value, expected(LOOKUP, realId));
      same(rule('column.code', 'tickets', 'code').value, RENEW);
      same(rule('column.normalize', 'codes', 'code').value, { normalize: 'code' });

      // The effective model carries every rule; today's guard sees only the released rule's shape.
      const snapshot = await snapshotsRepo(h.meta).latest(h.connectionId);
      const model = applyOverrides(parseDatabaseModel(snapshot!.schema), overrides.filter((o) => o.status === 'active'));
      const table = (ref: string) => model.tables.find((t) => t.id === realId(ref))!;
      expect(table('bookings').capacity).toEqual(expected(LEGACY, realId));
      expect(table('bookings').capacityRules).toEqual([{ ...(expected(LEGACY, realId) as object), kind: 'slot' }]);
      for (const ref of ['orders', 'tickets', 'order_items', 'stays', 'stay_extras']) expect(table(ref).capacity).toBeUndefined();
      expect(table('orders').capacityRules?.map((r) => r.kind)).toEqual(['slot', 'parent']);
      expect(table('stays').capacityRules?.map((r) => r.kind)).toEqual(['night', 'night']);
      expect(table('tickets').capacityRules).toEqual([expected(TICKETS, realId)]);
      expect(table('orders').columns.find((c) => c.name === 'code_id')?.lookup).toEqual(expected(LOOKUP, realId));
      expect(table('tickets').columns.find((c) => c.name === 'code')?.code).toEqual(RENEW);
      expect(table('codes').columns.find((c) => c.name === 'code')?.normalize).toBe('code');

      // Each endpoint's stored text is its printed definition, and says what the entry said.
      const endpoints = await publicEndpointsRepo(h.meta).listByConnection(h.connectionId);
      const definition = (ref: string) => {
        const row = endpoints.find((e) => e.ref === ref)!;
        const parsed = parseDefinition(row.definition);
        if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
        expect(printDefinition(parsed.definition)).toBe(row.definition);
        return JSON.parse(row.definition) as Record<string, unknown>;
      };
      expect(definition('venue_tickets_availability')).toMatchObject({ kind: 'availability', show_left: { below_share: 15 }, under: 'event_id' });
      expect(definition('venue_tickets_availability')).not.toHaveProperty('capacity_rule');
      expect(definition('venue_stays_availability')).toMatchObject({ kind: 'availability', capacity_rule: 0, show_left: { below: 3 } });
      expect(definition('venue_ticket_types_unlocked')['unlock_by']).toEqual({
        table: realId('codes'),
        column: 'code',
        link: 'unlocks_type_id',
        where: [{ column: 'active', eq: true }, { column: 'valid_until', not_before: 'now', or_empty: true }],
      });
      expect(definition('venue_ticket_types')).not.toHaveProperty('unlock_by');
      expect(definition('venue_menu_items')['pictures']).toEqual(['image']);

      // A page learns from its config which kind of limit each availability ref answers.
      const served = await servePublic(h, reply.publicAccess.keys['customer']!);
      try {
        const config = await served.get('/config');
        expect(config.statusCode, config.body).toBe(200);
        const refs = (config.json() as { data: { refs: Record<string, { kind?: string; capacity?: string }> } }).data.refs;
        expect(Object.fromEntries(Object.entries(refs).filter(([, r]) => r.kind === 'availability').map(([ref, r]) => [ref, r.capacity]))).toEqual({
          venue_orders_availability: 'slot',
          venue_tickets_availability: 'parent',
          venue_stays_availability: 'night',
          venue_bookings_availability: 'slot',
        });
        expect(refs['venue_menu_items']).not.toHaveProperty('capacity');
      } finally {
        await served.close();
      }

      // An update with the same rules finds every one still the app's: nothing released, nothing rewritten.
      const before = new Map(overrides.map((o) => [o.id, canonicalJson(o.value)]));
      const tarball = packageTarball({ 'manifest.json': JSON.stringify(venue('0.1.1')), 'staff/index.html': '<!doctype html><html></html>' });
      const staged = await h.app.inject({
        method: 'POST',
        url: `/apps/upload?expectedSha512=${encodeURIComponent(sha512Integrity(tarball))}`,
        headers: { 'content-type': 'application/octet-stream' },
        payload: Buffer.from(tarball),
      });
      expect(staged.statusCode, staged.body).toBe(200);
      const updated = await h.app.inject({ method: 'POST', url: '/apps/venue/update', payload: {} });
      expect(updated.statusCode, updated.body).toBe(200);
      expect(updated.json()).toMatchObject({ app: { version: '0.1.1' } });
      const records = await appTablesRepo(h.meta).forInstall(h.connectionId, 'venue');
      const released = records.flatMap((record) => record.rules.filter((r) => r.released === true).map((r) => `${r.op} ${r.table}.${String(r.column)}`));
      expect(released).toEqual([]);
      const after = await overridesRepo(h.meta).listForConnection(h.connectionId);
      for (const o of after) if (before.has(o.id)) expect(canonicalJson(o.value), o.op).toBe(before.get(o.id));
      expect(after.filter((o) => o.op === 'table.capacity')).toHaveLength(6);
    }, 120_000);
  });
}
