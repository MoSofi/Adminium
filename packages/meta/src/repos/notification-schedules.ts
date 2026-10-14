// SPDX-License-Identifier: AGPL-3.0-only
/**
 * notificationSchedulesRepo — adminium_notification_schedules: when a person
 * is told. Their time zone, the hours of each weekday they are not to be
 * disturbed in, and the day and time their summaries are sent.
 *
 * A missing row means none of it (every notice at once), so the table holds
 * only people who set something. Two switches are kept beside the hours
 * (wave 0060): quiet hours switched off, the hours kept for when they are on
 * again; and "not me" for summaries, the day and time kept the same way. The zone is used for WHEN a notice reaches
 * the person and for nothing else: what a notice or a summary counts as
 * "today" or "this week" is the business's, not the reader's.
 */

import type { MetaDb } from '../connect.js';
import { notificationQuietSchema, type NotificationQuiet } from '../schema/json-payloads.js';
import { packJson, readBool, readJsonOrNull, writeBool } from './util.js';

export interface NotificationSchedule {
  userId: string;
  timezone: string | null;
  quiet: NotificationQuiet | null;
  digestDay: number | null;
  digestTime: string | null;
  /** Quiet hours switched off: nothing is held, and the hours stay for when they are on again. */
  quietOff: boolean;
  /** "Not me": no rule's summary is made for this person. */
  summariesOff: boolean;
  updatedAt: number;
}

export interface NotificationScheduleInput {
  timezone: string | null;
  quiet: NotificationQuiet | null;
  digestDay: number | null;
  digestTime: string | null;
  /** Off when left out. Kept only while there are hours to keep: with none, quiet hours are simply not there. */
  quietOff?: boolean | undefined;
  /** Off when left out. */
  summariesOff?: boolean | undefined;
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
      const quiet = quietOf(row.quiet);
      return {
        userId: row.userId,
        timezone: row.timezone,
        quiet,
        digestDay: row.digestDay,
        digestTime: row.digestTime,
        quietOff: quiet !== null && readBool(row.quietOff),
        summariesOff: readBool(row.summariesOff),
        updatedAt: row.updatedAt,
      };
    },

    /** Writes the person's row, or takes it away when nothing is set any more. */
    async set(userId: string, input: NotificationScheduleInput, at: number = Date.now()): Promise<NotificationSchedule | null> {
      const quiet = input.quiet === null || Object.keys(input.quiet).length === 0 ? null : notificationQuietSchema.parse(input.quiet);
      const quietOff = quiet !== null && input.quietOff === true;
      const summariesOff = input.summariesOff === true;
      if (input.timezone === null && quiet === null && input.digestDay === null && input.digestTime === null && !summariesOff) {
        await db.deleteFrom('adminium_notification_schedules').where('userId', '=', userId).execute();
        return null;
      }
      const values = {
        timezone: input.timezone,
        quiet: quiet === null ? null : packJson(quiet),
        digestDay: input.digestDay,
        digestTime: input.digestTime,
        quietOff: writeBool(meta, quietOff),
        summariesOff: writeBool(meta, summariesOff),
        updatedAt: at,
      };
      // Looked up first: a write of the very values a row already holds counts no row changed on MySQL.
      const held = await db.selectFrom('adminium_notification_schedules').select('userId').where('userId', '=', userId).executeTakeFirst();
      if (held === undefined) await db.insertInto('adminium_notification_schedules').values({ userId, ...values }).execute();
      else await db.updateTable('adminium_notification_schedules').set(values).where('userId', '=', userId).execute();
      return this.find(userId);
    },
  };
}
