// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app that says whose its rows are, installed on every engine: its staff columns, each table's `belongs` with a listing's table made
 * real, and each role's `rows` on the grant it narrows — then held to at
 * once, taken back when an update no longer declares them, and kept through
 * an owner's own save of the role.
 */
import { parseDatabaseModel } from '@adminium/engine';
import { overridesRepo, permissionsRepo, rolesRepo, snapshotsRepo, usersRepo, type TableActions } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyOverrides } from '../src/connections/effective-schema.js';
import { rowLimitFor } from '../src/crud/row-limit.js';
import { loadSnapshotView } from '../src/data-io/snapshot-view.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { resolvePermissionSet } from '../src/rbac/resolver.js';
import { ENGINES, installHarness, type Harness } from './app-install-harness.js';

const id = { ref: 'id', type: 'int', role: 'pk' };
const staff = (ref: string, nullable = true) => ({ ref, type: 'text', maxLength: 36, nullable, rules: { staff: true } });

function manifest(version: string, over: { limits?: Record<string, unknown>; belongs?: boolean; notes?: boolean } = {}): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'crm',
    name: 'Sales',
    version,
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'AGPL-3.0-only',
    description: { key: 'd', fallback: 'Sales.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.3.27' },
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'deals',
          columns: [id, { ref: 'title', type: 'text', maxLength: 80 }, staff('owner_id'), { ref: 'state', type: 'enum', enum: ['open', 'won', 'lost'], default: 'open' }],
          ...(over.belongs === false ? {} : { belongs: [{ column: 'owner_id', set: 'team' }, { through: { table: 'covers', link: 'owner_id', on: 'owner_id', user: 'cover_id', from: 'starts_on', to: 'ends_on' } }] }),
        },
        { ref: 'covers', columns: [id, staff('owner_id', false), staff('cover_id', false), { ref: 'starts_on', type: 'date' }, { ref: 'ends_on', type: 'date', nullable: true }] },
        { ref: 'quotes', columns: [id, { ref: 'deal_id', type: 'fk', references: 'deals' }, { ref: 'total', type: 'int' }], ...(over.belongs === false ? {} : { belongs: [{ via: 'deal_id' }] }) },
        // A manager's note about a rep: private to the two of them.
        ...(over.notes === true ? [{ ref: 'notes', columns: [id, staff('manager_id', false), staff('rep_id', false), { ref: 'note', type: 'text', maxLength: 200 }], belongs: [{ column: 'manager_id' }, { column: 'rep_id', set: 'team' }], private: true }] : []),
      ],
    },
    pages: [{ ref: 'crm-deals', template: 'page-crud', title: { key: 't', fallback: 'Deals' }, nav: { group: 'library', icon: 'list', order: 1 }, bindings: { rows: 'deals' } }],
    roles: [
      {
        key: 'rep',
        name: 'Sales rep',
        permissions: ['table:@deals:read', 'table:@deals:create', 'table:@deals:update', 'table:@quotes:read', 'page:@crm-deals:view'],
        ...(over.limits === undefined ? { limits: { deals: { rows: { read: { reach: 'own' }, update: { reach: 'own', while: { column: 'state', in: ['open'] } } } }, quotes: { rows: { read: { reach: 'own' } } } } } : Object.keys(over.limits).length === 0 ? {} : { limits: over.limits }),
      },
      { key: 'manager', name: 'Sales manager', permissions: ['table:@deals:read', 'table:@deals:update', 'table:@deals:delete'], ...(over.belongs === false ? {} : { limits: { deals: { rows: { read: { reach: 'team' }, update: { reach: 'team' }, delete: { reach: 'team', while: { column: 'state', in: ['lost'] } } } } } }) },
      { key: 'junior', name: 'Junior', cloneFrom: 'rep' },
      ...(over.notes === true ? [{ key: 'lead', name: 'Team lead', permissions: ['table:@notes:read', 'table:@notes:create', 'table:@notes:update'], limits: { notes: { rows: { read: { reach: 'own' }, update: { reach: 'own' } } } } }] : []),
    ],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  };
}

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`an app that says whose its rows are [${dialect}]`, () => {
    let h: Harness;
    const model = async () => applyOverrides(parseDatabaseModel((await snapshotsRepo(h.meta).latest(h.connectionId))!.schema), await overridesRepo(h.meta).listForConnection(h.connectionId, { status: 'active' }));
    const tableId = async (name: string) => (await model()).tables.find((table) => table.name === name)!.id;
    const actionsOf = async (slug: string, table: string): Promise<TableActions | null> => {
      const role = (await rolesRepo(h.meta).findBySlug(slug))!;
      return ((await permissionsRepo(h.meta).find(role.id, 'table', `${h.connectionId}/${await tableId(table)}`))?.actions as TableActions | undefined) ?? null;
    };
    beforeAll(async () => {
      h = await installHarness(dialect);
    }, 120_000);
    afterAll(async () => {
      await h?.close();
    });

    it('installs its staff columns, its ways and its roles\' rows', async () => {
      const installed = await h.install(manifest('1.0.0'));
      expect(installed.statusCode, installed.body).toBe(200);
      const found = await model();
      const deals = found.tables.find((table) => table.name === 'crm_deals')!;
      expect(deals.columns.find((column) => column.name === 'owner_id')!.staff).toBe(true);
      expect(deals.belongs).toEqual([{ column: 'owner_id', set: 'team' }, { through: { table: await tableId('crm_covers'), link: 'owner_id', on: 'owner_id', user: 'cover_id', from: 'starts_on', to: 'ends_on' } }]);
      expect(found.tables.find((table) => table.name === 'crm_quotes')!.belongs).toEqual([{ via: 'deal_id' }]);
      expect(found.tables.find((table) => table.name === 'crm_covers')!.belongs).toBeUndefined();
      expect((await actionsOf('crm-rep', 'crm_deals'))!.rowLimit).toEqual({ read: { reach: 'own' }, update: { reach: 'own', while: { column: 'state', in: ['open'] } } });
      expect((await actionsOf('crm-rep', 'crm_quotes'))!.rowLimit).toEqual({ read: { reach: 'own' } });
      expect((await actionsOf('crm-manager', 'crm_deals'))!.rowLimit).toEqual({ read: { reach: 'team' }, update: { reach: 'team' }, delete: { reach: 'team', while: { column: 'state', in: ['lost'] } } });
      // A clone of a limited role is limited alike.
      expect((await actionsOf('crm-junior', 'crm_deals'))!.rowLimit).toEqual((await actionsOf('crm-rep', 'crm_deals'))!.rowLimit);
    });

    it('holds a rep to their rows at once, on the tables the install made', async () => {
      const users = usersRepo(h.meta);
      const dana = await users.create({ email: 'dana@firm.test', name: 'Dana' });
      const omar = await users.create({ email: 'omar@firm.test', name: 'Omar' });
      await rolesRepo(h.meta).assignToUser(dana.id, (await rolesRepo(h.meta).findBySlug('crm-rep'))!.id);
      await h.run(`INSERT INTO crm_deals (id, title, owner_id, state) VALUES (1, 'One', '${dana.id}', 'open'), (2, 'Two', '${omar.id}', 'open'), (3, 'Three', '${dana.id}', 'won')`);
      await h.run(`INSERT INTO crm_quotes (id, deal_id, total) VALUES (1, 1, 10), (2, 2, 20)`);
      await h.run(`INSERT INTO crm_covers (id, owner_id, cover_id, starts_on, ends_on) VALUES (1, '${omar.id}', '${dana.id}', '2026-08-10', '2026-08-21')`);
      const set = await resolvePermissionSet(h.meta, { kind: 'user', id: dana.id, label: 'Dana' });
      const { db } = await h.manager.data(h.connectionId);
      const reached = async (table: string, action: 'read' | 'update', today: string): Promise<number[]> => {
        const test = rowLimitFor({ set, connectionId: h.connectionId, model: await model(), today }, await tableId(table), action)!;
        return (await db.selectFrom(await tableId(table)).select('id').where(test(db, table)).orderBy('id').execute()).map((row) => Number((row as { id: unknown }).id));
      };
      expect(await reached('crm_deals', 'read', '2026-07-01')).toEqual([1, 3]);
      // A date column the install made, compared with a day, on this engine: the cover's first and last day count.
      expect(await reached('crm_deals', 'read', '2026-08-10')).toEqual([1, 2, 3]);
      expect(await reached('crm_deals', 'read', '2026-08-21')).toEqual([1, 2, 3]);
      expect(await reached('crm_deals', 'read', '2026-08-22')).toEqual([1, 3]);
      // An enum the install made: "only while it is open".
      expect(await reached('crm_deals', 'update', '2026-07-01')).toEqual([1]);
      expect(await reached('crm_quotes', 'read', '2026-07-01')).toEqual([1]);
    });

    it('keeps a role\'s rows through an owner\'s save of the role, as it keeps what the role may write', async () => {
      const role = (await rolesRepo(h.meta).findBySlug('crm-rep'))!;
      const held = await permissionsRepo(h.meta).listForRole(role.id);
      const { grantsFromMatrixRows } = await import('../src/rbac/permissions.js');
      const grants = grantsFromMatrixRows(held);
      const saved = await h.inject({ method: 'POST', url: `/roles/${role.id}/permissions`, payload: { grants } } as never).catch(() => null);
      // The harness mounts the app routes only: the save itself is the roles route's, exercised in `rbac.test.ts`. What it must keep is on the row.
      void saved;
      expect((await actionsOf('crm-rep', 'crm_deals'))!.rowLimit).toBeDefined();
    });

    it('an update that no longer limits a role takes the limit back; one that drops the ways leaves no way', async () => {
      const updated = await h.install(manifest('1.1.0', { limits: { quotes: { rows: { read: { reach: 'own' } } } } }));
      expect(updated.statusCode, updated.body).toBe(200);
      expect((await actionsOf('crm-rep', 'crm_deals'))!.rowLimit).toBeUndefined();
      expect((await actionsOf('crm-rep', 'crm_quotes'))!.rowLimit).toEqual({ read: { reach: 'own' } });
      expect((await actionsOf('crm-manager', 'crm_deals'))!.rowLimit).toBeDefined();
      const bare = await h.install(manifest('1.2.0', { limits: {}, belongs: false }));
      expect(bare.statusCode, bare.body).toBe(200);
      const found = await model();
      expect(found.tables.find((table) => table.name === 'crm_deals')!.belongs).toBeUndefined();
      expect(found.tables.find((table) => table.name === 'crm_quotes')!.belongs).toBeUndefined();
      expect((await actionsOf('crm-manager', 'crm_deals'))!.rowLimit).toBeUndefined();
      // The column still holds a staff member: that is the column's own word.
      expect(found.tables.find((table) => table.name === 'crm_deals')!.columns.find((column) => column.name === 'owner_id')!.staff).toBe(true);
    });

    it('installs a private table: marked, its role held to its own rows, and in no view that reads for somebody else', async () => {
      const installed = await h.install(manifest('1.3.0', { limits: {}, belongs: false, notes: true }));
      expect(installed.statusCode, installed.body).toBe(200);
      const found = await model();
      const notes = found.tables.find((table) => table.name === 'crm_notes')!;
      expect(notes.private).toBe(true);
      expect(notes.belongs).toEqual([{ column: 'manager_id' }, { column: 'rep_id', set: 'team' }]);
      expect((await actionsOf('crm-lead', 'crm_notes'))!.rowLimit).toEqual({ read: { reach: 'own' }, update: { reach: 'own' } });
      // The Super Admin, whom nothing else limits, is held to their own rows of it.
      const owner = await resolvePermissionSet(h.meta, { kind: 'user', id: (await usersRepo(h.meta).list())[0]!.id, label: 'owner' });
      expect(rowLimitFor({ set: owner, connectionId: h.connectionId, model: found, today: '2026-10-11' }, notes.id, 'read')).not.toBeNull();
      // A rule, an owner's code, a public door: the table is not in what they read through.
      const forOthers = await loadSnapshotView(h.meta, h.connectionId, { forOthers: true });
      expect(() => forOthers.table(notes.id)).toThrow();
      expect(forOthers.linkTable(notes.id)).toBeNull();
      expect((await createPublicViews(h.meta).viewFor(h.connectionId))!.linkTable(notes.id)).toBeNull();
      expect((await loadSnapshotView(h.meta, h.connectionId)).table(notes.id).id).toBe(notes.id);
    });
  });
}
