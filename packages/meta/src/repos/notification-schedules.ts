// SPDX-License-Identifier: AGPL-3.0-only
/**
 * notificationSchedulesRepo — adminium_notification_schedules: when a person
 * is told. Their time zone, the hours of each weekday they are not to be
 * disturbed in, and the day and time their summaries are sent.
 *
 * A missing row means none of it (every notice at once), so the table holds
 * only people who set something. The zone is used for WHEN a notice reaches
 * the person and for nothing else: what a notice or a summary counts as
 * "today" or "this week" is the business's, not the reader's.
 */

import type { MetaDb } from '../connect.js';
import { notificationQuietSchema, type NotificationQuiet } from '../schema/json-payloads.js';
import { packJson, readJsonOrNull } from './util.js';

export interface NotificationSchedule {
  userId: string;
  timezone: string | null;
  quiet: NotificationQuiet | null;
  digestDay: number | null;
  digestTime: string | null;
  updatedAt: number;
}

export interface NotificationScheduleInput {
  timezone: string | null;
  quiet: NotificationQuiet | null;
  digestDay: number | null;
  digestTime: string | null;
}

function quietOf(value: unknown): NotificationQuiet | null {
  const read = value === null || value === undefined ? null : readJsonOrNull<unknown>(value);
  const parsed = notificationQuietSchema.safeParse(read);
  return parsed.success && Object.keys(parsed.data).length > 0 ? parsed.data : null;
}

export function notificationSchedulesRepo(meta: MetaDb) {
  const { db } = meta;
  return {
    async find(userId: string): Promise<NotificationSchedule | null> {
      const row = await db.selectFrom('adminium_notification_schedules').selectAll().where('userId', '=', userId).executeTakeFirst();
      if (row === undefined) return null;
      return { userId: row.userId, timezone: row.timezone, quiet: quietOf(row.quiet), digestDay: row.digestDay, digestTime: row.digestTime, updatedAt: row.updatedAt };
    },

    /** Writes the person's row, or takes it away when nothing is set any more. */
    async set(userId: string, input: NotificationScheduleInput, at: number = Date.now()): Promise<NotificationSchedule | null> {
      const quiet = input.quiet === null || Object.keys(input.quiet).length === 0 ? null : notificationQuietSchema.parse(input.quiet);
      if (input.timezone === null && quiet === null && input.digestDay === null && input.digestTime === null) {
        await db.deleteFrom('adminium_notification_schedules').where('userId', '=', userId).execute();
        return null;
      }
      const values = { timezone: input.timezone, quiet: quiet === null ? null : packJson(quiet), digestDay: input.digestDay, digestTime: input.digestTime, updatedAt: at };
      // Looked up first: a write of the very values a row already holds counts no row changed on MySQL.
      const held = await db.selectFrom('adminium_notification_schedules').select('userId').where('userId', '=', userId).executeTakeFirst();
      if (held === undefined) await db.insertInto('adminium_notification_schedules').values({ userId, ...values }).execute();
      else await db.updateTable('adminium_notification_schedules').set(values).where('userId', '=', userId).execute();
      return this.find(userId);
    },
  };
}
