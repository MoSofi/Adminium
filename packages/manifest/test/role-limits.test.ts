// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A role's `limits`: what its update on one of the app's tables may write.
 * One valid manifest, then each test breaks one reference and reads the
 * sentence that names it.
 */
import { describe, expect, it } from 'vitest';

import { installFloorWords, validateManifest } from '../src/index.js';

const id = { ref: 'id', type: 'int', role: 'pk' };

function manifest(roles: unknown[], floor = '0.1.0') {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'desk',
    name: 'Front Desk',
    version: '1.0.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'AGPL-3.0-only',
    description: { key: 'd', fallback: 'A front desk.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: floor },
    requiredSchema: {
      tables: [
        { ref: 'patients', columns: [id, { ref: 'mobile', type: 'text', maxLength: 20 }] },
        {
          ref: 'appointments',
          columns: [
            id,
            { ref: 'status', type: 'enum', enum: ['booked', 'roomed', 'ready', 'cancelled'] },
            { ref: 'note', type: 'text', maxLength: 200, nullable: true },
          ],
        },
      ],
    },
    pages: [{ ref: 'desk-visits', template: 'page-crud', title: { key: 't', fallback: 'Visits' }, nav: { group: 'library', icon: 'list', order: 1 }, bindings: { rows: 'appointments' } }],
    roles,
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  };
}

const clinician = {
  key: 'clinician',
  name: 'Clinician',
  permissions: ['table:@appointments:read', 'table:@appointments:update', 'table:@patients:read_pii'],
  limits: { appointments: { writable: ['status'], writableValues: { status: ['roomed', 'ready'] } } },
};

const messages = (roles: unknown[], floor?: string) => {
  const result = validateManifest(manifest(roles, floor));
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.message}`);
};

describe('a role’s limits', () => {
  it('validate when they narrow the role’s own update, or the one it clones', () => {
    expect(messages([clinician])).toEqual([]);
    expect(messages([clinician, { key: 'locum', name: 'Locum', cloneFrom: 'clinician', limits: { appointments: { writable: ['status', 'note'] } } }])).toEqual([]);
  });

  it('name a table, a column or a value the app does not have', () => {
    expect(messages([{ ...clinician, limits: { visits: { writable: ['status'] } } }])).toEqual([
      'roles.0.limits.visits: "visits" is not a table of this app',
    ]);
    expect(messages([{ ...clinician, limits: { appointments: { writable: ['stage'] } } }])).toEqual([
      'roles.0.limits.appointments.writable: "appointments" has no column "stage"',
    ]);
    expect(messages([{ ...clinician, limits: { appointments: { writable: ['status'], writableValues: { status: ['gone'] } } } }])).toEqual([
      'roles.0.limits.appointments.writableValues.status: "gone" is not a value of "appointments.status"',
    ]);
  });

  it('refuse values for a column the limit does not let the role write', () => {
    expect(messages([{ ...clinician, limits: { appointments: { writable: ['note'], writableValues: { status: ['ready'] } } } }])).toEqual([
      'roles.0.limits.appointments.writableValues.status: "status" is not writable',
    ]);
  });

  it('refuse a limit on a table the role cannot update', () => {
    expect(messages([{ ...clinician, limits: { patients: { writable: ['mobile'] } } }])).toEqual([
      'roles.0.limits.patients: the role does not grant table:@patients:update, so there is nothing to limit',
    ]);
  });

  it('refuse an empty column list and an unknown key', () => {
    expect(messages([{ ...clinician, limits: { appointments: { writable: [] } } }]).length).toBeGreaterThan(0);
    expect(messages([{ ...clinician, limits: { appointments: { writable: ['status'], columns: ['status'] } } }]).length).toBeGreaterThan(0);
  });
});

describe('a role’s read of a table limited to some columns', () => {
  const housekeeping = {
    key: 'housekeeping',
    name: 'Housekeeping',
    permissions: ['table:@appointments:read'],
    limits: { appointments: { readable: ['status'] } },
  };
  it('validates on the role’s own read, alone or beside what its update writes', () => {
    expect(messages([housekeeping])).toEqual([]);
    expect(messages([{ ...clinician, limits: { appointments: { writable: ['status', 'note'], readable: ['status'] } } }])).toEqual([]);
  });
  it('refuses a read the role does not grant, a column the table lacks, one named twice, and a limit of nothing', () => {
    expect(messages([{ ...housekeeping, permissions: ['table:@patients:read'] }]).join('\n')).toContain('does not grant table:@appointments:read');
    expect(messages([{ ...housekeeping, limits: { appointments: { readable: ['nope'] } } }]).join('\n')).toContain('"appointments" has no column "nope"');
    expect(messages([{ ...housekeeping, limits: { appointments: { readable: ['status', 'status'] } } }]).join('\n')).toContain('"status" is listed twice');
    expect(messages([{ ...housekeeping, limits: { appointments: {} } }]).join('\n')).toContain('(writable), read (readable) or create with (creatable)');
    expect(messages([{ ...housekeeping, limits: { appointments: { readable: [] } } }])).not.toEqual([]);
    expect(messages([{ ...housekeeping, limits: { appointments: { readable: ['status'], writableValues: { status: ['ready'] } } } }]).join('\n')).toContain('name them (writable)');
  });
});

describe('a role’s create on a table limited to some columns', () => {
  const kiosk = { key: 'kiosk', name: 'Kiosk', permissions: ['table:@appointments:create'], limits: { appointments: { creatable: ['note'], creatableValues: { note: ['walk-in'] } } } };
  it('takes the columns and values a new row may be given', () => {
    expect(messages([kiosk])).toEqual([]);
  });
  it('refuses a create the role does not grant, a column the table lacks, and values for a column not creatable', () => {
    expect(messages([{ ...kiosk, permissions: ['table:@appointments:read'] }]).join('\n')).toContain('does not grant table:@appointments:create');
    expect(messages([{ ...kiosk, limits: { appointments: { creatable: ['nope'] } } }]).join('\n')).toContain('"appointments" has no column "nope"');
    expect(messages([{ ...kiosk, limits: { appointments: { creatable: ['note'], creatableValues: { status: ['ready'] } } } }]).join('\n')).toContain('"status" is not creatable');
    expect(messages([{ ...kiosk, limits: { appointments: { creatableValues: { note: ['x'] } } } }]).join('\n')).toContain('name them (creatable)');
  });
});

describe('the rows a role’s update reaches, by what a column holds now', () => {
  const from = (writableFrom: unknown, more: Record<string, unknown> = { writable: ['status'] }) => [{ ...clinician, limits: { appointments: { ...more, writableFrom } } }];

  it('takes values of a column of the table, written or not, from the release that reads it', () => {
    expect(messages(from({ status: ['booked', 'roomed'] }), '0.3.19')).toEqual([]);
    // The column the row is judged by need not be one the role writes.
    expect(messages(from({ status: ['booked'] }, { writable: ['note'] }), '0.3.19')).toEqual([]);
    expect(messages(from({ status: ['booked'] }, { writable: ['status'], writableValues: { status: ['roomed', 'ready'] } }), '0.3.19')).toEqual([]);
  });

  it('names a column the table lacks and a value the column cannot hold', () => {
    expect(messages(from({ stage: ['booked'] }), '0.3.19').join('\n')).toContain('"appointments" has no column "stage"');
    expect(messages(from({ status: ['seen'] }), '0.3.19').join('\n')).toContain('"seen" is not a value of "appointments.status"');
  });

  it('is refused with nothing to narrow, with no column, with no value and past 32 values', () => {
    expect(messages(from({ status: ['booked'] }, { readable: ['status'] }), '0.3.19').join('\n')).toContain('name the columns it may write (writable)');
    expect(messages(from({}), '0.3.19').join('\n')).toContain('name at least one column the row is judged by');
    expect(messages(from({ status: [] }), '0.3.19').length).toBeGreaterThan(0);
    expect(messages(from({ note: Array.from({ length: 33 }, (_, i) => `n${String(i)}`) }), '0.3.19').length).toBeGreaterThan(0);
  });

  it('needs the release that reads it: the one before refuses the key as unknown', () => {
    const doc = manifest(from({ status: ['booked'] }), '0.3.18');
    expect(installFloorWords(doc)).toContainEqual({ word: 'roles.writableFrom', path: 'roles.0.limits.appointments.writableFrom' });
    expect(messages(from({ status: ['booked'] }), '0.3.18').join('\n')).toContain('"roles.writableFrom" is read by Adminium 0.3.19 and later, and compatibility.minAdminiumVersion is 0.3.18: set it to 0.3.19 or later');
    expect(messages([clinician], '0.3.18')).toEqual([]);
  });

  it('is named on a grant of an add-on’s table too, where the grant updates and says what it writes', () => {
    const grant = (limit: unknown, actions = ['read', 'update']) => ({ ...manifest([{ key: 'desk', name: 'Desk', permissions: ['table:@appointments:read'], tables: [{ addOn: 'kit', table: 'items', actions, limit }] }], '0.3.19'), addOns: { suggests: [{ key: 'kit', range: '>=1.0.0', reason: { 'en-US': 'Stock.' } }] } });
    const said = (doc: unknown) => {
      const result = validateManifest(doc);
      return result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.message}`);
    };
    expect(said(grant({ writable: ['note'], writableFrom: { state: ['open'] } }))).toEqual([]);
    expect(installFloorWords(grant({ writable: ['note'], writableFrom: { state: ['open'] } }))).toContainEqual({ word: 'roles.writableFrom', path: 'roles.0.tables.0.limit.writableFrom' });
    expect(said(grant({ readable: ['note'], writableFrom: { state: ['open'] } }, ['read'])).join('\n')).toContain('the grant has no "update", so there is nothing for "writableFrom" to limit');
    expect(said(grant({ readable: ['note'], writableFrom: { state: ['open'] } })).join('\n')).toContain('name the columns it may write (writable)');
  });
});
