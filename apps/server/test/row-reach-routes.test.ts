// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "DANA WOULD SEE 2 OF 5", AND A LEAVER'S ROWS.
 *
 * The role editor asks how many rows one person reaches under a limit it has
 * not saved yet; and a person who is removed for good first has the rows that
 * name them handed to somebody else — but for a private table's, which stay
 * with the two people they belong to.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditRepo, permissionsRepo, rolesRepo, teamsRepo, usersRepo, type User } from '@adminium/meta';

import { loadSnapshotView } from '../src/data-io/snapshot-view.js';
import { ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from './auth-helpers.js';
import { LEGS, installInvoicing, invoicingManifest, type InvoicingHarness } from './invoicing-install.helpers.js';
import { servePublic } from './public-lane.helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };
const staff = (ref: string) => ({ ref, type: 'text', maxLength: 36, nullable: true, rules: { staff: true } });

const manifest = (): Record<string, unknown> => ({
  ...invoicingManifest([
    { ref: 'deals', belongs: [{ column: 'owner_id', set: 'team' }], indexes: [['owner_id']], columns: [id, { ref: 'name', type: 'text', maxLength: 80 }, staff('owner_id'), { ref: 'state', type: 'text', maxLength: 10, default: 'open' }] },
    { ref: 'notes', private: true, belongs: [{ column: 'manager_id' }, { column: 'rep_id' }], indexes: [['manager_id'], ['rep_id']], columns: [id, staff('manager_id'), staff('rep_id'), { ref: 'text', type: 'text', maxLength: 200 }] },
    { ref: 'plain', columns: [id, { ref: 'name', type: 'text', maxLength: 80 }] },
  ]),
  compatibility: { minAdminiumVersion: '0.3.27' },
  pages: [{ ref: 'studio-deals', template: 'page-crud', title: { key: 't', fallback: 'Deals' }, nav: { group: 'library', icon: 'list', order: 1 }, bindings: { rows: 'deals' } }],
});

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`the rows a person reaches, and a leaver's rows, on ${dialect}`, () => {
    let h: InvoicingHarness;
    let app: Awaited<ReturnType<typeof servePublic>>['composed']['app'];
    let cookie: string;
    const people: Record<string, User> = {};
    const idOf: Record<string, string> = {};
    const tableId = (ref: string): string => idOf[ref]!;

    beforeAll(async () => {
      h = await installInvoicing(dialect, manifest());
      app = (await servePublic(h, null)).composed.app;
      const users = usersRepo(h.meta);
      const make = async (name: string, status: User['status'] = 'active') => (people[name] = await users.create({ email: `${name}-${dialect}@reach.dev`, name, passwordHash: status === 'active' ? await adminPasswordHash() : null, status }));
      for (const name of ['owner', 'ivy', 'dana', 'sam', 'leo']) await make(name);
      await make('gone', 'suspended');
      await rolesRepo(h.meta).assignToUser(people['owner']!.id, (await rolesRepo(h.meta).findBySlug('super-admin'))!.id);
      const team = await teamsRepo(h.meta).create('Sales');
      await teamsRepo(h.meta).setMember(team.id, people['ivy']!.id, true);
      await teamsRepo(h.meta).setMember(team.id, people['dana']!.id, false);
      await teamsRepo(h.meta).setMember(team.id, people['sam']!.id, false);
      const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: people['owner']!.email, password: ADMIN_PASSWORD } });
      expect(login.statusCode, login.body).toBe(200);
      cookie = sessionCookie(login.headers['set-cookie']);
      const view = await loadSnapshotView(h.meta, h.connectionId);
      for (const ref of ['deals', 'notes', 'plain']) idOf[ref] = view.model.tables.find((table) => table.name === h.real(ref))!.id;
      const deal = (name: string, owner: string | null, state = 'open') => h.rows(`INSERT INTO ${h.real('deals')} (name, owner_id, state) VALUES ('${name}', ${owner === null ? 'NULL' : `'${people[owner]!.id}'`}, '${state}')`);
      await deal('d1', 'dana');
      await deal('d2', 'dana', 'won');
      await deal('d3', 'sam');
      await deal('d4', 'leo');
      await deal('d5', null);
      await h.rows(`INSERT INTO ${h.real('notes')} (manager_id, rep_id, text) VALUES ('${people['ivy']!.id}', '${people['dana']!.id}', 'a one-to-one')`);
      await h.rows(`INSERT INTO ${h.real('plain')} (name) VALUES ('anything')`);
    }, 240_000);
    afterAll(async () => {
      await h.close();
    });

    const preview = async (who: string, reach: Record<string, unknown>, ref = 'deals', action?: string) => {
      const reply = await app.inject({ method: 'POST', url: '/api/v1/roles/rows/preview', headers: { cookie }, payload: { connectionId: h.connectionId, table: tableId(ref), userId: people[who]!.id, reach, ...(action === undefined ? {} : { action }) } });
      return reply.statusCode === 200 ? (reply.json() as { reached: number; total: number }) : reply.statusCode;
    };

    it('counts what one person would reach under a limit that is not saved yet', async () => {
      expect(await preview('dana', { reach: 'own' })).toMatchObject({ reached: 2, total: 5 });
      expect(await preview('dana', { reach: 'own', unowned: true })).toMatchObject({ reached: 3, total: 5 });
      expect(await preview('dana', { reach: 'own', while: { column: 'state', in: ['won'] } })).toMatchObject({ reached: 1, total: 5 });
      // The lead reaches her members' rows; a member reaches no more than her own under the same limit.
      expect(await preview('ivy', { reach: 'team' })).toMatchObject({ reached: 3, total: 5 });
      expect(await preview('dana', { reach: 'team' })).toMatchObject({ reached: 2, total: 5 });
      expect(await preview('leo', { reach: 'team', unowned: true }, 'deals', 'update')).toMatchObject({ reached: 2, total: 5 });
      expect(await preview('dana', { reach: 'all', while: { column: 'state', in: ['won'] } })).toMatchObject({ reached: 1, total: 5 });
    });

    it('works no figure out of a private table, nor of one that does not say whose its rows are', async () => {
      expect(await preview('dana', { reach: 'own' }, 'notes')).toBe(422);
      expect(await preview('dana', { reach: 'own' }, 'plain')).toBe(422);
      const nobody = await app.inject({ method: 'POST', url: '/api/v1/roles/rows/preview', headers: { cookie }, payload: { connectionId: h.connectionId, table: tableId('deals'), userId: 'usr_nobody', reach: { reach: 'own' } } });
      expect(nobody.statusCode).toBe(404);
      // Nobody signed in is told nothing.
      const anonymous = await app.inject({ method: 'POST', url: '/api/v1/roles/rows/preview', payload: { connectionId: h.connectionId, table: tableId('deals'), userId: people['dana']!.id, reach: { reach: 'own' } } });
      expect(anonymous.statusCode).toBe(401);
    });

    it('tells the role editor which tables a role can be limited on, how each says whose a row is, and what lifts a limit', async () => {
      const roles = rolesRepo(h.meta);
      const all = { read: true, create: true, update: true, delete: false, export: false, import: false };
      const rep = await roles.create({ slug: `rep-${dialect}`, name: 'Rep' });
      const boss = await roles.create({ slug: `boss-${dialect}`, name: 'Boss' });
      const grant = permissionsRepo(h.meta).grant;
      await grant(rep.id, 'table', `${h.connectionId}/${tableId('deals')}`, { ...all, rowLimit: { read: { reach: 'own' } } });
      await grant(rep.id, 'table', `${h.connectionId}/${tableId('notes')}`, all);
      await grant(rep.id, 'table', `${h.connectionId}/${tableId('plain')}`, all);
      await grant(boss.id, 'table', `${h.connectionId}/${tableId('deals')}`, all);
      const listed = await app.inject({ method: 'GET', url: `/api/v1/roles/${rep.id}/rows`, headers: { cookie } });
      expect(listed.statusCode, listed.body).toBe(200);
      const tables = (listed.json() as { tables: Record<string, unknown>[] }).tables;
      // The table that says nothing of its rows is not there: there is nothing to choose.
      expect(tables.map((table) => [table['tableId'] === tableId('deals') ? 'deals' : 'notes', table['private'], table['own']]).sort()).toEqual([
        ['deals', false, true],
        ['notes', true, true],
      ]);
      const deals = tables.find((table) => table['tableId'] === tableId('deals'))!;
      expect(deals['ref']).toBe(`${h.connectionId}/${tableId('deals')}`);
      expect(deals['ways']).toEqual([{ kind: 'person', column: 'owner_id', label: expect.any(String) }]);
      expect(deals['granted']).toEqual({ read: true, update: true, delete: false });
      expect(deals['limit']).toEqual({ read: { reach: 'own' } });

      // Dana holds Rep alone: nothing lifts it. With Boss too, Boss reads every deal, so Rep's limit does not hold for her.
      const ask = async () => {
        const reply = await app.inject({ method: 'POST', url: '/api/v1/roles/rows/preview', headers: { cookie }, payload: { connectionId: h.connectionId, table: tableId('deals'), userId: people['dana']!.id, reach: { reach: 'own' }, roleId: rep.id } });
        return (reply.json() as { liftedBy: string[] }).liftedBy;
      };
      await roles.assignToUser(people['dana']!.id, rep.id);
      expect(await ask()).toEqual([]);
      await roles.assignToUser(people['dana']!.id, boss.id);
      expect(await ask()).toEqual(['Boss']);
      await roles.removeFromUser(people['dana']!.id, boss.id);
      await roles.removeFromUser(people['dana']!.id, rep.id);
    });

    it('will not remove for good a person rows still name, hands the rows over, then removes them', async () => {
      const dana = people['dana']!;
      const named = (await app.inject({ method: 'GET', url: `/api/v1/users/${dana.id}/rows`, headers: { cookie } })).json() as { named: { tableId: string; column: string; rows: number; private: boolean }[]; total: number };
      expect(named.total).toBe(2);
      expect(named.named.map((one) => [one.tableId === tableId('deals') ? 'deals' : 'notes', one.column, one.rows, one.private]).sort()).toEqual([
        ['deals', 'owner_id', 2, false],
        ['notes', 'rep_id', 1, true],
      ]);
      const refused = await app.inject({ method: 'DELETE', url: `/api/v1/users/${dana.id}?permanent=true`, headers: { cookie } });
      expect([refused.statusCode, refused.body.includes('HAS_ROWS')]).toEqual([409, true]);
      // Not to herself, not to somebody who is not here.
      const to = (userId: string) => app.inject({ method: 'POST', url: `/api/v1/users/${dana.id}/rows/hand-over`, headers: { cookie }, payload: { to: userId } });
      expect((await to(dana.id)).statusCode).toBe(422);
      expect((await to(people['gone']!.id)).statusCode).toBe(409);
      expect((await to('usr_nobody')).statusCode).toBe(404);
      const moved = await to(people['sam']!.id);
      expect(moved.statusCode, moved.body).toBe(200);
      expect((moved.json() as { total: number }).total).toBe(2);
      const owners = await h.rows(`SELECT name, owner_id FROM ${h.real('deals')} ORDER BY id`);
      expect(owners.map((row) => row['owner_id'])).toEqual([people['sam']!.id, people['sam']!.id, people['sam']!.id, people['leo']!.id, null]);
      // The one-to-one is not a colleague's to be given: it still names her.
      expect(await h.rows(`SELECT rep_id FROM ${h.real('notes')}`)).toEqual([{ rep_id: dana.id }]);
      const removed = await app.inject({ method: 'DELETE', url: `/api/v1/users/${dana.id}?permanent=true`, headers: { cookie } });
      expect(removed.statusCode, removed.body).toBe(200);
      expect(await usersRepo(h.meta).findById(dana.id)).toBeNull();
      const entry = (await auditRepo(h.meta).list({ category: 'rbac' })).find((one) => one.action === 'user.rows.hand-over');
      expect(JSON.stringify(entry)).toContain('"rows":2');
    });
  });
}
