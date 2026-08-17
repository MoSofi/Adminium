// SPDX-License-Identifier: AGPL-3.0-only
/** Unit tests for the §5.1 permission grammar (src/rbac/permissions.ts). */
import { describe, expect, it } from 'vitest';

import {
  PERMISSIONS,
  grantMatches,
  grantsFromMatrixRows,
  isGranted,
  matrixRowsFromGrants,
  parseGrant,
  parsePermission,
} from '../src/rbac/permissions.js';
import {
  GRANTABLE_SYSTEM_ACTION_KEYS,
  RESERVED_SYSTEM_ACTION_KEYS,
  SYSTEM_ACTION_KEYS,
  type RolePermission,
} from '@adminium/meta';

describe('parseGrant / parsePermission', () => {
  it('parses system grants against the closed set', () => {
    expect(parseGrant('system:users:manage')).toEqual({ kind: 'system', area: 'users', verb: 'manage' });
    expect(parseGrant('system:api-keys:manage')).toEqual({
      kind: 'system',
      area: 'api-keys',
      verb: 'manage',
    });
    expect(parseGrant('system:audit:read')).toEqual({ kind: 'system', area: 'audit', verb: 'read' });
    // Unknown key, wildcard, or wrong arity → null.
    expect(parseGrant('system:unknown:manage')).toBeNull();
    expect(parseGrant('system:*:manage')).toBeNull();
    expect(parseGrant('system:users')).toBeNull();
  });

  it('parses table grants with qualified names and wildcards', () => {
    expect(parseGrant('table:conn_1:public.orders:read')).toEqual({
      kind: 'table',
      connectionId: 'conn_1',
      table: 'public.orders',
      action: 'read',
    });
    expect(parseGrant('table:*:*:read')).toEqual({
      kind: 'table',
      connectionId: '*',
      table: '*',
      action: 'read',
    });
    expect(parseGrant('table:conn_1:public.orders:drop')).toBeNull();
    expect(parseGrant('table:conn_1:public.orders')).toBeNull();
  });

  it('parses page grants', () => {
    expect(parseGrant('page:page_42:view')).toEqual({ kind: 'page', pageId: 'page_42', action: 'view' });
    expect(parseGrant('page:page_42:destroy')).toBeNull();
  });

  it('rejects junk: empty segments, whitespace, unknown kinds', () => {
    for (const bad of ['', 'nonsense', 'table:::read', 'system: users:manage', 'page::view', 'table:a:b:read:extra']) {
      expect(parseGrant(bad), bad).toBeNull();
    }
  });

  it('round-trips every SYSTEM_ACTION_KEYS entry through the grant grammar', () => {
    // The closed set and the grammar must agree: every dotted key becomes a
    // `system:<area>:<verb>` grant that parses back to the same key. This is
    // what keeps a new milestone's key (e.g. `exports.manage`, wave 2)
    // grantable the moment it lands in meta — a key that fails this test is a
    // permission nobody can ever hold.
    for (const key of SYSTEM_ACTION_KEYS) {
      const dot = key.lastIndexOf('.');
      const area = key.slice(0, dot);
      const verb = key.slice(dot + 1);
      const grant = `system:${area}:${verb}`;
      expect(parseGrant(grant), grant).toEqual({ kind: 'system', area, verb });
      expect(parsePermission(grant), grant).toEqual({ kind: 'system', area, verb });
    }
    // And the wave-2 keys specifically exist in the set.
    expect(SYSTEM_ACTION_KEYS).toContain('exports.manage');
    expect(SYSTEM_ACTION_KEYS).toContain('imports.manage');
    expect(SYSTEM_ACTION_KEYS).toContain('reports.manage');
    // The jobs keys (08 §2.17): routes/jobs + the realtime hub enforce
    // system:jobs:read|manage, so both MUST be in the closed set or the
    // grant is unparseable and no role can ever hold it.
    expect(SYSTEM_ACTION_KEYS).toContain('jobs.read');
    expect(SYSTEM_ACTION_KEYS).toContain('jobs.manage');
  });

  it('keeps the four reserved deferred keys in the grammar but out of every offered list', () => {
    // The reservation contract (meta RESERVED_SYSTEM_ACTION_KEYS): the keys
    // stay parseable — stored grants for them must keep round-tripping — but
    // no surface that OFFERS permissions may list them, because nothing in v1
    // enforces them and a grantable no-op is misleading security UI.
    expect([...RESERVED_SYSTEM_ACTION_KEYS].sort()).toEqual(
      ['automations.manage', 'manifests.manage', 'sql.run', 'webhooks.manage'].sort(),
    );

    for (const key of RESERVED_SYSTEM_ACTION_KEYS) {
      const dot = key.lastIndexOf('.');
      const grant = `system:${key.slice(0, dot)}:${key.slice(dot + 1)}`;
      // Grammar retained: a role that already holds the grant still parses…
      expect(parseGrant(grant), grant).not.toBeNull();
      // …and it round-trips through the matrix mapping (PUT/GET permissions).
      const { rows, invalid } = matrixRowsFromGrants([grant]);
      expect(invalid, grant).toEqual([]);
      const back = grantsFromMatrixRows(
        rows.map((row, i) => ({ id: `perm_${i}`, roleId: 'role_x', ...row })) as RolePermission[],
      );
      expect(back, grant).toEqual([grant]);
      // …but the authored grantable list never offers it.
      expect(GRANTABLE_SYSTEM_ACTION_KEYS, key).not.toContain(key);
    }

    // The non-reserved keys are all still offered (grantable ∪ reserved = closed set).
    expect([...GRANTABLE_SYSTEM_ACTION_KEYS, ...RESERVED_SYSTEM_ACTION_KEYS].sort()).toEqual(
      [...SYSTEM_ACTION_KEYS].sort(),
    );

    // Regression net: every canonical enforced permission maps to a GRANTABLE
    // key. The moment someone routes a guard through a reserved key, this
    // fails and forces the key out of the reserved list in the same change.
    for (const grant of Object.values(PERMISSIONS)) {
      const [, area, verb] = grant.split(':');
      expect(GRANTABLE_SYSTEM_ACTION_KEYS, grant).toContain(`${area}.${verb}`);
    }
  });

  it('jobs grants parse, match, and round-trip through matrix rows', () => {
    expect(parseGrant('system:jobs:read')).toEqual({ kind: 'system', area: 'jobs', verb: 'read' });
    expect(parseGrant('system:jobs:manage')).toEqual({ kind: 'system', area: 'jobs', verb: 'manage' });
    expect(isGranted(new Set(['system:jobs:read']), 'system:jobs:read')).toBe(true);
    expect(isGranted(new Set(['system:jobs:read']), 'system:jobs:manage')).toBe(false);

    const { rows, invalid } = matrixRowsFromGrants(['system:jobs:read', 'system:jobs:manage']);
    expect(invalid).toEqual([]);
    expect(rows.map((row) => row.resourceRef).sort()).toEqual(['jobs.manage', 'jobs.read']);
    const back = grantsFromMatrixRows(
      rows.map((row, i) => ({ id: `perm_${i}`, roleId: 'role_x', ...row })) as RolePermission[],
    );
    expect(new Set(back)).toEqual(new Set(['system:jobs:read', 'system:jobs:manage']));
  });

  it('parsePermission refuses wildcards (checks are concrete)', () => {
    expect(parsePermission('table:*:*:read')).toBeNull();
    expect(parsePermission('table:conn_1:public.orders:*')).toBeNull();
    expect(parsePermission('table:conn_1:public.orders:read')).not.toBeNull();
  });
});

describe('grantMatches / isGranted', () => {
  it('matches wildcard table grants segment-wise', () => {
    expect(grantMatches('table:*:*:read', 'table:conn_1:public.orders:read')).toBe(true);
    expect(grantMatches('table:conn_1:*:read', 'table:conn_1:public.orders:read')).toBe(true);
    expect(grantMatches('table:*:*:read', 'table:conn_1:public.orders:update')).toBe(false);
    expect(grantMatches('table:conn_2:*:read', 'table:conn_1:public.orders:read')).toBe(false);
    expect(grantMatches('table:conn_1:public.orders:*', 'table:conn_1:public.orders:delete')).toBe(true);
  });

  it('deny-by-default: unknown or malformed never matches', () => {
    const grants = new Set(['system:users:manage', 'table:*:*:read']);
    expect(isGranted(grants, 'system:users:manage')).toBe(true);
    expect(isGranted(grants, 'table:conn_9:crm.leads:read')).toBe(true);
    expect(isGranted(grants, 'system:roles:manage')).toBe(false);
    expect(isGranted(grants, 'table:conn_9:crm.leads:delete')).toBe(false);
    expect(isGranted(grants, 'not-a-permission')).toBe(false);
    expect(isGranted(new Set(), 'system:users:manage')).toBe(false);
  });
});

describe('matrix-row mapping', () => {
  it('round-trips grants → rows → grants', () => {
    const grants = [
      'system:audit:read',
      'table:conn_1:public.orders:read',
      'table:conn_1:public.orders:update',
      'page:page_42:view',
    ];
    const { rows, invalid } = matrixRowsFromGrants(grants);
    expect(invalid).toEqual([]);
    // Same-cell grants merge into one row.
    expect(rows).toHaveLength(3);
    const tableRow = rows.find((row) => row.resourceKind === 'table');
    expect(tableRow?.resourceRef).toBe('conn_1/public.orders');
    expect(tableRow?.actions).toMatchObject({ read: true, update: true, create: false, delete: false });

    const back = grantsFromMatrixRows(
      rows.map((row, i) => ({ id: `perm_${i}`, roleId: 'role_x', ...row })) as RolePermission[],
    );
    expect(new Set(back)).toEqual(new Set(grants));
  });

  it('collects invalid grants instead of throwing', () => {
    const { rows, invalid } = matrixRowsFromGrants(['system:audit:read', 'bogus', 'system:nope:manage']);
    expect(rows).toHaveLength(1);
    expect(invalid).toEqual(['bogus', 'system:nope:manage']);
  });

  it('expands action wildcards into full table rows', () => {
    const { rows } = matrixRowsFromGrants(['table:conn_1:public.orders:*']);
    expect(rows[0]?.actions).toEqual({
      read: true,
      create: true,
      update: true,
      delete: true,
      export: true,
      import: true,
    });
  });
});
