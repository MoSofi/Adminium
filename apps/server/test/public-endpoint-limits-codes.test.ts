// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An endpoint's words for a limit's availability (`capacity_rule`,
 * `show_left`, `under`), the rows a code unlocks (`unlock_by`) and the
 * pictures anyone may see (`pictures`): each is kept by the stored text —
 * printed, parsed and printed again to the same bytes — and each is checked
 * against the source it names, with a code that says what is wrong.
 */
import { applyClassification, parseDatabaseModel, type DatabaseModel } from '@adminium/engine';
import type { SchemaOverride } from '@adminium/meta';
import { describe, expect, it } from 'vitest';

import { applyOverrides } from '../src/connections/effective-schema.js';
import { SnapshotView } from '../src/crud/identifiers.js';
import { endpointIssues, parseDefinition, printDefinition, type PublicEndpointDefinition } from '../src/public-api/endpoint.js';

const col = (name: string, extra: Record<string, unknown> = {}) => ({ name, logicalType: 'text', ...extra });
const key = col('id', { logicalType: 'integer', nullable: false, isPrimaryKey: true, default: { kind: 'autoincrement' } });
const table = (name: string, columns: ReturnType<typeof col>[]) => ({ schema: 'public', name, primaryKey: ['id'], columns: [key, ...columns] });
const fk = (from: string, column: string, to: string) => ({
  id: `fk:${from}-${column}`,
  kind: 'declared-fk',
  cardinality: 'one-to-many',
  from: { tableId: `public.${from}`, columns: [column] },
  to: { tableId: `public.${to}`, columns: ['id'] },
  onDelete: 'no-action',
});

const override = (op: string, tableName: string, value: Record<string, unknown>, columnName: string | null = null): SchemaOverride => ({
  id: `ovr_${tableName}_${op}`,
  connectionId: 'cnx_test',
  op: op as SchemaOverride['op'],
  tableName,
  columnName,
  value,
  origin: 'app',
  llmRunId: null,
  status: 'active',
  createdBy: null,
  createdAt: 0,
  updatedAt: 0,
});

const model = applyClassification(
  parseDatabaseModel({
    dialect: 'postgres',
    name: 'venue',
    defaultSchema: 'public',
    schemas: ['public'],
    tables: [
      table('events', [col('name')]),
      table('ticket_types', [col('event_id', { logicalType: 'integer' }), col('name'), col('capacity', { logicalType: 'integer' })]),
      table('tickets', [col('ticket_type_id', { logicalType: 'integer' }), col('status')]),
      { ...table('codes', [col('code'), col('unlocks_type_id', { logicalType: 'integer' }), col('event_id', { logicalType: 'integer' }), col('active', { logicalType: 'boolean' }), col('email'), col('link_token'), col('word')]), uniques: [{ name: 'codes_code_key', columns: ['code'] }, { name: 'codes_link_token_key', columns: ['link_token'] }, { name: 'codes_word_key', columns: ['word'] }] },
      table('orders', [col('pickup_at', { logicalType: 'timestamptz' }), col('status')]),
      table('stays', [col('room_id', { logicalType: 'integer' }), col('arrive', { logicalType: 'date' }), col('depart', { logicalType: 'date' })]),
      table('rooms', [col('name')]),
      table('menu_items', [col('name'), col('image')]),
    ],
    relations: [fk('ticket_types', 'event_id', 'events'), fk('tickets', 'ticket_type_id', 'ticket_types'), fk('codes', 'unlocks_type_id', 'ticket_types'), fk('codes', 'event_id', 'events'), fk('stays', 'room_id', 'rooms')],
  }),
) as DatabaseModel;

const view = new SnapshotView(
  'cnx_test',
  applyOverrides(model, [
    override('table.capacity', 'public.tickets', { kind: 'parent', via: 'ticket_type_id', size: { column: 'capacity' } }),
    override('table.capacity', 'public.orders', { slot: 'pickup_at', amount: 'status', perSlot: 6, slotMinutes: 15 }),
    override('table.capacity', 'public.stays', { kind: 'night', from: 'arrive', to: 'depart', pool: { via: 'room_id', size: 1 } }),
    override('column.normalize', 'public.codes', { normalize: 'code' }, 'code'),
    override('column.normalize', 'public.codes', { normalize: 'code' }, 'link_token'),
  ]),
);

function def(source: string, over: Partial<PublicEndpointDefinition> = {}): PublicEndpointDefinition {
  return {
    path: `/${source}`,
    source: `public.${source}`,
    methods: ['GET'],
    select: ['id'],
    filters: [],
    pagination: { default_limit: 50, max_limit: 200, order: 'id.asc' },
    auth: { role: 'anon' },
    rate_limit: { requests: 60, window: '1m' },
    response: { shape: 'object', envelope: 'data' },
    ...over,
  };
}
const issues = (d: PublicEndpointDefinition, shareCodes?: ReadonlyMap<string, ReadonlySet<string>>) =>
  endpointIssues(d, { ref: d.path.slice(1), view, ...(shareCodes === undefined ? {} : { shareCodes }) }).map((i) => i.code);

const FULL = def('ticket_types', {
  select: ['id', 'name'],
  capacity_rule: 1,
  show_left: { below_share: 15 },
  under: 'event_id',
  unlock_by: { table: 'public.codes', column: 'code', link: 'unlocks_type_id', where: [{ column: 'active', eq: true }, { column: 'valid_until', not_before: 'now', or_empty: true }] },
  pictures: ['image'],
});

describe('the stored text', () => {
  it('keeps every key, and prints back to itself', () => {
    const text = printDefinition(FULL);
    const parsed = parseDefinition(text);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    expect(printDefinition(parsed.definition)).toBe(text);
    expect(JSON.parse(text)).toMatchObject({
      capacity_rule: 1,
      show_left: { below_share: 15 },
      under: 'event_id',
      unlock_by: FULL.unlock_by,
      pictures: ['image'],
    });
  });

  it('refuses a key it does not know inside them', () => {
    expect(parseDefinition({ ...FULL, show_left: { below: 3, share: 4 } }).ok).toBe(false);
    expect(parseDefinition({ ...FULL, unlock_by: { ...FULL.unlock_by, scope: [] } }).ok).toBe(false);
    expect(parseDefinition({ ...FULL, capacity_rule: 3 }).ok).toBe(false);
  });
});

describe('availability of a limit', () => {
  const availability = (source: string, over: Partial<PublicEndpointDefinition> = {}) => def(source, { kind: 'availability', ...over });

  it('answers a parent pool by a column of its pools, and shows what is left of it', () => {
    expect(issues(availability('tickets', { under: 'event_id', show_left: { below: 10 } }))).toEqual([]);
    expect(issues(availability('tickets', { under: 'hall_id' }))).toEqual(['ENDPOINT_AVAILABILITY_SHAPE']);
  });

  it('names a limit the source has', () => {
    expect(issues(availability('tickets', { capacity_rule: 1 }))).toEqual(['ENDPOINT_AVAILABILITY_NO_LIMIT']);
  });

  it('shows what is left only of a pool, and asks by a column only a parent limit', () => {
    expect(issues(availability('orders'))).toEqual([]);
    expect(issues(availability('orders', { show_left: { below: 3 } }))).toEqual(['ENDPOINT_AVAILABILITY_SHAPE']);
    expect(issues(availability('orders', { under: 'status' }))).toEqual(['ENDPOINT_AVAILABILITY_SHAPE']);
  });

  it('answers a pool, not one row', () => {
    expect(issues(availability('stays'))).toEqual(['ENDPOINT_AVAILABILITY_ONE_ROW']);
  });

  it('is the only endpoint shaped so', () => {
    expect(issues(def('tickets', { show_left: { below: 3 } }))).toEqual(['ENDPOINT_AVAILABILITY_SHAPE']);
  });
});

describe('rows a code unlocks', () => {
  const unlock = (over: Partial<PublicEndpointDefinition> = {}) =>
    def('ticket_types', { select: ['id', 'name'], unlock_by: { table: 'public.codes', column: 'code', link: 'unlocks_type_id' }, ...over });

  it('is a read of its own, through a link to its rows', () => {
    expect(issues(unlock())).toEqual([]);
    expect(issues(unlock({ methods: ['GET', 'POST'] }))).toContain('ENDPOINT_UNLOCK_READ_ONLY');
    expect(issues(unlock({ unlock_by: { table: 'public.codes', column: 'code', link: 'event_id' } }))).toEqual(['ENDPOINT_UNLOCK_UNKNOWN_COLUMN']);
    expect(issues(unlock({ unlock_by: { table: 'public.codes', column: 'text', link: 'unlocks_type_id' } }))).toEqual(['ENDPOINT_UNLOCK_UNKNOWN_COLUMN']);
    expect(issues(unlock({ unlock_by: { table: 'public.coupons', column: 'code', link: 'unlocks_type_id' } }))).toEqual(['ENDPOINT_UNLOCK_UNKNOWN_COLUMN']);
  });

  it('looks up only a code: one row per code, compared as a code, never a shared link\'s secret', () => {
    const by = (column: string) => unlock({ unlock_by: { table: 'public.codes', column, link: 'unlocks_type_id' } });
    // An address: not one row per value, nor kept as a code — a GET would say whether a person is on the list.
    expect(issues(by('email'))).toEqual(['ENDPOINT_UNLOCK_NOT_A_CODE', 'ENDPOINT_UNLOCK_NOT_A_CODE']);
    // Unique, but not compared as a code.
    expect(issues(by('word'))).toEqual(['ENDPOINT_UNLOCK_NOT_A_CODE']);
    // The code a shared link opens rows with, or a column kept secret: never looked up, however it is kept.
    expect(issues(by('code'), new Map([['public.codes', new Set(['code'])]]))).toEqual(['ENDPOINT_UNLOCK_SHARE_CODE']);
    expect(issues(by('link_token'))).toEqual(['ENDPOINT_UNLOCK_SHARE_CODE']);
    expect(issues(by('code'))).toEqual([]);
  });
});

describe('pictures anyone may see', () => {
  const pictures = (over: Partial<PublicEndpointDefinition> = {}) => def('menu_items', { select: ['id', 'name', 'image'], pictures: ['image'], ...over });

  it('are shown columns of an open read that no caller writes', () => {
    expect(issues(pictures())).toEqual([]);
    expect(issues(pictures({ select: ['id', 'name'] }))).toEqual(['ENDPOINT_PICTURES_NOT_SELECTED']);
    expect(issues(pictures({ pictures: ['photo'] }))).toEqual(['ENDPOINT_PICTURES_UNKNOWN_COLUMN']);
    expect(issues(pictures({ methods: ['GET', 'POST'], writable: ['image'] }))).toEqual(expect.arrayContaining(['ENDPOINT_PICTURES_READ_ONLY', 'ENDPOINT_PICTURES_WRITABLE']));
    expect(issues(pictures({ auth: { role: 'authenticated' }, claim: { column: 'id' } }))).toContain('ENDPOINT_PICTURES_CLAIMED');
    // Rows a code unlocks: an <img> carries no code, so they hold no picture for everyone.
    expect(issues(pictures({ unlock_by: { table: 'public.codes', column: 'code', link: 'unlocks_type_id' } }))).toContain('ENDPOINT_PICTURES_CLAIMED');
    // Nor rows a session's holder alone reads, however the endpoint says who may call it.
    expect(issues(pictures({ session_only: true }))).toContain('ENDPOINT_PICTURES_CLAIMED');
  });
});
