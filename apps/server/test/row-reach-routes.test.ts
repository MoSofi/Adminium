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
    { ref: 'deals', belongs: [{ column: 'owner_id', set: 'team' }], indexes: [['owner_id']], columns: [id, { ref: 'name', type: 'text', maxLength: 80 }, staff('owner_id'), { ref: 'state', type: 'text', maxLength: 10, default: 'open' }, staff('approved_by'), { ref: 'api_token', type: 'text', maxLength: 80, nullable: true }] },
    { ref: 'notes', private: true, belongs: [{ column: 'manager_id' }, { column: 'rep_id' }], indexes: [['manager_id'], ['rep_id']], columns: [id, staff('manager_id'), staff('rep_id'), { ref: 'text', type: 'text', maxLength: 200 }] },
    { ref: 'plain', columns: [id, { ref: 'name', type: 'text', maxLength: 80 }] },
  ]),
  compatibility: { minAdminiumVersion: '0.3.28' },
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

    it('stores no row limit that would not hold, and takes none away by accident', async () => {
      const roles = rolesRepo(h.meta);
      const role = await roles.create({ slug: `held-${dialect}`, name: 'Held' });
      const ref = (table: string) => `${h.connectionId}/${tableId(table)}`;
      const grant = (table: string, action: string) => `table:${h.connectionId}:${tableId(table)}:${action}`;
      const save = async (grants: string[], rows?: Record<string, unknown>) => {
        const reply = await app.inject({ method: 'PUT', url: `/api/v1/roles/${role.id}/permissions`, headers: { cookie }, payload: { grants, ...(rows === undefined ? {} : { rows }) } });
        const code = reply.statusCode === 200 ? 'ok' : ((reply.json() as { error?: { details?: { fields?: { rows?: { code?: string } } } } }).error?.details?.fields?.rows?.code ?? String(reply.statusCode));
        return code;
      };
      const stored = async () => (await permissionsRepo(h.meta).listForRole(role.id)).flatMap((row) => ((row.actions as { rowLimit?: unknown }).rowLimit === undefined ? [] : [[row.resourceRef, (row.actions as { rowLimit?: unknown }).rowLimit]]));
      // An action the table's own row does not give: a wider grant gives it, and no limit on the row would narrow that.
      expect(await save([grant('deals', 'read'), `table:${h.connectionId}:*:update`], { [ref('deals')]: { update: { reach: 'own' } } })).toBe('action-not-granted');
      // A table that cannot be held to rows: private, or silent about whose its rows are.
      expect(await save([grant('notes', 'read')], { [ref('notes')]: { read: { reach: 'own' } } })).toBe('private');
      expect(await save([grant('plain', 'read')], { [ref('plain')]: { read: { reach: 'own' } } })).toBe('no-belongs');
      // "Only while" a column that is not there, or one not everybody who reads the table sees.
      expect(await save([grant('deals', 'read')], { [ref('deals')]: { read: { reach: 'own', while: { column: 'nowhere', in: ['x'] } } } })).toBe('no-such-column');
      expect(await save([grant('deals', 'read')], { [ref('deals')]: { read: { reach: 'own', while: { column: 'api_token', in: ['x'] } } } })).toBe('hidden-column');
      // "Only the ones a column names them in" takes a column that holds a staff member.
      expect(await save([grant('deals', 'read')], { [ref('deals')]: { read: { reach: 'own', by: 'state' } } })).toBe('not-a-staff-column');
      expect(await save([grant('deals', 'read')], { [ref('deals')]: { read: { reach: 'own', by: 'nowhere' } } })).toBe('no-such-column');
      expect(await stored()).toEqual([]);
      // One that holds is stored.
      expect(await save([grant('deals', 'read')], { [ref('deals')]: { read: { reach: 'own' } } })).toBe('ok');
      expect(await stored()).toEqual([[ref('deals'), { read: { reach: 'own' } }]]);
      // The table's own row traded for a grant of every table: the limit would go with the row, and the role read every deal.
      expect(await save([`table:${h.connectionId}:*:read`])).toBe('limit-would-lift');
      expect(await stored()).toEqual([[ref('deals'), { read: { reach: 'own' } }]]);
      // Taken off by name, it is a choice: allowed.
      expect(await save([`table:${h.connectionId}:*:read`], { [ref('deals')]: null })).toBe('ok');
      expect(await stored()).toEqual([]);
      // And a limited table simply no longer granted at all loses its limit with the grant: nothing is left to reach.
      expect(await save([grant('deals', 'read')], { [ref('deals')]: { read: { reach: 'own' } } })).toBe('ok');
      expect(await save([])).toBe('ok');
    });

    it('works a figure out only for somebody who reads the table, and by no column that is hidden', async () => {
      const users = usersRepo(h.meta);
      const roles = rolesRepo(h.meta);
      people['rm'] = await users.create({ email: `rm-${dialect}@reach.dev`, name: 'rm', passwordHash: await adminPasswordHash(), status: 'active' });
      const editsRoles = await roles.create({ slug: `edits-roles-${dialect}`, name: 'Edits roles' });
      await permissionsRepo(h.meta).grant(editsRoles.id, 'system', 'roles.manage', { allowed: true });
      await roles.assignToUser(people['rm']!.id, editsRoles.id);
      const rm = await signedIn('rm');
      const ask = (as: string, reach: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/v1/roles/rows/preview', headers: { cookie: as }, payload: { connectionId: h.connectionId, table: tableId('deals'), userId: people['ivy']!.id, reach } });
      // Edits roles, reads no deal: no count of them, whatever is asked.
      expect((await ask(rm, { reach: 'own' })).statusCode).toBe(403);
      expect((await ask(rm, { reach: 'all', while: { column: 'state', in: ['won'] } })).statusCode).toBe(403);
      // Given the read, the count is theirs to see.
      await permissionsRepo(h.meta).grant(editsRoles.id, 'table', `${h.connectionId}/${tableId('deals')}`, { read: true, create: false, update: false, delete: false, export: false, import: false });
      expect((await ask(rm, { reach: 'own' })).statusCode).toBe(200);
      // Nobody, a Super Admin included, is counted rows by a secret column: the count would tell its values.
      const secret = await ask(cookie, { reach: 'all', while: { column: 'api_token', in: ['abc'] } });
      expect([secret.statusCode, secret.body.includes('hidden-column')]).toEqual([422, true]);
      expect((await ask(cookie, { reach: 'all', while: { column: 'nowhere', in: ['abc'] } })).body).toContain('no-such-column');
    });

    const signedIn = async (name: string): Promise<string> => {
      const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.9.${String(name.length)}.${String(name.charCodeAt(0))}`, payload: { email: people[name]!.email, password: ADMIN_PASSWORD } });
      expect(login.statusCode, login.body).toBe(200);
      return sessionCookie(login.headers['set-cookie']);
    };
    const owners = async () => (await h.rows(`SELECT owner_id FROM ${h.real('deals')} ORDER BY id`)).map((row) => row['owner_id']);
    /** A role that reads the deals, given to whoever is to take some. */
    const readsDeals = async (name: string) => {
      const role = (await rolesRepo(h.meta).findBySlug(`reads-deals-${dialect}`)) ?? (await rolesRepo(h.meta).create({ slug: `reads-deals-${dialect}`, name: 'Reads deals' }));
      await permissionsRepo(h.meta).grant(role.id, 'table', `${h.connectionId}/${tableId('deals')}`, { read: true, create: false, update: false, delete: false, export: false, import: false });
      await rolesRepo(h.meta).assignToUser(people[name]!.id, role.id);
    };

    it('tells whoever manages people which rows are a person\'s: only the columns that decide it, and of a private table only that there are some', async () => {
      const dana = people['dana']!;
      // She approved a colleague's deal: history, which makes no row hers.
      await h.rows(`UPDATE ${h.real('deals')} SET approved_by = '${dana.id}' WHERE name = 'd3'`);
      const reply = await app.inject({ method: 'GET', url: `/api/v1/users/${dana.id}/rows`, headers: { cookie } });
      const named = reply.json() as { named: { tableId: string; column: string; rows: number }[]; total: number; private: boolean };
      expect(named.named.map((one) => [one.tableId === tableId('deals') ? 'deals' : 'other', one.column, one.rows])).toEqual([['deals', 'owner_id', 2]]);
      expect([named.total, named.private]).toEqual([2, true]);
      // Nothing of the one-to-one but that it is there: not its table, not how many.
      expect(reply.body).not.toContain(tableId('notes'));
      expect(reply.body).not.toContain('rep_id');
    });

    it('hands rows on only as a person is suspended or removed, to somebody here whose roles read them, and moves nothing it then refuses', async () => {
      const dana = people['dana']!;
      const before = await owners();
      // Removed for good with her rows still hers: refused, and of the private table only that it names her.
      const refused = await app.inject({ method: 'DELETE', url: `/api/v1/users/${dana.id}?permanent=true`, headers: { cookie } });
      expect([refused.statusCode, refused.body.includes('HAS_ROWS'), refused.body.includes('"private":true'), refused.body.includes(tableId('notes'))]).toEqual([409, true, true, false]);
      // While she is here her rows are hers: no hand-over on its own.
      const still = await app.inject({ method: 'POST', url: `/api/v1/users/${dana.id}/rows/hand-over`, headers: { cookie }, payload: { to: people['sam']!.id } });
      expect([still.statusCode, still.body.includes('STILL_HERE')]).toEqual([409, true]);
      const removeTo = (userId: string) => app.inject({ method: 'DELETE', url: `/api/v1/users/${dana.id}?permanent=true&handTo=${userId}`, headers: { cookie } });
      // Not to herself, not to somebody who is not here, not to nobody, not to somebody who could not open them.
      expect((await removeTo(dana.id)).statusCode).toBe(422);
      expect((await removeTo(people['gone']!.id)).body).toContain('NOT_ACTIVE');
      expect((await removeTo('usr_nobody')).statusCode).toBe(404);
      const closed = await removeTo(people['sam']!.id);
      expect([closed.statusCode, closed.body.includes('TAKER_CANNOT_READ')]).toEqual([409, true]);
      // Each refusal left her, and every row, as they were.
      expect(await usersRepo(h.meta).findById(dana.id)).not.toBeNull();
      expect(await owners()).toEqual(before);

      await readsDeals('sam');
      const removed = await removeTo(people['sam']!.id);
      expect(removed.statusCode, removed.body).toBe(200);
      expect(await usersRepo(h.meta).findById(dana.id)).toBeNull();
      expect(await owners()).toEqual([people['sam']!.id, people['sam']!.id, people['sam']!.id, people['leo']!.id, null]);
      // What she approved is history and still says so; the one-to-one is not a colleague's to be given.
      expect((await h.rows(`SELECT approved_by FROM ${h.real('deals')} WHERE name = 'd3'`))[0]!['approved_by']).toBe(dana.id);
      expect(await h.rows(`SELECT rep_id FROM ${h.real('notes')}`)).toEqual([{ rep_id: dana.id }]);
      // One entry for the table, with how many and to whom.
      const entries = (await auditRepo(h.meta).list({ category: 'rbac' })).filter((one) => one.action === 'user.rows.hand-over');
      expect(entries.length).toBe(1);
      expect(JSON.stringify(entries[0])).toContain(`"to":"${people['sam']!.id}"`);
      expect(JSON.stringify(entries[0])).toContain('"rows":2');
    });

    it('hands a suspended person\'s rows on, as they are suspended or afterwards', async () => {
      // Leo is suspended and his deal goes to Sam in the same call.
      const suspended = await app.inject({ method: 'DELETE', url: `/api/v1/users/${people['leo']!.id}?handTo=${people['sam']!.id}`, headers: { cookie } });
      expect(suspended.statusCode, suspended.body).toBe(200);
      expect((await usersRepo(h.meta).findById(people['leo']!.id))!.status).toBe('suspended');
      expect(await owners()).toEqual([people['sam']!.id, people['sam']!.id, people['sam']!.id, people['sam']!.id, null]);
      // Sam is suspended with his rows still his; they are handed on afterwards, to Ivy.
      await usersRepo(h.meta).updateStatus(people['sam']!.id, 'suspended');
      await readsDeals('ivy');
      const moved = await app.inject({ method: 'POST', url: `/api/v1/users/${people['sam']!.id}/rows/hand-over`, headers: { cookie }, payload: { to: people['ivy']!.id } });
      expect(moved.statusCode, moved.body).toBe(200);
      expect(moved.json()).toMatchObject({ total: 4, private: false, failed: [], named: [{ column: 'owner_id', rows: 4 }] });
      expect(await owners()).toEqual([people['ivy']!.id, people['ivy']!.id, people['ivy']!.id, people['ivy']!.id, null]);
    });

    it('is closed to somebody who manages neither people nor roles, and a Super Admin\'s rows are a Super Admin\'s to hand on', async () => {
      const users = usersRepo(h.meta);
      const roles = rolesRepo(h.meta);
      people['plain'] = await users.create({ email: `plain-${dialect}@reach.dev`, name: 'plain', passwordHash: await adminPasswordHash(), status: 'active' });
      people['pm'] = await users.create({ email: `pm-${dialect}@reach.dev`, name: 'pm', passwordHash: await adminPasswordHash(), status: 'active' });
      const managesPeople = await roles.create({ slug: `people-${dialect}`, name: 'People' });
      await permissionsRepo(h.meta).grant(managesPeople.id, 'system', 'users.manage', { allowed: true });
      await roles.assignToUser(people['pm']!.id, managesPeople.id);
      const anyRole = (await roles.list())[0]!;
      const plain = await signedIn('plain');
      const tries = [
        await app.inject({ method: 'GET', url: `/api/v1/roles/${anyRole.id}/rows`, headers: { cookie: plain } }),
        await app.inject({ method: 'POST', url: '/api/v1/roles/rows/preview', headers: { cookie: plain }, payload: { connectionId: h.connectionId, table: tableId('deals'), userId: people['ivy']!.id, reach: { reach: 'own' } } }),
        await app.inject({ method: 'GET', url: `/api/v1/users/${people['ivy']!.id}/rows`, headers: { cookie: plain } }),
        await app.inject({ method: 'POST', url: `/api/v1/users/${people['gone']!.id}/rows/hand-over`, headers: { cookie: plain }, payload: { to: people['ivy']!.id } }),
      ];
      expect(tries.map((reply) => reply.statusCode)).toEqual([403, 403, 403, 403]);
      // Somebody who manages people and is no Super Admin: a suspended Super Admin's rows are not theirs to move.
      const pm = await signedIn('pm');
      const root = await users.create({ email: `root2-${dialect}@reach.dev`, name: 'root2', passwordHash: null, status: 'suspended' });
      await roles.assignToUser(root.id, (await roles.findBySlug('super-admin'))!.id);
      await h.rows(`INSERT INTO ${h.real('deals')} (name, owner_id) VALUES ('root deal', '${root.id}')`);
      const guarded = await app.inject({ method: 'POST', url: `/api/v1/users/${root.id}/rows/hand-over`, headers: { cookie: pm }, payload: { to: people['ivy']!.id } });
      expect(guarded.statusCode, guarded.body).toBe(403);
      expect((await h.rows(`SELECT owner_id FROM ${h.real('deals')} WHERE name = 'root deal'`))[0]!['owner_id']).toBe(root.id);
      // A Super Admin may.
      const allowed = await app.inject({ method: 'POST', url: `/api/v1/users/${root.id}/rows/hand-over`, headers: { cookie }, payload: { to: people['ivy']!.id } });
      expect(allowed.statusCode, allowed.body).toBe(200);
    });
  });
}
