// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Teams (wave 0056), on every available dialect.
 *
 * - A team has a name no other team has; its members go with it, and with
 *   the person.
 * - Leading is per team: the people a lead reaches are the other members of
 *   the teams THEY lead, each once, and a plain member reaches nobody.
 * - A grant's row limit and the three row words are shapes the store keeps.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ALL_MIGRATIONS, LEAD_REACH_MAX, applyMigrations, overridePatchSchema, tableActionsSchema, teamsRepo, usersRepo } from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`teams [${dialect.name}]`, () => {
    let t: TestDb;
    beforeEach(async () => {
      t = await dialect.make();
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
    });
    afterEach(async () => {
      await t.destroy();
    });
    const person = async (name: string) => (await usersRepo(t.meta).create({ email: `${name}@example.test`, name, passwordHash: 'x' })).id;

    it('makes, renames and deletes a team, and refuses a name twice', async () => {
      const repo = teamsRepo(t.meta);
      const north = await repo.create('North', 1000);
      expect(north.id.startsWith('team_')).toBe(true);
      expect(await repo.findById(north.id)).toEqual({ id: north.id, name: 'North', createdAt: 1000, updatedAt: 1000 });
      await expect(repo.create('North')).rejects.toThrow();
      expect(await repo.rename(north.id, 'North and east', 2000)).toBe(true);
      expect(await repo.findByName('North and east')).toMatchObject({ id: north.id, updatedAt: 2000 });
      await repo.create('Key accounts');
      expect((await repo.list()).map((team) => team.name)).toEqual(['Key accounts', 'North and east']);
      expect(await repo.delete(north.id)).toBe(true);
      expect(await repo.delete(north.id)).toBe(false);
      expect(await repo.findById(north.id)).toBeNull();
    });

    it('keeps a member once, with whether they lead, as a boolean on every engine', async () => {
      const repo = teamsRepo(t.meta);
      const team = await repo.create('North');
      const dana = await person('dana');
      await repo.setMember(team.id, dana, false, 10);
      await repo.setMember(team.id, dana, false, 20);
      expect(await repo.members(team.id)).toEqual([{ teamId: team.id, userId: dana, lead: false, createdAt: 10 }]);
      await repo.setMember(team.id, dana, true);
      expect(await repo.members(team.id)).toEqual([{ teamId: team.id, userId: dana, lead: true, createdAt: 10 }]);
      expect(await repo.teamsOf(dana)).toEqual([{ teamId: team.id, userId: dana, lead: true, createdAt: 10 }]);
      expect(await repo.removeMember(team.id, dana)).toBe(true);
      expect(await repo.removeMember(team.id, dana)).toBe(false);
      await expect(repo.setMember('team_missing', dana, false)).rejects.toThrow();
    });

    it('a lead reaches the other members of the teams they lead, and of no team they only sit in', async () => {
      const repo = teamsRepo(t.meta);
      const [mara, dana, omar, lena, sam] = await Promise.all(['mara', 'dana', 'omar', 'lena', 'sam'].map(person));
      const north = await repo.create('North');
      const south = await repo.create('South');
      const managers = await repo.create('Managers');
      await repo.setMember(north.id, mara!, true);
      await repo.setMember(north.id, dana!, false);
      await repo.setMember(north.id, omar!, false);
      await repo.setMember(south.id, lena!, true);
      await repo.setMember(south.id, sam!, false);
      // Mara sits in two more teams and leads neither.
      await repo.setMember(south.id, mara!, false);
      await repo.setMember(managers.id, mara!, false);
      await repo.setMember(managers.id, lena!, false);
      expect(await repo.leadReach(mara!)).toEqual({ ids: [dana, omar].sort(), capped: false });
      expect(await repo.leadReach(lena!)).toEqual({ ids: [mara, sam].sort(), capped: false });
      expect(await repo.leadReach(dana!)).toEqual({ ids: [], capped: false });
      // Someone in two teams one person leads is reached once.
      await repo.setMember(managers.id, lena!, true);
      await repo.setMember(managers.id, sam!, false);
      expect((await repo.leadReach(lena!)).ids).toEqual([mara, sam].sort());
      expect(LEAD_REACH_MAX).toBe(2000);
    });

    it('a member row goes with its team and with its person', async () => {
      const repo = teamsRepo(t.meta);
      const team = await repo.create('North');
      const [mara, dana] = await Promise.all(['mara', 'dana'].map(person));
      await repo.setMember(team.id, mara!, true);
      await repo.setMember(team.id, dana!, false);
      // A person removed: the row goes by the database's own cascade, whoever deletes it.
      await t.meta.db.deleteFrom('adminium_users').where('id', '=', dana!).execute();
      expect((await repo.members(team.id)).map((member) => member.userId)).toEqual([mara]);
      expect(await repo.leadReach(mara!)).toEqual({ ids: [], capped: false });
      await repo.delete(team.id);
      expect(await repo.teamsOf(mara!)).toEqual([]);
    });
  });
}

describe('what the store keeps of a row limit', () => {
  const actions = { read: true, create: false, update: true, delete: false, export: false, import: false };

  it('a grant keeps which rows its read, update and delete reach', () => {
    const limit = { read: { reach: 'team', unowned: true }, update: { reach: 'own', while: { column: 'state', in: ['open'] } } };
    expect(tableActionsSchema.parse({ ...actions, rowLimit: limit }).rowLimit).toEqual(limit);
    expect(tableActionsSchema.parse(actions).rowLimit).toBeUndefined();
    expect(tableActionsSchema.safeParse({ ...actions, rowLimit: { read: { reach: 'mine' } } }).success).toBe(false);
    expect(tableActionsSchema.safeParse({ ...actions, rowLimit: { create: { reach: 'own' } } }).success).toBe(false);
  });

  it('a staff column, the ways people belong to a table, and a private table are override rows', () => {
    expect(overridePatchSchema.safeParse({ op: 'column.staff', value: { staff: true } }).success).toBe(true);
    const ways = [{ column: 'owner_id', set: 'team' }, { column: 'assignee_id', person: 'user_id' }, { through: { table: 'public.crm_covers', link: 'owner_id', on: 'owner_id', user: 'cover_id', from: 'starts_on', to: 'ends_on' } }, { via: 'deal_id' }];
    expect(overridePatchSchema.safeParse({ op: 'table.belongs', value: { ways } }).success).toBe(true);
    expect(overridePatchSchema.safeParse({ op: 'table.belongs', value: { ways: [] } }).success).toBe(false);
    expect(overridePatchSchema.safeParse({ op: 'table.belongs', value: { ways: [{ column: 'owner_id', team: true }] } }).success).toBe(false);
    expect(overridePatchSchema.safeParse({ op: 'table.private', value: { private: true } }).success).toBe(true);
    expect(overridePatchSchema.safeParse({ op: 'table.private', value: { private: false } }).success).toBe(false);
  });

  it('a record\'s button keeps its hand-over mark, on the two buttons that write a row', () => {
    const states = (action: Record<string, unknown>) => overridePatchSchema.safeParse({ op: 'table.states', value: { column: 'state', initial: 'open', moves: { open: ['won'] }, actions: [action] } });
    const give = { id: 'give', label: 'Hand over', set: {}, in: ['open'], ask: ['owner_id'], handOver: true };
    const kept = states(give);
    expect(kept.success).toBe(true);
    expect(((kept.data as { value: { actions: Record<string, unknown>[] } }).value.actions[0]!)['handOver']).toBe(true);
    expect(states({ id: 'win', label: 'Won', move: { to: 'won' }, ask: ['owner_id'], handOver: true }).success).toBe(true);
    expect(states({ ...give, handOver: false }).success).toBe(false);
    expect(states({ id: 'open', label: 'Open', link: { page: 'deals', param: 'deal' }, in: ['open'], handOver: true }).success).toBe(false);
  });
});
