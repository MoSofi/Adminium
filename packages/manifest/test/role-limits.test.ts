// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A role's `limits`: what its update on one of the app's tables may write.
 * One valid manifest, then each test breaks one reference and reads the
 * sentence that names it.
 */
import { describe, expect, it } from 'vitest';

import { validateManifest } from '../src/index.js';

const id = { ref: 'id', type: 'int', role: 'pk' };

function manifest(roles: unknown[]) {
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
    compatibility: { minAdminiumVersion: '0.1.0' },
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

const messages = (roles: unknown[]) => {
  const result = validateManifest(manifest(roles));
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
