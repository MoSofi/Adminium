// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A removal's reason and a removed row's history (`table.removal`), and a
 * column whose earlier values only the audit log keeps (`column.history:
 * "audit"`), against the whole server on every engine (the firm of
 * `row-limit-world.ts`).
 *
 * - `deal_members` asks for a reason (required) and keeps its removed rows;
 *   its `deal_owner_id` is personal data.
 * - `followups` asks for a reason (optional) and keeps its removed rows; its
 *   `note` keeps its earlier values for the audit log only. A rep reads her
 *   own follow-ups only.
 * - `companies` (the firm's contacts) never opts in: a removed one is read by
 *   nobody, through anything.
 *
 * Dana reads deal 1 (hers); Omar does not. The owner removes rows.
 */
import { permissionsRepo, rolesRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ENGINES, world, type PersonName, type World } from './row-limit-world.js';

const OWN = { reach: 'own' } as const;

type Who = PersonName | 'owner';
interface Reply {
  statusCode: number;
  body: string;
}
const json = <T>(res: Reply): T => JSON.parse(res.body) as T;
interface Removed {
  key: string;
  removedAt: number;
  actorKind: string;
  actorLabel: string;
  reason: string | null;
  via: string;
  row: Record<string, unknown>;
}
interface Entry {
  action: string;
  actorLabel: string;
  changes: { before?: Record<string, unknown> | null; after?: Record<string, unknown> | null; reason?: string | null } | null;
}

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`a removal's reason and a removed row's history [${dialect}]`, () => {
    let w: World;
    const cookies = new Map<Who, string>();
    const as = async (who: Who): Promise<string> => {
      if (!cookies.has(who)) cookies.set(who, who === 'owner' ? w.owner.cookie : (await w.signIn(who)).cookie);
      return cookies.get(who)!;
    };
    const call = async (who: Who, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, payload?: Record<string, unknown>): Promise<Reply> =>
      w.app.inject({ method, url: `/api/v1/data/${w.connectionId}/${path}`, headers: { cookie: await as(who) }, ...(payload === undefined ? {} : { payload }) });
    const removedUnder = async (who: Who, path: string): Promise<Removed[]> => {
      const res = await call(who, 'GET', path);
      expect(res.statusCode, res.body).toBe(200);
      return json<{ removed: Removed[] }>(res).removed;
    };
    /** The newest audit entry of an action, with its changes read. */
    const lastEntry = async (action: string): Promise<{ actorLabel: string; changes: Record<string, unknown> }> => {
      const row = await w.meta.db.selectFrom('adminium_audit_log').select(['actorLabel', 'changes']).where('action', '=', action).orderBy('createdAt', 'desc').orderBy('id', 'desc').limit(1).executeTakeFirstOrThrow();
      return { actorLabel: row.actorLabel, changes: (typeof row.changes === 'string' ? JSON.parse(row.changes) : row.changes) as Record<string, unknown> };
    };
    const override = async (op: string, table: Parameters<World['id']>[0], value: Record<string, unknown>, columnName?: string) => {
      const { overridesRepo } = await import('@adminium/meta');
      await overridesRepo(w.meta).create({ connectionId: w.connectionId, op, tableName: w.id(table), ...(columnName === undefined ? {} : { columnName }), value, origin: 'user' } as never);
    };

    beforeAll(async () => {
      w = await world(dialect);
      await override('table.removal', 'deal_members', { reason: 'required', history: true });
      await override('column.pii', 'deal_members', { masked: true }, 'deal_owner_id');
      await override('table.removal', 'followups', { reason: true, history: true });
      await override('column.history', 'followups', { history: 'audit' }, 'note');
      // A private table that says it keeps its removed rows keeps none: its rows are its own people's only.
      await override('table.removal', 'one_to_ones', { history: true });
      await w.role('rep', {
        deals: { actions: ['read'], rows: { read: OWN } },
        followups: { actions: ['read', 'update', 'delete'], rows: { read: OWN, update: OWN, delete: OWN } },
        companies: { actions: ['read'] },
        tags: { actions: ['read'] },
      });
      // A rep reads a deal's members, all but who owned the deal they were on.
      const rep = (await rolesRepo(w.meta).findBySlug('rep'))!;
      await permissionsRepo(w.meta).grant(rep.id, 'table', `${w.connectionId}/${w.id('deal_members')}`, { read: true, create: false, update: false, delete: false, export: false, import: false, readLimit: { readable: ['deal_id', 'user_id'] } } as never);
      for (const person of ['dana', 'omar'] as const) await w.give(person, 'rep');
      await w.run(`INSERT INTO deal_members (id, deal_id, user_id, deal_owner_id) VALUES (10, 1, '${w.people.omar}', '${w.people.dana}'), (11, 1, '${w.people.lena}', NULL), (12, 3, '${w.people.dana}', NULL)`);
      await w.run(`INSERT INTO companies (id, name) VALUES (3, 'Harbour Contacts Ltd')`);
    }, 120_000);
    afterAll(async () => {
      await w?.close();
    });

    describe('a reason', () => {
      it('is required where the table says so, taken by the delete route, and written into the audit entry', async () => {
        const without = await call('owner', 'DELETE', 'deal_members/10');
        expect(without.statusCode, without.body).toBe(422);
        expect(json<{ error: { details: { fields: Record<string, { code: string }> } } }>(without).error.details.fields['reason']?.code).toBe('required');
        const blank = await call('owner', 'DELETE', 'deal_members/10', { reason: '   ' });
        expect(blank.statusCode).toBe(422);
        expect(await w.rows('SELECT id FROM deal_members WHERE id = 10')).toHaveLength(1);
        // A try that deletes nothing asks for none.
        expect((await call('owner', 'DELETE', 'deal_members/10?dryRun=true')).statusCode).toBe(200);
        const gone = await call('owner', 'DELETE', 'deal_members/10', { reason: '  Moved to the South team ' });
        expect(gone.statusCode, gone.body).toBe(200);
        expect(await w.rows('SELECT id FROM deal_members WHERE id = 10')).toHaveLength(0);
        const entry = await lastEntry('record.delete');
        expect(entry.changes['reason']).toBe('Moved to the South team');
        expect(entry.actorLabel).toBe('Owner');
      });

      it('is refused where the table asks for none, and too long a one everywhere', async () => {
        const refused = await call('owner', 'DELETE', 'companies/3', { reason: 'Duplicate' });
        expect(refused.statusCode, refused.body).toBe(422);
        expect(json<{ error: { details: { fields: Record<string, { code: string }> } } }>(refused).error.details.fields['reason']?.code).toBe('not-allowed');
        expect((await call('owner', 'DELETE', 'deal_members/11', { reason: 'x'.repeat(501) })).statusCode).toBe(422);
        expect(await w.rows('SELECT id FROM deal_members WHERE id = 11')).toHaveLength(1);
      });

      it('is optional where the table asks for one: none is written as no reason', async () => {
        await w.run(`INSERT INTO followups (id, deal_id, owner_id, note) VALUES (20, 1, '${w.people.dana}', 'Call back Friday')`);
        const res = await call('owner', 'DELETE', 'followups/20');
        expect(res.statusCode, res.body).toBe(200);
        const entry = await lastEntry('record.delete');
        expect(entry.changes).toHaveProperty('reason', null);
        // A table that asks for none writes no reason at all.
        const company = await call('owner', 'DELETE', 'companies/3');
        expect(company.statusCode, company.body).toBe(200);
        expect((await lastEntry('record.delete')).changes).not.toHaveProperty('reason');
      });

      it('is taken by a bulk delete, once for the batch, and refused beside a change', async () => {
        await w.run(`INSERT INTO deal_members (id, deal_id, user_id) VALUES (13, 1, '${w.people.sam}'), (14, 1, '${w.people.kim}')`);
        expect((await call('owner', 'POST', 'deal_members/bulk', { action: 'delete', ids: [13, 14] })).statusCode).toBe(422);
        expect((await call('owner', 'POST', 'deal_members/bulk', { action: 'update', ids: [13], values: { user_id: w.people.sam }, reason: 'No' })).statusCode).toBe(422);
        const res = await call('owner', 'POST', 'deal_members/bulk', { action: 'delete', ids: [13, 14], reason: 'Wrong deal' });
        expect(res.statusCode, res.body).toBe(200);
        expect((await lastEntry('record.bulk-delete')).changes['reason']).toBe('Wrong deal');
        const listed = await removedUnder('dana', 'deals/1/removed/deal_members');
        expect(listed.filter((row) => ['13', '14'].includes(row.key)).map((row) => [row.key, row.reason, row.actorLabel]).sort()).toEqual([
          ['13', 'Wrong deal', 'Owner'],
          ['14', 'Wrong deal', 'Owner'],
        ]);
      });

      it('is no reason on a door no person gives one through: an undo of a new row', async () => {
        const made = await call('owner', 'POST', 'deal_members', { values: { id: 15, deal_id: 1, user_id: w.people.dana } });
        expect(made.statusCode, made.body).toBe(201);
        const token = json<{ undoToken: string | null }>(made).undoToken;
        expect(token).not.toBeNull();
        const undone = await w.app.inject({ method: 'POST', url: `/api/v1/data/undo/${token!}`, headers: { cookie: await as('owner') } });
        expect(undone.statusCode, undone.body).toBe(200);
        expect((await lastEntry('record.undo')).changes).toHaveProperty('reason', null);
        const row = (await removedUnder('dana', 'deals/1/removed/deal_members')).find((one) => one.key === '15');
        expect(row).toMatchObject({ key: '15', reason: null, actorLabel: 'Owner' });
      });
    });

    describe('a removed row\'s history', () => {
      it('is read through a row it linked to that the reader reads now, masked as a live read', async () => {
        const listed = await removedUnder('dana', 'deals/1/removed/deal_members');
        const member = listed.find((row) => row.key === '10');
        expect(member).toMatchObject({ key: '10', reason: 'Moved to the South team', actorKind: 'user', actorLabel: 'Owner', via: 'deal_id' });
        // Her role reads a member's deal and person, not who owned the deal (and nobody reads personal data out of a removal).
        expect(member!.row).toEqual({ id: 10, deal_id: 1, user_id: w.people.omar });
        // Newest first.
        expect(listed.map((row) => row.removedAt)).toEqual([...listed.map((row) => row.removedAt)].sort((a, b) => b - a));
        // The owner reads every column, with the personal one kept masked as the audit log keeps it.
        const owners = (await removedUnder('owner', 'deals/1/removed/deal_members')).find((row) => row.key === '10');
        expect(owners!.row).toMatchObject({ id: 10, deal_id: 1, user_id: w.people.omar, deal_owner_id: null, _masked: ['deal_owner_id'] });
        // Its own history, through the deal: made by SQL, so only its removal is there, with its reason.
        const history = await call('dana', 'GET', 'deals/1/removed/deal_members/10/history');
        expect(history.statusCode, history.body).toBe(200);
        const entries = json<{ entries: Entry[] }>(history).entries;
        expect(entries.map((entry) => entry.action)).toEqual(['record.delete']);
        expect(entries[0]!.changes).toMatchObject({ reason: 'Moved to the South team', before: { id: 10, deal_id: 1, user_id: w.people.omar } });
        expect(entries[0]!.changes!.before).not.toHaveProperty('deal_owner_id');
        // Read as a record, it is not there, as before.
        expect((await call('dana', 'GET', 'deal_members/10/history')).statusCode).toBe(404);
      });

      it('is not read through a row the reader does not read, nor through a row it did not link to', async () => {
        // Omar does not read Dana's deal: answered as a deal that is not there.
        const theirs = await call('omar', 'GET', 'deals/1/removed/deal_members');
        const missing = await call('omar', 'GET', 'deals/999/removed/deal_members');
        expect(theirs.statusCode).toBe(404);
        expect(theirs.body.replace(/req_[0-9a-f]{8}/g, 'req_x').replace(/\b1\b/g, 'K')).toBe(missing.body.replace(/req_[0-9a-f]{8}/g, 'req_x').replace(/\b999\b/g, 'K'));
        expect((await call('omar', 'GET', 'deals/1/removed/deal_members/10/history')).statusCode).toBe(404);
        // Under another deal it was never on: not there.
        expect((await call('owner', 'GET', 'deals/3/removed/deal_members/10/history')).statusCode).toBe(404);
        expect((await removedUnder('owner', 'deals/3/removed/deal_members')).map((row) => row.key)).toEqual([]);
      });

      it('is held to the row limit the reader\'s read of the table is held to, judged on the row as it was', async () => {
        // Dana reads her own follow-ups only: of the two removed under her deal, the one that was hers.
        expect((await call('owner', 'DELETE', 'followups/1', { reason: 'Done' })).statusCode).toBe(200);
        expect((await call('owner', 'DELETE', 'followups/2', { reason: 'Omar\'s, done' })).statusCode).toBe(200);
        expect((await removedUnder('dana', 'deals/1/removed/followups')).map((row) => row.key).filter((key) => key !== '20')).toEqual(['1']);
        expect((await call('dana', 'GET', 'deals/1/removed/followups/2/history')).statusCode).toBe(404);
        expect((await call('dana', 'GET', 'deals/1/removed/followups/1/history')).statusCode).toBe(200);
        expect((await removedUnder('owner', 'deals/1/removed/followups')).map((row) => row.key).sort()).toEqual(['1', '2', '20']);
      });

      it('is off the list once an undo brings the row back', async () => {
        const gone = await call('owner', 'DELETE', 'deal_members/12', { reason: 'By mistake' });
        expect(gone.statusCode, gone.body).toBe(200);
        expect((await removedUnder('owner', 'deals/3/removed/deal_members')).map((row) => row.key)).toEqual(['12']);
        const token = json<{ undoToken: string | null }>(gone).undoToken;
        const undone = await w.app.inject({ method: 'POST', url: `/api/v1/data/undo/${token!}`, headers: { cookie: await as('owner') } });
        expect(undone.statusCode, undone.body).toBe(200);
        expect(await w.rows('SELECT id FROM deal_members WHERE id = 12')).toHaveLength(1);
        expect((await removedUnder('owner', 'deals/3/removed/deal_members')).map((row) => row.key)).toEqual([]);
        expect((await call('owner', 'GET', 'deals/3/removed/deal_members/12/history')).statusCode).toBe(404);
        // Back as a record: its history is the record's again.
        expect((await call('owner', 'GET', 'deal_members/12/history')).statusCode).toBe(200);
      });

      it('a rep cannot read a contact the admin removed: a table that never opts in keeps nothing', async () => {
        // Companies 3 was removed above. Read as a record: not there.
        expect((await call('dana', 'GET', 'companies/3/history')).statusCode).toBe(404);
        // Read through anything: refused as a table that keeps no removed rows, the owner included.
        for (const who of ['dana', 'owner'] as const) {
          const res = await call(who, 'GET', 'deals/1/removed/companies');
          expect(res.statusCode, res.body).toBe(404);
          expect(res.body).toContain('This table keeps no removed rows.');
          expect((await call(who, 'GET', 'deals/1/removed/companies/3/history')).statusCode).toBe(404);
        }
        expect(await w.meta.db.selectFrom('adminium_removed_rows').select('id').where('entityTable', '=', w.id('companies')).execute()).toEqual([]);
      });

      it('never for a private table, whatever it says', async () => {
        const res = await call('owner', 'DELETE', 'one_to_ones/3');
        expect(res.statusCode, res.body).toBe(404);
        // Mara's own: she removes it; nothing is kept.
        await w.role('manager', { one_to_ones: { actions: ['read', 'delete'] } });
        await w.give('mara', 'manager');
        expect((await call('mara', 'DELETE', 'one_to_ones/3')).statusCode).toBe(200);
        expect(await w.meta.db.selectFrom('adminium_removed_rows').select('id').where('entityTable', '=', w.id('one_to_ones')).execute()).toEqual([]);
      });

      it('a table that does not link to the record, or one the reader may not read, is refused', async () => {
        expect((await call('owner', 'GET', 'deals/1/removed/one_to_ones')).statusCode).toBe(404);
        expect((await call('owner', 'GET', 'companies/1/removed/followups')).statusCode).toBe(404);
        // Omar may not read quotes at all: refused as the table is.
        await override('table.removal', 'quotes', { history: true });
        expect((await call('omar', 'GET', 'deals/3/removed/quotes')).statusCode).toBe(403);
      });
    });

    describe('a column whose earlier values only the audit log keeps', () => {
      it('is left out of record history and of a removed row, and kept on the audit page', async () => {
        const changed = await call('owner', 'PATCH', 'followups/4', { values: { note: 'Dana leads on three now' } });
        expect(changed.statusCode, changed.body).toBe(200);
        // Read now, the value is there.
        expect(json<{ data: { note: string } }>(await call('dana', 'GET', 'followups/4')).data.note).toBe('Dana leads on three now');
        const history = await call('dana', 'GET', 'followups/4/history');
        expect(history.statusCode, history.body).toBe(200);
        const [update] = json<{ entries: Entry[] }>(history).entries;
        expect(update!.action).toBe('record.update');
        expect(update!.changes!.before).not.toHaveProperty('note');
        expect(update!.changes!.after).not.toHaveProperty('note');
        expect(update!.changes!.before).toMatchObject({ id: 4, owner_id: w.people.dana });
        // The owner's own read of record history leaves it out too: it is the audit page's alone.
        const owners = json<{ entries: Entry[] }>(await call('owner', 'GET', 'followups/4/history')).entries[0]!;
        expect(owners.changes!.before).not.toHaveProperty('note');
        // The audit page keeps it.
        const audit = await w.app.inject({ method: 'GET', url: '/api/v1/audit?limit=50', headers: { cookie: await as('owner') } });
        expect(audit.statusCode, audit.body).toBe(200);
        const kept = json<{ entries: { action: string; entity: { pk?: Record<string, unknown> } | null; changes: Entry['changes'] }[] }>(audit).entries.find((entry) => entry.action === 'record.update' && String(entry.entity?.pk?.['id']) === '4');
        expect(kept!.changes!.before).toMatchObject({ note: 'Dana helps on three' });
        expect(kept!.changes!.after).toMatchObject({ note: 'Dana leads on three now' });
        // A removed follow-up's row, and its history, leave it out too.
        expect((await call('owner', 'DELETE', 'followups/4')).statusCode).toBe(200);
        const removed = (await removedUnder('dana', 'deals/3/removed/followups')).find((row) => row.key === '4');
        expect(removed!.row).toEqual({ id: 4, deal_id: 3, owner_id: w.people.dana });
        const old = json<{ entries: Entry[] }>(await call('dana', 'GET', 'deals/3/removed/followups/4/history')).entries;
        expect(old.map((entry) => entry.action)).toEqual(['record.delete', 'record.update']);
        for (const entry of old) {
          expect(entry.changes!.before ?? {}).not.toHaveProperty('note');
          expect(entry.changes!.after ?? {}).not.toHaveProperty('note');
        }
        // Nor is it kept in the store beside the removed row.
        const stored = await w.meta.db.selectFrom('adminium_removed_rows').select('image').where('entityTable', '=', w.id('followups')).where('entityId', '=', '4').execute();
        expect(stored.length).toBeGreaterThan(0);
        for (const row of stored) expect(row.image).not.toContain('Dana leads');
      });
    });
  });
}
