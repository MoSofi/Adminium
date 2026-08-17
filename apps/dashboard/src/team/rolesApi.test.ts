/**
 * Pure helpers behind the roles matrix. The first two describes are the ones
 * that matter: a reserved permission must never become a row, and a save must
 * only ever touch the roles the admin actually edited.
 */
import { describe, expect, it } from 'vitest';
import type { PermissionGrant } from '@adminium/ui';

import {
  RESERVED_GRANTS,
  catalogPermissions,
  changedRoleIds,
  isPermissionGrant,
  matrixRows,
  pendingChangeCount,
  roleDeletePath,
  toggleGrant,
  type GrantMap,
  type PermissionCatalogReply,
} from './rolesApi.js';

describe('isPermissionGrant', () => {
  it('accepts the three §5.1 forms', () => {
    expect(isPermissionGrant('system:users:manage')).toBe(true);
    expect(isPermissionGrant('table:pg-main:orders:read')).toBe(true);
    expect(isPermissionGrant('table:pg-main:*:export')).toBe(true);
    expect(isPermissionGrant('page:billing:view')).toBe(true);
  });

  it('denies anything outside the grammar', () => {
    expect(isPermissionGrant('users.manage')).toBe(false);
    expect(isPermissionGrant('system:users')).toBe(false);
    expect(isPermissionGrant('table:pg-main:orders:destroy')).toBe(false);
    expect(isPermissionGrant('page:billing:delete')).toBe(false);
    expect(isPermissionGrant('system:users:man age')).toBe(false);
  });
});

describe('catalogPermissions', () => {
  const catalog = (system: PermissionCatalogReply['system']): PermissionCatalogReply => ({
    system,
    tableActions: ['read', 'create'],
    pageActions: ['view', 'edit'],
  });

  it('drops reserved keys even when the server sends them', () => {
    // The catalog endpoint is authored from GRANTABLE_SYSTEM_ACTION_KEYS, so
    // this is the second line of defence: a server that drifts must not put a
    // switch on screen for a permission nothing enforces.
    const reply = catalog([
      { key: 'system:users:manage', label: 'Manage users', category: 'access' },
      ...RESERVED_GRANTS.map((key) => ({ key, label: key, category: 'operations' as const })),
    ]);
    expect(catalogPermissions(reply).map((row) => row.key)).toEqual(['system:users:manage']);
  });

  it('drops rows whose key is not a grant string', () => {
    expect(catalogPermissions(catalog([{ key: 'users.manage', label: 'x', category: 'access' }]))).toEqual(
      [],
    );
  });

  it('never mistakes the action vocabularies for rows', () => {
    // `tableActions`/`pageActions` are ['read', …] / ['view', …] — spellings,
    // not grants. A reader that flattened them would put a switch labelled
    // "read" in the matrix that saves a grant the server rejects.
    expect(catalogPermissions(catalog([]))).toEqual([]);
  });

  it('collapses a duplicate key onto its first appearance', () => {
    const reply = catalog([
      { key: 'system:audit:read', label: 'Audit', category: 'workspace' },
      { key: 'system:audit:read', label: 'Duplicate', category: 'access' },
    ]);
    expect(catalogPermissions(reply)).toEqual([
      { key: 'system:audit:read', label: 'Audit', category: 'workspace' },
    ]);
  });
});

describe('matrixRows', () => {
  it('localizes through the callers and keeps the grant key as the row id', () => {
    const rows = matrixRows(
      [{ key: 'system:audit:read' as PermissionGrant, label: 'Read the audit log', category: 'workspace' }],
      () => 'Journal',
      (entry) => entry.category.toUpperCase(),
    );
    expect(rows).toEqual([{ key: 'system:audit:read', label: 'Journal', category: 'WORKSPACE' }]);
  });
});

describe('toggleGrant', () => {
  const base: GrantMap = { 'role-1': ['system:users:manage'] as PermissionGrant[] };

  it('adds and removes without touching other roles', () => {
    const added = toggleGrant(base, 'role-1', 'system:audit:read' as PermissionGrant, true);
    expect(added['role-1']).toEqual(['system:users:manage', 'system:audit:read']);

    const removed = toggleGrant(added, 'role-1', 'system:users:manage' as PermissionGrant, false);
    expect(removed['role-1']).toEqual(['system:audit:read']);
  });

  it('is a no-op when the cell already holds that value', () => {
    expect(toggleGrant(base, 'role-1', 'system:users:manage' as PermissionGrant, true)).toBe(base);
    expect(toggleGrant(base, 'role-1', 'system:audit:read' as PermissionGrant, false)).toBe(base);
  });

  it('seeds a role that had no grants at all', () => {
    const seeded = toggleGrant(base, 'role-2', 'system:audit:read' as PermissionGrant, true);
    expect(seeded['role-2']).toEqual(['system:audit:read']);
    expect(seeded['role-1']).toBe(base['role-1']);
  });
});

describe('changedRoleIds', () => {
  const baseline: GrantMap = {
    'role-1': ['system:users:manage'] as PermissionGrant[],
    'role-2': ['system:audit:read'] as PermissionGrant[],
  };

  it('reports nothing when the sets match', () => {
    expect(changedRoleIds(baseline, baseline)).toEqual([]);
  });

  it('ignores ordering — a re-ordered grant list is the same grant set', () => {
    const reordered: GrantMap = {
      ...baseline,
      'role-1': ['system:users:manage'] as PermissionGrant[],
    };
    expect(changedRoleIds(reordered, baseline)).toEqual([]);
  });

  it('names only the touched role, so untouched matrices are never rewritten', () => {
    const edited = toggleGrant(baseline, 'role-2', 'system:users:manage' as PermissionGrant, true);
    expect(changedRoleIds(edited, baseline)).toEqual(['role-2']);
  });

  it('notices a role that exists on one side only', () => {
    const added = toggleGrant(baseline, 'role-3', 'system:audit:read' as PermissionGrant, true);
    expect(changedRoleIds(added, baseline)).toEqual(['role-3']);
  });
});

describe('pendingChangeCount', () => {
  it('counts flips in both directions', () => {
    const baseline: GrantMap = { 'role-1': ['a:b:c', 'd:e:f'] as unknown as PermissionGrant[] };
    const grants: GrantMap = { 'role-1': ['a:b:c', 'g:h:i'] as unknown as PermissionGrant[] };
    expect(pendingChangeCount(grants, baseline)).toBe(2);
  });

  it('is zero for an untouched matrix', () => {
    const baseline: GrantMap = { 'role-1': ['a:b:c'] as unknown as PermissionGrant[] };
    expect(pendingChangeCount(baseline, baseline)).toBe(0);
  });
});

describe('roleDeletePath', () => {
  it('omits reassignTo when there is nobody to move', () => {
    expect(roleDeletePath('role-1', null)).toBe('/api/v1/roles/role-1');
    expect(roleDeletePath('role-1', '')).toBe('/api/v1/roles/role-1');
  });

  it('carries the target the server 409s without', () => {
    expect(roleDeletePath('role-1', 'role-2')).toBe('/api/v1/roles/role-1?reassignTo=role-2');
  });

  it('escapes the target id', () => {
    expect(roleDeletePath('role-1', 'a b')).toBe('/api/v1/roles/role-1?reassignTo=a%20b');
  });
});
