// SPDX-License-Identifier: AGPL-3.0-only
/**
 * notificationsRepo — adminium_notifications (07-meta-store.md §3.20): one row
 * per in-app notification. Write-once rows read later, so `kind` is the
 * stable, translatable key and `title`/`body` are the en-US fallback for a
 * client that does not know the kind (the backup/notify.ts convention — the
 * first producer — now shared by every producer through this repo).
 *
 * Keyset pagination: `(created_at DESC, id DESC)` — ids are monotonic ULIDs,
 * so the pair is a stable total order (08-server-api.md §1.5).
 */

import type { Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import type { AdminiumNotificationsTable } from '../schema/tables.js';
import { affected, packJson, readJsonOrNull } from './util.js';

export interface Notification {
  id: string;
  userId: string;
  /** Stable localization key, e.g. `report.ready`, `desktop.backup.completed`. */
  kind: string;
  actorLabel: string;
  title: string;
  body: string | null;
  /** Kind-specific substitutions the client localizes at RENDER time. */
  entity: Record<string, unknown> | null;
  actionUrl: string | null;
  readAt: number | null;
  createdAt: number;
}

export interface CreateNotificationInput {
  userId: string;
  kind: string;
  /** Defaults to the system actor label (ia-mapping keeper). */
  actorLabel?: string | undefined;
  title: string;
  body?: string | null | undefined;
  entity?: Record<string, unknown> | null | undefined;
  actionUrl?: string | null | undefined;
}

/** Keyset cursor — the last row of the previous page. */
export interface NotificationCursor {
  createdAt: number;
  id: string;
}

export interface ListNotificationsOptions {
  unreadOnly?: boolean | undefined;
  limit?: number | undefined;
  before?: NotificationCursor | undefined;
}

/** System-actor events render actor "Adminium" (09-generated-app.md §5.4). */
export const SYSTEM_ACTOR_LABEL = 'Adminium';

function decode(row: Selectable<AdminiumNotificationsTable>): Notification {
  return {
    id: row.id,
    userId: row.userId,
    kind: row.kind,
    actorLabel: row.actorLabel,
    title: row.title,
    body: row.body,
    entity: readJsonOrNull<Record<string, unknown>>(row.entity),
    actionUrl: row.actionUrl,
    readAt: row.readAt,
    createdAt: row.createdAt,
  };
}

export function notificationsRepo(meta: MetaDb) {
  const { db } = meta;

  return {
    async create(input: CreateNotificationInput, at: number = Date.now()): Promise<Notification> {
      const row = {
        id: newId('ntf'),
        userId: input.userId,
        kind: input.kind,
        actorLabel: input.actorLabel ?? SYSTEM_ACTOR_LABEL,
        title: input.title,
        body: input.body ?? null,
        entity: input.entity === null || input.entity === undefined ? null : packJson(input.entity),
        actionUrl: input.actionUrl ?? null,
        readAt: null,
        createdAt: at,
      };
      await db.insertInto('adminium_notifications').values(row).execute();
      return decode(row as Selectable<AdminiumNotificationsTable>);
    },

    async findById(id: string): Promise<Notification | null> {
      const row = await db
        .selectFrom('adminium_notifications')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      return row ? decode(row) : null;
    },

    /** Newest first; keyset `before` = the previous page's last row. */
    async listForUser(userId: string, opts: ListNotificationsOptions = {}): Promise<Notification[]> {
      let query = db.selectFrom('adminium_notifications').selectAll().where('userId', '=', userId);
      if (opts.unreadOnly === true) query = query.where('readAt', 'is', null);
      const before = opts.before;
      if (before !== undefined) {
        query = query.where((eb) =>
          eb.or([
            eb('createdAt', '<', before.createdAt),
            eb.and([eb('createdAt', '=', before.createdAt), eb('id', '<', before.id)]),
          ]),
        );
      }
      const rows = await query
        .orderBy('createdAt', 'desc')
        .orderBy('id', 'desc')
        .limit(opts.limit ?? 20)
        .execute();
      return rows.map(decode);
    },

    /** The nav-badge / bell number (09 §5.4 `unread-count`). */
    async unreadCount(userId: string): Promise<number> {
      const row = await db
        .selectFrom('adminium_notifications')
        .select((eb) => eb.fn.countAll().as('count'))
        .where('userId', '=', userId)
        .where('readAt', 'is', null)
        .executeTakeFirst();
      return Number(row?.count ?? 0);
    },

    /** Scoped to the owner — a foreign id is a silent no-op, never a leak. */
    async markRead(id: string, userId: string, at: number = Date.now()): Promise<boolean> {
      const res = await db
        .updateTable('adminium_notifications')
        .set({ readAt: at })
        .where('id', '=', id)
        .where('userId', '=', userId)
        .where('readAt', 'is', null)
        .executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },

    async markAllRead(userId: string, at: number = Date.now()): Promise<number> {
      const res = await db
        .updateTable('adminium_notifications')
        .set({ readAt: at })
        .where('userId', '=', userId)
        .where('readAt', 'is', null)
        .executeTakeFirst();
      return affected(res.numUpdatedRows);
    },
  };
}

export type NotificationsRepo = ReturnType<typeof notificationsRepo>;
