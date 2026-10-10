// SPDX-License-Identifier: AGPL-3.0-only
/**
 * assistantUseRepo — what each person has used of the assistant, a UTC day at
 * a time (migration `0053_assistant_use`).
 *
 * ADDING IS ONE STATEMENT. `tokens = tokens + n` in the database, never a read
 * here and a write back: two turns of one person ending in the same instant
 * both count. The row is made on the first use of the day (UPDATE first,
 * INSERT on none; a second writer that loses the INSERT to a first adds to
 * the row that now exists).
 */
import { sql } from 'kysely';

import type { MetaDb } from '../connect.js';

export interface AssistantUse {
  userId: string;
  /** The UTC day, `YYYY-MM-DD`. */
  day: string;
  tokens: number;
  turns: number;
  voiceSeconds: number;
}

/** What one addition carries; each defaults to nothing. */
export interface AssistantUseDelta {
  tokens?: number;
  turns?: number;
  voiceSeconds?: number;
}

/** The UTC day an instant falls on, as the table spells it. */
export function assistantUseDay(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

/** The first instant of the UTC day after the one `at` falls on: when a day's allowance turns over. */
export function assistantUseResetsAt(at: number): number {
  const day = new Date(at);
  return Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() + 1);
}

function whole(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value) ? 0 : Math.max(0, Math.round(value));
}

export function assistantUseRepo(meta: MetaDb) {
  const { db } = meta;

  async function get(userId: string, day: string): Promise<AssistantUse> {
    const row = await db.selectFrom('adminium_assistant_use').selectAll().where('userId', '=', userId).where('day', '=', day).executeTakeFirst();
    return row === undefined
      ? { userId, day, tokens: 0, turns: 0, voiceSeconds: 0 }
      : { userId: row.userId, day: row.day, tokens: Number(row.tokens), turns: Number(row.turns), voiceSeconds: Number(row.voiceSeconds) };
  }

  async function addTo(userId: string, day: string, delta: Required<AssistantUseDelta>): Promise<boolean> {
    const res = await db
      .updateTable('adminium_assistant_use')
      .set({
        tokens: sql<number>`tokens + ${delta.tokens}`,
        turns: sql<number>`turns + ${delta.turns}`,
        voiceSeconds: sql<number>`voice_seconds + ${delta.voiceSeconds}`,
      })
      .where('userId', '=', userId)
      .where('day', '=', day)
      .executeTakeFirst();
    return Number(res.numUpdatedRows) > 0;
  }

  return {
    get,

    /** Add to a person's day, and answer what the day holds now. */
    async add(userId: string, day: string, delta: AssistantUseDelta): Promise<AssistantUse> {
      const add = { tokens: whole(delta.tokens), turns: whole(delta.turns), voiceSeconds: whole(delta.voiceSeconds) };
      if (!(await addTo(userId, day, add))) {
        try {
          await db.insertInto('adminium_assistant_use').values({ userId, day, tokens: add.tokens, turns: add.turns, voiceSeconds: add.voiceSeconds }).execute();
        } catch (error) {
          // Somebody made today's row between the two statements: add to theirs.
          if (!(await addTo(userId, day, add))) throw error;
        }
      }
      return get(userId, day);
    },

    /** Everybody who used the assistant on one day, most first. */
    async listDay(day: string): Promise<AssistantUse[]> {
      const rows = await db.selectFrom('adminium_assistant_use').selectAll().where('day', '=', day).orderBy('tokens', 'desc').orderBy('userId', 'asc').execute();
      return rows.map((row) => ({ userId: row.userId, day: row.day, tokens: Number(row.tokens), turns: Number(row.turns), voiceSeconds: Number(row.voiceSeconds) }));
    },

    /** Forget days before one: a day's use matters on that day. */
    async purgeBefore(day: string): Promise<number> {
      const res = await db.deleteFrom('adminium_assistant_use').where('day', '<', day).executeTakeFirst();
      return Number(res.numDeletedRows);
    },
  };
}

export type AssistantUseRepo = ReturnType<typeof assistantUseRepo>;
