// SPDX-License-Identifier: AGPL-3.0-only
/**
 * teamsRepo — adminium_teams + adminium_team_members.
 *
 * A team is a named set of people; some of its members lead it. What a team
 * is FOR is one question, `leadReach`: the people whose rows a person reaches
 * because they lead a team those people are in. An ordinary member reaches
 * nobody through a team, and leading one team says nothing of another.
 */

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import { affected, readBool, writeBool } from './util.js';

export interface Team {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface TeamMember {
  teamId: string;
  userId: string;
  lead: boolean;
  createdAt: number;
}

/**
 * The most people one person's reach may add. A reach is bound into every
 * query that reads a limited table, so it has a ceiling, and a team page says
 * so before somebody leads more people than this.
 */
export const LEAD_REACH_MAX = 2000;

export function teamsRepo(meta: MetaDb) {
  const { db } = meta;

  async function findById(id: string): Promise<Team | null> {
    const row = await db.selectFrom('adminium_teams').selectAll().where('id', '=', id).executeTakeFirst();
    return row ?? null;
  }

  return {
    findById,

    async findByName(name: string): Promise<Team | null> {
      const row = await db.selectFrom('adminium_teams').selectAll().where('name', '=', name).executeTakeFirst();
      return row ?? null;
    },

    async list(): Promise<Team[]> {
      return db.selectFrom('adminium_teams').selectAll().orderBy('name').orderBy('id').execute();
    },

    async create(name: string, at: number = Date.now()): Promise<Team> {
      const row = { id: newId('team'), name, createdAt: at, updatedAt: at };
      await db.insertInto('adminium_teams').values(row).execute();
      return row;
    },

    async rename(id: string, name: string, at: number = Date.now()): Promise<boolean> {
      const result = await db.updateTable('adminium_teams').set({ name, updatedAt: at }).where('id', '=', id).executeTakeFirst();
      return affected(result.numUpdatedRows) > 0;
    },

    /** Deletes the team; its member rows go with it. */
    async delete(id: string): Promise<boolean> {
      const result = await db.deleteFrom('adminium_teams').where('id', '=', id).executeTakeFirst();
      return affected(result.numDeletedRows) > 0;
    },

    async members(teamId: string): Promise<TeamMember[]> {
      const rows = await db.selectFrom('adminium_team_members').selectAll().where('teamId', '=', teamId).orderBy('createdAt').orderBy('userId').execute();
      return rows.map((row) => ({ teamId: row.teamId, userId: row.userId, lead: readBool(row.lead), createdAt: row.createdAt }));
    },

    /** Every team a person is in, with whether they lead it. */
    async teamsOf(userId: string): Promise<TeamMember[]> {
      const rows = await db.selectFrom('adminium_team_members').selectAll().where('userId', '=', userId).orderBy('teamId').execute();
      return rows.map((row) => ({ teamId: row.teamId, userId: row.userId, lead: readBool(row.lead), createdAt: row.createdAt }));
    },

    /** Puts a person in a team, or changes whether they lead it. */
    async setMember(teamId: string, userId: string, lead: boolean, at: number = Date.now()): Promise<void> {
      const updated = await db
        .updateTable('adminium_team_members')
        .set({ lead: writeBool(meta, lead) })
        .where('teamId', '=', teamId)
        .where('userId', '=', userId)
        .executeTakeFirst();
      if (affected(updated.numUpdatedRows) > 0) return;
      // Nothing updated is "not a member yet" — or, on MySQL, "already as asked": a second insert would collide.
      const held = await db.selectFrom('adminium_team_members').select('userId').where('teamId', '=', teamId).where('userId', '=', userId).executeTakeFirst();
      if (held !== undefined) return;
      await db.insertInto('adminium_team_members').values({ teamId, userId, lead: writeBool(meta, lead), createdAt: at }).execute();
    },

    async removeMember(teamId: string, userId: string): Promise<boolean> {
      const result = await db.deleteFrom('adminium_team_members').where('teamId', '=', teamId).where('userId', '=', userId).executeTakeFirst();
      return affected(result.numDeletedRows) > 0;
    },

    /**
     * The people this person reaches by leading: every other member of every
     * team they lead, each once, in id order, and at most
     * {@link LEAD_REACH_MAX} of them (`capped` says the list was cut).
     */
    async leadReach(userId: string): Promise<{ ids: string[]; capped: boolean }> {
      const led = await db.selectFrom('adminium_team_members').select('teamId').where('userId', '=', userId).where('lead', '=', writeBool(meta, true)).execute();
      if (led.length === 0) return { ids: [], capped: false };
      const rows = await db
        .selectFrom('adminium_team_members')
        .select('userId')
        .distinct()
        .where('teamId', 'in', led.map((row) => row.teamId))
        .where('userId', '!=', userId)
        .orderBy('userId')
        .limit(LEAD_REACH_MAX + 1)
        .execute();
      return { ids: rows.slice(0, LEAD_REACH_MAX).map((row) => row.userId), capped: rows.length > LEAD_REACH_MAX };
    },
  };
}
