// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A ROW TAKES A RESOURCE FOR A TIME (`occupies` on a table): what the
 * manifest check accepts and what it refuses, and the release an app that
 * says it asks for.
 */
import { describe, expect, it } from 'vitest';

import { installFloorWords, validateManifest } from '../src/index.js';

const id = { ref: 'id', type: 'int', role: 'pk' };
const WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const bookings = (occupies: unknown, more: Record<string, unknown> = {}) => ({
  ref: 'bookings',
  indexes: [['space_id']],
  columns: [
    id,
    { ref: 'space_id', type: 'fk', references: 'spaces', nullable: true },
    { ref: 'starts_at', type: 'timestamptz', nullable: true },
    { ref: 'ends_at', type: 'timestamptz', nullable: true },
    { ref: 'day', type: 'date', nullable: true },
    { ref: 'minutes', type: 'int', default: 60 },
    { ref: 'note', type: 'text', maxLength: 80, nullable: true },
    { ref: 'state', type: 'enum', enum: ['tentative', 'confirmed', 'cancelled'], default: 'tentative' },
  ],
  ...(occupies === undefined ? {} : { occupies }),
  ...more,
});

function app(table: Record<string, unknown>, floor = '0.3.28'): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'crm',
    name: 'CRM',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    description: { key: 'd', fallback: 'A CRM' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: floor },
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'spaces', columns: [id, { ref: 'name', type: 'text', maxLength: 40 }] },
        { ref: 'crews', columns: [id, { ref: 'name', type: 'text', maxLength: 40 }] },
        {
          ref: 'space_days',
          indexes: [['space_id']],
          columns: [id, { ref: 'space_id', type: 'fk', references: 'spaces' }, { ref: 'crew_id', type: 'fk', references: 'crews', nullable: true }, { ref: 'weekday', type: 'enum', enum: WEEK }, { ref: 'kind', type: 'enum', enum: ['open', 'shut'], default: 'open' }, { ref: 'opens', type: 'text', maxLength: 5, nullable: true }, { ref: 'closes', type: 'text', maxLength: 5, nullable: true }],
        },
        table,
      ],
    },
    pages: [{ ref: 'crm-bookings', template: 'page-crud', title: { key: 't', fallback: 'Bookings' }, nav: { group: 'library', icon: 'list', order: 1 }, bindings: { rows: 'bookings' } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  };
}

const said = (doc: Record<string, unknown>): string => {
  const result = validateManifest(doc);
  return result.ok ? '' : result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n');
};

const COUNTED = { column: 'state', values: ['tentative', 'confirmed'] };
const HOURS = { table: 'space_days', resource: 'space_id', weekday: 'weekday' };

describe('a table whose rows take a resource for a time', () => {
  it('takes a start with its minutes, a start with its end, and a whole day', () => {
    expect(said(app(bookings({ resource: 'space_id', start: 'starts_at', minutes: 'minutes', countWhere: COUNTED })))).toBe('');
    expect(said(app(bookings({ resource: 'space_id', start: 'starts_at', end: 'ends_at' })))).toBe('');
    expect(said(app(bookings({ resource: 'space_id', day: 'day' })))).toBe('');
    // What is taken need not be a link: any column that names it.
    expect(said(app(bookings({ resource: 'note', day: 'day' })))).toBe('');
  });

  it('takes the hours a resource works, with or without an opening and a closing time, and rows that share them', () => {
    expect(said(app(bookings({ resource: 'space_id', start: 'starts_at', minutes: 'minutes', hours: { ...HOURS, opens: 'opens', closes: 'closes' } })))).toBe('');
    expect(said(app(bookings({ resource: 'space_id', day: 'day', shared: true, hours: HOURS })))).toBe('');
  });

  it('refuses a time that is not one of the three shapes', () => {
    expect(said(app(bookings({ resource: 'space_id' })))).toContain('a `start` or a whole `day`');
    expect(said(app(bookings({ resource: 'space_id', start: 'starts_at', day: 'day' })))).toContain('a `start` or a whole `day`');
    expect(said(app(bookings({ resource: 'space_id', start: 'starts_at' })))).toContain('its `minutes` or its `end`');
    expect(said(app(bookings({ resource: 'space_id', start: 'starts_at', minutes: 'minutes', end: 'ends_at' })))).toContain('its `minutes` or its `end`');
    expect(said(app(bookings({ resource: 'space_id', day: 'day', minutes: 'minutes' })))).toContain('no `minutes` and no `end`');
  });

  it('refuses rows that share the time with no hours to judge, and half an opening time', () => {
    expect(said(app(bookings({ resource: 'space_id', day: 'day', shared: true })))).toContain('`hours` alone');
    expect(said(app(bookings({ resource: 'space_id', day: 'day', hours: { ...HOURS, opens: 'opens' } })))).toContain('or neither');
  });

  it('refuses a column that is not there, or is of the wrong kind', () => {
    expect(said(app(bookings({ resource: 'room_id', day: 'day' })))).toContain('"bookings" has no column "room_id"');
    expect(said(app(bookings({ resource: 'space_id', start: 'day', minutes: 'minutes' })))).toContain('"bookings.day" must be a timestamptz');
    expect(said(app(bookings({ resource: 'space_id', start: 'starts_at', minutes: 'note' })))).toContain('"bookings.note" must be an int');
    expect(said(app(bookings({ resource: 'space_id', day: 'starts_at' })))).toContain('"bookings.starts_at" must be a date');
    expect(said(app(bookings({ resource: 'space_id', day: 'day', countWhere: { column: 'state', values: ['booked'] } })))).toContain('"booked" is not a value of "bookings.state"');
    expect(said(app(bookings({ resource: 'space_id', day: 'day', countWhere: { column: 'status', values: ['booked'] } })))).toContain('"bookings" has no column "status"');
  });

  it('refuses hours that are not a week of the same resource', () => {
    expect(said(app(bookings({ resource: 'space_id', day: 'day', hours: { ...HOURS, table: 'opening' } })))).toContain('"opening" is not a table of this app');
    // A crew's week says nothing of a space.
    expect(said(app(bookings({ resource: 'space_id', day: 'day', hours: { ...HOURS, resource: 'crew_id' } })))).toContain('does not name what "bookings.space_id" names');
    expect(said(app(bookings({ resource: 'space_id', day: 'day', hours: { ...HOURS, weekday: 'kind' } })))).toContain('must be an enum of mon, tue');
    expect(said(app(bookings({ resource: 'space_id', start: 'starts_at', minutes: 'minutes', hours: { ...HOURS, opens: 'weekday', closes: 'closes' } })))).toContain('a text column holding HH:MM');
    expect(said(app(bookings({ resource: 'space_id', day: 'day', hours: { table: 'bookings', resource: 'space_id', weekday: 'state' } })))).toContain('a table of their own');
  });

  it('refuses a key it does not know', () => {
    expect(said(app(bookings({ resource: 'space_id', day: 'day', grid: 15 })))).not.toBe('');
  });

  it('asks for the release that runs it', () => {
    const doc = app(bookings({ resource: 'space_id', day: 'day' }));
    expect(installFloorWords(doc).map((found) => found.word)).toContain('table.occupies');
    expect(said(app(bookings({ resource: 'space_id', day: 'day' }), '0.3.26'))).toContain('0.3.28');
    expect(installFloorWords(app(bookings(undefined))).map((found) => found.word)).not.toContain('table.occupies');
  });
});
