// SPDX-License-Identifier: AGPL-3.0-only
/**
 * pictureUseRepo — pictures made with AI, held to a day's allowance per
 * person and for everybody.
 *
 * TAKING IS ONE CHECK-AND-ADD. `made = made + n WHERE made + n <= limit` in
 * the database: the count is taken only when it fits, by the statement that
 * takes it. The person's and everybody's are taken in one transaction, so a
 * request that fits the one and not the other takes neither. A day's row is
 * made on its first use (UPDATE first, INSERT on none; a second writer that
 * loses the INSERT to a first tries the UPDATE again).
 */
import { sql, type Transaction } from 'kysely';

import type { MetaDb } from '../connect.js';
import type { MetaDB } from '../schema/tables.js';

export interface PictureUse {
  /** What this person has made this day. */
  mine: number;
  /** What everybody has made this day. */
  all: number;
}

export type PictureTake = { ok: true; use: PictureUse } | { ok: false; over: 'mine' | 'all'; use: PictureUse };

const whole = (value: number): number => (Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0);

export function pictureUseRepo(meta: MetaDb) {
  const { db } = meta;

  async function use(userId: string, day: string, on: Transaction<MetaDB> | MetaDb['db'] = db): Promise<PictureUse> {
    const [mine, all] = await Promise.all([
      on.selectFrom('adminium_assistant_use').select('picturesMade').where('userId', '=', userId).where('day', '=', day).executeTakeFirst(),
      on.selectFrom('adminium_picture_use').select('made').where('day', '=', day).executeTakeFirst(),
    ]);
    return { mine: Number(mine?.picturesMade ?? 0), all: Number(all?.made ?? 0) };
  }

  /** Take `n` from the person's row when it fits under `limit`; the row is made on the day's first use. */
  async function takeMine(trx: Transaction<MetaDB>, userId: string, day: string, n: number, limit: number): Promise<boolean> {
    const added = await trx
      .updateTable('adminium_assistant_use')
      .set({ picturesMade: sql<number>`pictures_made + ${n}` })
      .where('userId', '=', userId)
      .where('day', '=', day)
      .where(sql<boolean>`pictures_made + ${n} <= ${limit}`)
      .executeTakeFirst();
    if (Number(added.numUpdatedRows) > 0) return true;
    const exists = await trx.selectFrom('adminium_assistant_use').select('userId').where('userId', '=', userId).where('day', '=', day).executeTakeFirst();
    if (exists !== undefined || n > limit) return false;
    await trx.insertInto('adminium_assistant_use').values({ userId, day, tokens: 0, turns: 0, voiceSeconds: 0, picturesMade: n }).execute();
    return true;
  }

  async function takeAll(trx: Transaction<MetaDB>, day: string, n: number, limit: number): Promise<boolean> {
    const added = await trx
      .updateTable('adminium_picture_use')
      .set({ made: sql<number>`made + ${n}` })
      .where('day', '=', day)
      .where(sql<boolean>`made + ${n} <= ${limit}`)
      .executeTakeFirst();
    if (Number(added.numUpdatedRows) > 0) return true;
    const exists = await trx.selectFrom('adminium_picture_use').select('day').where('day', '=', day).executeTakeFirst();
    if (exists !== undefined || n > limit) return false;
    await trx.insertInto('adminium_picture_use').values({ day, made: n }).execute();
    return true;
  }

  return {
    use: (userId: string, day: string): Promise<PictureUse> => use(userId, day),

    /**
     * Take `n` pictures from the person's day and everybody's, or neither.
     * `mine` and `all` are the day's limits (a limit of 0 takes nothing: the
     * caller refuses before asking). A day's first row made at the same time
     * by two requests: the loser's statement fails, and it is tried once more.
     */
    async take(userId: string, day: string, n: number, limits: { mine: number; all: number }): Promise<PictureTake> {
      const count = whole(n);
      const attempt = async (): Promise<PictureTake> =>
        db.transaction().execute(async (trx) => {
          if (!(await takeMine(trx, userId, day, count, whole(limits.mine)))) return { ok: false as const, over: 'mine' as const, use: await use(userId, day, trx) };
          if (!(await takeAll(trx, day, count, whole(limits.all)))) {
            // Neither: the person's share goes back inside the same transaction.
            await trx.updateTable('adminium_assistant_use').set({ picturesMade: sql<number>`pictures_made - ${count}` }).where('userId', '=', userId).where('day', '=', day).execute();
            return { ok: false as const, over: 'all' as const, use: await use(userId, day, trx) };
          }
          return { ok: true as const, use: await use(userId, day, trx) };
        });
      try {
        return await attempt();
      } catch {
        return attempt();
      }
    },

    /** Give back pictures the answer proves were never made (a refused key, no such route). Never below nothing. */
    async giveBack(userId: string, day: string, n: number): Promise<void> {
      const back = whole(n);
      if (back === 0) return;
      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable('adminium_assistant_use')
          .set({ picturesMade: sql<number>`CASE WHEN pictures_made > ${back} THEN pictures_made - ${back} ELSE 0 END` })
          .where('userId', '=', userId)
          .where('day', '=', day)
          .execute();
        await trx
          .updateTable('adminium_picture_use')
          .set({ made: sql<number>`CASE WHEN made > ${back} THEN made - ${back} ELSE 0 END` })
          .where('day', '=', day)
          .execute();
      });
    },

    /** Forget days before one. */
    async purgeBefore(day: string): Promise<number> {
      const res = await db.deleteFrom('adminium_picture_use').where('day', '<', day).executeTakeFirst();
      return Number(res.numDeletedRows);
    },
  };
}
