// SPDX-License-Identifier: AGPL-3.0-only
/**
 * notificationPrefsRepo — adminium_notification_prefs (07-meta-store.md §3.21):
 * composite-PK `(user_id, event_key)` matrix of per-event delivery channels
 * (`notificationChannelsSchema` — inApp / email / push).
 *
 * A missing row means "defaults" ({@link DEFAULT_NOTIFICATION_CHANNELS}), so
 * the table only stores deviations — reads merge, writes upsert. Channel
 * AVAILABILITY (no SMTP ⇒ email undeliverable) is a server concern layered on
 * top; the repo stores the user's intent verbatim so it survives the day a
 * transport appears (§8.2 never-hide-always-explain).
 */

import type { MetaDb } from '../connect.js';
import { notificationChannelsSchema, type NotificationChannels } from '../schema/json-payloads.js';
import { affected, packJson, readJson } from './util.js';

/** Default per-event channels when no row exists (comp: push opt-in). */
export const DEFAULT_NOTIFICATION_CHANNELS: NotificationChannels = {
  inApp: true,
  email: true,
  push: false,
};

export interface NotificationPref {
  userId: string;
  eventKey: string;
  channels: NotificationChannels;
  updatedAt: number;
}

export function notificationPrefsRepo(meta: MetaDb) {
  const { db } = meta;

  async function get(userId: string, eventKey: string): Promise<NotificationPref | null> {
    const row = await db
      .selectFrom('adminium_notification_prefs')
      .selectAll()
      .where('userId', '=', userId)
      .where('eventKey', '=', eventKey)
      .executeTakeFirst();
    if (row === undefined) return null;
    return {
      userId: row.userId,
      eventKey: row.eventKey,
      channels: notificationChannelsSchema.parse(readJson(row.channels)),
      updatedAt: row.updatedAt,
    };
  }

  return {
    get,

    /** Stored channels for one event, defaults when no row exists. */
    async channelsFor(userId: string, eventKey: string): Promise<NotificationChannels> {
      return (await get(userId, eventKey))?.channels ?? { ...DEFAULT_NOTIFICATION_CHANNELS };
    },

    async listForUser(userId: string): Promise<NotificationPref[]> {
      const rows = await db
        .selectFrom('adminium_notification_prefs')
        .selectAll()
        .where('userId', '=', userId)
        .orderBy('eventKey', 'asc')
        .execute();
      return rows.map((row) => ({
        userId: row.userId,
        eventKey: row.eventKey,
        channels: notificationChannelsSchema.parse(readJson(row.channels)),
        updatedAt: row.updatedAt,
      }));
    },

    /**
     * Composite-PK upsert, portably: UPDATE first, INSERT on zero affected
     * rows (the meta store has no cross-dialect ON CONFLICT — repos/util.ts).
     */
    async upsert(
      userId: string,
      eventKey: string,
      channels: NotificationChannels,
      at: number = Date.now(),
    ): Promise<NotificationPref> {
      const packed = packJson(notificationChannelsSchema.parse(channels));
      const res = await db
        .updateTable('adminium_notification_prefs')
        .set({ channels: packed, updatedAt: at })
        .where('userId', '=', userId)
        .where('eventKey', '=', eventKey)
        .executeTakeFirst();
      if (affected(res.numUpdatedRows) === 0) {
        await db
          .insertInto('adminium_notification_prefs')
          .values({ userId, eventKey, channels: packed, updatedAt: at })
          .execute();
      }
      return { userId, eventKey, channels, updatedAt: at };
    },
  };
}

export type NotificationPrefsRepo = ReturnType<typeof notificationPrefsRepo>;
