// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The venue's calendar in an endpoint's filter — `today`, `from-today` —
 * worked out per request, on the venue's clock, and spelled the way each
 * column keeps a value; and the endpoint and scope rules that go with it and
 * with a PATCH's pinned values and starting state.
 */
import { describe, expect, it } from 'vitest';

import type { ResolvedColumn, ResolvedTable, SnapshotView } from '../src/crud/identifiers.js';
import { wideningOf } from '../src/public-api/derive.js';
import { endpointIssues } from '../src/public-api/endpoint.js';
import { afterNow, mandatoryAt, type ScopeWhere } from '../src/public-api/relative-filters.js';
import { compileScope } from '../src/public-api/scope.js';

const column = (name: string, logicalType: string): ResolvedColumn => ({ name, logicalType }) as unknown as ResolvedColumn;

const table = {
  id: 'public.visits',
  name: 'visits',
  primaryKey: ['id'],
  columns: new Map(
    [
      column('id', 'integer'),
      column('on_day', 'date'),
      column('starts_at', 'timestamptz'),
      column('wall', 'timestamp'),
      column('status', 'varchar'),
    ].map((c) => [c.name, c]),
  ),
} as unknown as ResolvedTable;

const where = (relative: ScopeWhere['relative'], fixed: ScopeWhere['fixed'] = null): ScopeWhere => ({ fixed, relative });

describe('a filter on the venue’s calendar', () => {
  // 23:30 on Tuesday in London is already Wednesday in Tokyo.
  const now = new Date('2026-07-28T22:30:00Z');

  it('is today in the venue’s zone, as a date and as the instants the day spans', () => {
    expect(mandatoryAt(where([{ column: 'on_day', op: 'today' }]), table, 'Europe/London', now)).toEqual({
      and: [
        { column: 'on_day', op: 'gte', value: '2026-07-28' },
        { column: 'on_day', op: 'lt', value: '2026-07-29' },
      ],
    });
    expect(mandatoryAt(where([{ column: 'on_day', op: 'today' }]), table, 'Asia/Tokyo', now)).toEqual({
      and: [
        { column: 'on_day', op: 'gte', value: '2026-07-29' },
        { column: 'on_day', op: 'lt', value: '2026-07-30' },
      ],
    });
    // London's Tuesday runs from 23:00 Monday UTC (summer time) to 23:00 Tuesday UTC.
    expect(mandatoryAt(where([{ column: 'starts_at', op: 'today' }]), table, 'Europe/London', now)).toEqual({
      and: [
        { column: 'starts_at', op: 'gte', value: '2026-07-27T23:00:00.000Z' },
        { column: 'starts_at', op: 'lt', value: '2026-07-28T23:00:00.000Z' },
      ],
    });
  });

  it('keeps a day across a clock change: the autumn Sunday is 25 hours long', () => {
    const sunday = new Date('2026-10-25T12:00:00Z');
    expect(mandatoryAt(where([{ column: 'starts_at', op: 'today' }]), table, 'Europe/London', sunday)).toEqual({
      and: [
        { column: 'starts_at', op: 'gte', value: '2026-10-24T23:00:00.000Z' },
        { column: 'starts_at', op: 'lt', value: '2026-10-26T00:00:00.000Z' },
      ],
    });
  });

  it('runs from today on, for as many days as it says', () => {
    expect(mandatoryAt(where([{ column: 'on_day', op: 'from-today' }]), table, 'Europe/London', now)).toEqual({
      column: 'on_day',
      op: 'gte',
      value: '2026-07-28',
    });
    expect(mandatoryAt(where([{ column: 'on_day', op: 'from-today', days: 7 }]), table, 'Europe/London', now)).toEqual({
      and: [
        { column: 'on_day', op: 'gte', value: '2026-07-28' },
        { column: 'on_day', op: 'lt', value: '2026-08-04' },
      ],
    });
  });

  it('spells a time for a column with no zone as the write path does: the server’s wall clock', () => {
    const filter = mandatoryAt(where([{ column: 'wall', op: 'from-today' }]), table, 'Europe/London', now) as { value: string };
    expect(filter.value).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(new Date(filter.value.replace(' ', 'T')).getTime()).toBe(new Date('2026-07-27T23:00:00.000Z').getTime());
  });

  it('is ANDed after the fixed conditions, and a column that is no longer a date matches nothing', () => {
    const fixed = { column: 'status', op: 'eq' as const, value: 'booked' };
    expect(mandatoryAt(where([], fixed), table, 'Europe/London', now)).toBe(fixed);
    expect(mandatoryAt(where([{ column: 'status', op: 'today' }], fixed), table, 'Europe/London', now)).toEqual({
      and: [fixed, { column: 'id', op: 'is_null' }],
    });
    expect(mandatoryAt(where([{ column: 'gone', op: 'today' }]), table, 'Europe/London', now)).toEqual({ column: 'id', op: 'is_null' });
  });

  it('asks "still ahead" of a time, and of nothing else', () => {
    expect(afterNow(table, 'starts_at', now)).toEqual({ column: 'starts_at', op: 'gt', value: '2026-07-28T22:30:00.000Z' });
    expect(afterNow(table, 'on_day', now)).toEqual({ column: 'id', op: 'is_null' });
  });
});

describe('the rules that come with them', () => {
  const view = {
    table: () => ({
      ...table,
      schema: 'public',
      kind: 'table',
      columns: new Map([...table.columns].map(([name, c]) => [name, { ...c, secret: false }])),
      table: { kind: 'table', columns: [...table.columns.values()].map((c) => ({ ...c, isGenerated: false, default: null })) },
    }),
  } as unknown as SnapshotView;
  const base = {
    path: '/visits',
    source: 'public.visits',
    methods: ['GET', 'PATCH'],
    select: ['id', 'on_day', 'starts_at', 'status'],
    pagination: { default_limit: 50, max_limit: 200, order: 'id.asc' },
    auth: { role: 'authenticated' },
    rate_limit: { requests: 60, window: '1m' },
    response: { shape: 'object', envelope: 'data' },
    claim: { column: 'id' },
  };
  const codes = (definition: Record<string, unknown>) => endpointIssues({ ...base, ...definition }, { ref: 'visits', view }).map((i) => `${i.code}:${i.column ?? ''}`);

  it('saves a calendar filter on a date or a time, and refuses one on anything else', () => {
    expect(codes({ filters: [{ column: 'on_day', op: 'today' }, { column: 'starts_at', op: 'from-today', days: 7 }], writable: ['status'] })).toEqual([]);
    expect(codes({ filters: [{ column: 'status', op: 'today' }], writable: [] })).toContain('ENDPOINT_FILTER_NOT_A_DAY:status');
    // A calendar filter carries no value, and a count of days only on `from-today`.
    expect(codes({ filters: [{ column: 'on_day', op: 'today', value: 'x' }] })).toContain('ENDPOINT_SHAPE_INVALID:filters.0');
    expect(codes({ filters: [{ column: 'on_day', op: 'today', days: 2 }] })).toContain('ENDPOINT_SHAPE_INVALID:filters.0');
  });

  it('lets a filtered column change only when both ends of the change are pinned', () => {
    const kiosk = {
      filters: [{ column: 'status', op: 'in', value: ['booked', 'checked_in'] }],
      writable: ['status'],
      writable_values: { status: ['checked_in'] },
      writable_when: { status: ['booked'] },
    };
    expect(codes(kiosk)).toEqual([]);
    expect(codes({ ...kiosk, writable_when: undefined })).toContain('SCOPE_WHERE_COLUMN_WRITABLE:status');
    expect(codes({ ...kiosk, writable_values: undefined })).toContain('SCOPE_WHERE_COLUMN_WRITABLE:status');
  });

  it('pins values only on a column it writes, and asks "from now" only of a time', () => {
    expect(codes({ writable: ['status'], writable_values: { on_day: ['2026-07-28'] } })).toContain('SCOPE_WRITABLE_VALUES_NOT_WRITABLE:on_day');
    expect(codes({ writable: ['status'], writable_when: { on_day: 'from-now' } })).toContain('ENDPOINT_WRITABLE_WHEN_NOT_A_TIME:on_day');
    expect(codes({ writable: ['status'], writable_when: { starts_at: 'from-now', status: ['booked'] } })).toEqual([]);
  });

  it('refuses a stranger\u2019s cap on a column the table does not have', () => {
    expect(codes({ methods: ['POST'], writable: ['status'], anonymous: { per_value: { columns: ['phone'], n: 2 }, plain_text: ['status'] } })).toContain('ENDPOINT_COLUMN_UNKNOWN:phone');
    expect(codes({ methods: ['POST'], writable: ['status'], anonymous: { per_value: { columns: ['status'], n: 2 }, per_key_hour: 20 } })).not.toContain('ENDPOINT_COLUMN_UNKNOWN:status');
  });

  it('counts a looser cap on a stranger\u2019s create as a widening, and a tighter one not', () => {
    const doc = (anonymous?: Record<string, unknown>) =>
      ({ version: 1, side: 'customer', resources: [{ ref: 'visits', table: 'public.visits', actions: ['create'], expose: ['id'], where: [], writable: ['status'], ...(anonymous === undefined ? {} : { anonymous }) }] }) as never;
    const caps = { perValue: { columns: ['mobile', 'email'], n: 2 }, perKeyHour: 20, plainText: ['name'] };
    const rows = (before: unknown, after: never) => wideningOf(before, after).map((w) => w.rows);
    expect(rows(doc(caps), doc({ ...caps, perKeyHour: 10, perValue: { columns: ['mobile', 'email', 'phone'], n: 1 } }))).toEqual([]);
    expect(rows(doc(caps), doc())).toEqual([true]);
    expect(rows(doc(caps), doc({ ...caps, perKeyHour: 40 }))).toEqual([true]);
    expect(rows(doc(caps), doc({ ...caps, perValue: { columns: ['mobile'], n: 2 } }))).toEqual([true]);
    expect(rows(doc(caps), doc({ ...caps, plainText: undefined }))).toEqual([true]);
    expect(rows(doc(), doc(caps))).toEqual([]);
  });

  it('counts a loosened write as a widening of the rows a key reaches', () => {
    const doc = (resource: Record<string, unknown>) =>
      ({ version: 1, side: 'customer', resources: [{ ref: 'visits', table: 'public.visits', actions: ['read', 'update'], expose: ['id'], where: [], writable: ['status'], ...resource }] }) as never;
    const pinned = { writableValues: { status: ['cancelled'] }, writableWhen: { status: ['booked'], starts_at: 'from-now' } };
    expect(wideningOf(doc(pinned), doc(pinned))).toEqual([]);
    // Narrower is not wider.
    expect(wideningOf(doc(pinned), doc({ ...pinned, writableWhen: { ...pinned.writableWhen, clinician_id: [1] } }))).toEqual([]);
    for (const looser of [
      { ...pinned, writableValues: { status: ['cancelled', 'seen'] } },
      { writableWhen: pinned.writableWhen },
      { ...pinned, writableWhen: { status: ['booked'] } },
    ]) {
      expect(wideningOf(doc(pinned), doc(looser))).toEqual([{ ref: 'visits', methods: [], columns: [], rows: true }]);
    }
  });

  it('compiles a calendar filter to be worked out later, and never to a frozen date', () => {
    const scope = compileScope({
      version: 1,
      side: 'customer',
      timezone: 'Europe/London',
      resources: [
        {
          ref: 'visits',
          table: 'public.visits',
          actions: ['read'],
          expose: ['id', 'starts_at'],
          where: [
            { column: 'status', op: 'eq', value: 'booked' },
            { column: 'starts_at', op: 'from-today', days: 2 },
          ],
        },
      ],
    });
    expect(scope.byRef.get('visits')?.where).toEqual({
      fixed: { column: 'status', op: 'eq', value: 'booked' },
      relative: [{ column: 'starts_at', op: 'from-today', days: 2 }],
    });
  });
});
