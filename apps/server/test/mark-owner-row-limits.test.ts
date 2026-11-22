// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Which row limit is the owner's: the pure rules, and the one pass that writes
 * it down for limits stored before it was recorded.
 */
import { permissionsRepo, rolesRepo, settingsRepo, type RowLimit, type TableActions } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { markOwnerRowLimits } from '../src/apps/mark-owner-row-limits.js';
import { OWNER_ROW_LIMITS_PENDING_KEY, ownerRowsAfterEdit, ownerRowsIn, rowLimitWith } from '../src/apps/owner-row-limits.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

const own = { reach: 'own' as const };
const team = { reach: 'team' as const };

describe('whose a row limit is', () => {
  it('holds the owner over what a version declares, action by action', () => {
    expect(rowLimitWith({ read: own }, { read: team, update: team }).rows).toEqual({ read: own, update: team });
    expect(rowLimitWith(undefined, { read: team }).rows).toEqual({ read: team });
    expect(rowLimitWith(undefined, undefined).rows).toBeUndefined();
  });

  it('holds an owner\'s reach to the app\'s rows on a shared table, or does not give the action', () => {
    const ownApp = { column: 'app', in: ['shop'] };
    expect(rowLimitWith({ read: own }, { read: { reach: 'all', while: ownApp } }, ownApp).rows).toEqual({ read: { reach: 'own', while: ownApp } });
    const other: RowLimit = { read: { reach: 'own', while: { column: 'state', in: ['open'] } } };
    expect(rowLimitWith(other, { read: { reach: 'all', while: ownApp } }, ownApp)).toEqual({ rows: undefined, blocked: ['read'] });
  });

  it('records only what the owner changed, and keeps what was theirs', () => {
    const given = (): boolean => true;
    expect(ownerRowsAfterEdit({ read: team }, undefined, { read: own, update: own }, given)).toEqual({ read: own, update: own });
    expect(ownerRowsAfterEdit({ read: team }, undefined, { read: [team] }, given)).toBeUndefined();
    expect(ownerRowsAfterEdit({ read: own }, { read: own }, { read: own }, given)).toEqual({ read: own });
    expect(ownerRowsAfterEdit({ read: own }, { read: own }, { update: own }, given)).toEqual({ update: own });
    // An action the row does not give now: a save of the others says nothing about it.
    expect(ownerRowsAfterEdit({ read: own }, { read: own }, { update: own }, (action) => action !== 'read')).toEqual({ read: own, update: own });
  });

  it('tells an older limit from what the version declares, leaving out a shared table\'s own-app condition', () => {
    const ownApp = { column: 'app', in: ['shop'] };
    expect(ownerRowsIn({ read: own }, { read: own }, ownApp)).toBeUndefined();
    expect(ownerRowsIn({ read: own }, { read: team }, ownApp)).toEqual({ read: own });
    expect(ownerRowsIn({ read: { reach: 'all', while: ownApp } }, undefined, ownApp)).toBeUndefined();
    expect(ownerRowsIn({ read: { reach: 'own', while: ownApp } }, { read: own }, ownApp)).toBeUndefined();
    // Another column, or a table no app shares: somebody's word.
    const other = { reach: 'own' as const, while: { column: 'state', in: ['shop'] } };
    expect(ownerRowsIn({ read: other }, { read: own }, ownApp)).toEqual({ read: other });
    expect(ownerRowsIn({ read: { reach: 'own', while: ownApp } }, { read: own }, null)).toEqual({ read: { reach: 'own', while: ownApp } });
  });
});

const shop = (): Record<string, unknown> => ({
  kind: 'app',
  manifestVersion: 1,
  key: 'shop',
  name: 'Shop',
  version: '1.0.0',
  publisher: { id: 'adminium', name: 'Adminium' },
  license: 'MIT',
  description: { key: 'd', fallback: 'A shop.' },
  categories: ['commerce'],
  compatibility: { minAdminiumVersion: '0.3.47' },
  requiredSchema: {
    prefixed: true,
    tables: [{
      ref: 'customers',
      keyField: 'name',
      belongs: [{ column: 'owner_id', set: 'team' }],
      indexes: [['owner_id']],
      columns: [
        { ref: 'id', type: 'int', role: 'pk' },
        { ref: 'name', type: 'text', maxLength: 80, nullable: true },
        { ref: 'owner_id', type: 'text', maxLength: 36, nullable: true, rules: { staff: true } },
      ],
    }],
  },
  pages: [{ ref: 'shop-customers', template: 'page-crud', title: { key: 't', fallback: 'Customers' }, nav: { group: 'manage', icon: 'list', order: 1 }, bindings: { rows: 'customers' } }],
  frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  roles: [
    { key: 'rep', name: 'Rep', permissions: ['table:@customers:read'] },
    { key: 'clerk', name: 'Clerk', permissions: ['table:@customers:read'], limits: { customers: { rows: { read: own } } } },
  ],
});

describe.each(LEGS)('the pass over limits stored earlier — %s', (dialect, available) => {
  let h: Harness;
  const rowOf = async (key: string): Promise<{ roleId: string; ref: string; actions: TableActions }> => {
    const role = (await rolesRepo(h.meta).findBySlug(`shop-${key}`))!;
    const row = (await permissionsRepo(h.meta).listForRole(role.id)).find((one) => one.resourceKind === 'table')!;
    return { roleId: role.id, ref: row.resourceRef, actions: row.actions as TableActions };
  };
  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageApp(shop());
    const installed = await h.install('shop', '1.0.0');
    expect(installed.statusCode, installed.body).toBe(200);
  }, 240_000);
  afterAll(async () => {
    if (available) await h?.close();
  });

  it.skipIf(!available)('marks what the version does not declare, once, and leaves the app\'s own alone', async () => {
    const rep = await rowOf('rep');
    await permissionsRepo(h.meta).grant(rep.roleId, 'table', rep.ref, { ...rep.actions, rowLimit: { read: own } });
    const install = await h.meta.db.selectFrom('adminium_manifests').select('id').where('manifestKey', '=', 'shop').executeTakeFirstOrThrow();
    await settingsRepo(h.meta).set(OWNER_ROW_LIMITS_PENDING_KEY, [install.id]);
    expect(await markOwnerRowLimits({ meta: h.meta })).toBe(1);
    expect((await rowOf('rep')).actions.ownerRows).toEqual({ read: own });
    expect((await rowOf('clerk')).actions.ownerRows).toBeUndefined();
    expect(await settingsRepo(h.meta).get(OWNER_ROW_LIMITS_PENDING_KEY)).toEqual([]);
    // Once: a limit changed later is not read as an older one.
    const clerk = await rowOf('clerk');
    await permissionsRepo(h.meta).grant(clerk.roleId, 'table', clerk.ref, { ...clerk.actions, rowLimit: { read: team } });
    expect(await markOwnerRowLimits({ meta: h.meta })).toBe(0);
    expect((await rowOf('clerk')).actions.ownerRows).toBeUndefined();
  });
});
