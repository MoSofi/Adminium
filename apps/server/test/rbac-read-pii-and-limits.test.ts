// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The grammar's `read_pii` action and the update limits, below the routes:
 * what a stored grant is taken to mean, and how limits from several roles
 * add up.
 */
import BetterSqlite3 from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { createSqliteMetaDb, firstRun, permissionsRepo, rolesRepo } from '@adminium/meta';

import { AppError } from '../src/errors.js';
import { grantMatches, grantsFromMatrixRows, isGranted, matrixRowsFromGrants, parseGrant } from '../src/rbac/permissions.js';
import { resolveForRoles } from '../src/rbac/resolver.js';
import { assertWithinLimit, mergeLimits, updateLimitOf } from '../src/rbac/update-limits.js';

describe('read_pii in the permission grammar', () => {
  it('parses by name and round-trips through the matrix', () => {
    expect(parseGrant('table:conn:main.patients:read_pii')).toMatchObject({ kind: 'table', action: 'read_pii' });
    const { rows, invalid } = matrixRowsFromGrants(['table:conn:main.patients:read', 'table:conn:main.patients:read_pii']);
    expect(invalid).toEqual([]);
    expect(grantsFromMatrixRows(rows.map((row, i) => ({ id: String(i), roleId: 'r', ...row })))).toEqual([
      'table:conn:main.patients:read',
      'table:conn:main.patients:read_pii',
    ]);
  });

  it('is never stood for by a `*` action, stored or saved', () => {
    expect(grantMatches('table:*:*:*', 'table:conn:main.patients:read_pii')).toBe(false);
    expect(grantMatches('table:conn:main.patients:*', 'table:conn:main.patients:read_pii')).toBe(false);
    expect(grantMatches('table:conn:main.patients:*', 'table:conn:main.patients:update')).toBe(true);
    // A wildcard on the table and connection, with the action named, does reach every table.
    expect(isGranted(new Set(['table:*:*:read_pii']), 'table:conn:main.patients:read_pii')).toBe(true);
    const [row] = matrixRowsFromGrants(['table:conn:main.patients:*']).rows;
    expect(row?.actions).toMatchObject({ read: true, update: true, import: true });
    expect((row?.actions as { read_pii?: boolean }).read_pii).not.toBe(true);
  });
});

describe('update limits', () => {
  const status = { writable: ['status'], writableValues: { status: ['roomed', 'ready'] } };

  it('add up across roles: a column or a value either allows is allowed', () => {
    expect(mergeLimits([status, { writable: ['status'], writableValues: { status: ['with_clinician'] } }])).toEqual({
      writable: ['status'],
      writableValues: { status: ['roomed', 'ready', 'with_clinician'] },
    });
    expect(mergeLimits([status, { writable: ['status', 'note'] }])).toEqual({ writable: ['status', 'note'] });
  });

  it('refuse a column or a value outside the limit, and let an unchanged column through', () => {
    const refusal = (values: Record<string, unknown>, before?: Record<string, unknown>) => {
      try {
        assertWithinLimit(status, 'main.visits', values, before);
        return null;
      } catch (error) {
        return (error as AppError).details;
      }
    };
    expect(refusal({ status: 'roomed' })).toBeNull();
    expect(refusal({ status: 'cancelled' })).toMatchObject({ column: 'status', value: 'cancelled' });
    expect(refusal({ note: 'x' })).toMatchObject({ column: 'note' });
    expect(refusal({ note: 'x', status: 'ready' }, { note: 'x', status: 'booked' })).toBeNull();
    expect(refusal({ starts_at: '2026-09-24T10:00:00.000Z' }, { starts_at: new Date('2026-09-24T10:00:00Z') })).toBeNull();
    expect(refusal({ status: 'booked' }, { status: 'booked' })).toBeNull();
    expect(() => assertWithinLimit(null, 'main.visits', { anything: 1 })).not.toThrow();
  });

  it('bind only someone every one of whose update grants on the table is limited', async () => {
    const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    const roles = rolesRepo(meta);
    const permissions = permissionsRepo(meta);
    const actions = { read: true, create: false, update: true, delete: false, export: false, import: false };
    const clinician = await roles.create({ slug: 'clinician', name: 'Clinician' });
    await permissions.grant(clinician.id, 'table', 'conn/main.visits', { ...actions, updateLimit: status });
    const manager = await roles.create({ slug: 'manager', name: 'Manager' });
    await permissions.grant(manager.id, 'table', 'conn/main.visits', actions);
    const everyTable = await roles.create({ slug: 'everything', name: 'Everything' });
    await permissions.grant(everyTable.id, 'table', '*/*', actions);

    const limited = await resolveForRoles(meta, [clinician]);
    expect(updateLimitOf(limited, 'conn', 'main.visits')).toEqual(status);
    expect(updateLimitOf(limited, 'conn', 'main.other')).toBeNull();
    expect(updateLimitOf(await resolveForRoles(meta, [clinician, manager]), 'conn', 'main.visits')).toBeNull();
    expect(updateLimitOf(await resolveForRoles(meta, [clinician, everyTable]), 'conn', 'main.visits')).toBeNull();
    const superAdmin = (await roles.findBySlug('super-admin'))!;
    expect(updateLimitOf(await resolveForRoles(meta, [clinician, superAdmin]), 'conn', 'main.visits')).toBeNull();
    // A set built without limits (a route test's fake) limits nothing.
    expect(updateLimitOf({ superAdmin: false }, 'conn', 'main.visits')).toBeNull();
    await meta.db.destroy();
  });
});
