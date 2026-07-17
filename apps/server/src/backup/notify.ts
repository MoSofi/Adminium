/**
 * The completion notification (11-electron.md §9: "Completion raises an
 * `adminium_notifications` entry with 'Show in folder'").
 *
 * ─── Why this is a hand-rolled insert ────────────────────────────────────────
 *
 * `adminium_notifications` has no repo in `@adminium/meta` because nothing has
 * ever written one — this is the first producer in the product. A repo is the
 * right home for the second one; inventing the whole notifications API from
 * inside the backup track would be a worse kind of guess than a scoped insert
 * with its reasoning written down. Flagged rather than hidden.
 *
 * ─── "Show in folder" is not an `action_url` ─────────────────────────────────
 *
 * Every other affordance in that table is a link the SPA can follow. Revealing a
 * file in Finder/Explorer is not: it is `shell.showItemInFolder`, which lives in
 * the main process behind §4's bridge. So the row carries the PATH in `entity`
 * and leaves `action_url` null, and the notification centre renders the button
 * only when `window.adminiumDesktop` exists (§4's detection contract). On
 * self-host the same row, if it ever appeared, would render as a plain "backup
 * finished" line — which is the correct degradation rather than a dead button.
 *
 * ─── Language ────────────────────────────────────────────────────────────────
 *
 * The strings are en-US and are NOT routed through `@adminium/i18n`, because a
 * notification row is written once and read later, possibly by a user who has
 * since changed locale — translating at write time bakes in the wrong answer.
 * `kind` is the stable, translatable key (`desktop.backup.completed`) and
 * `entity` carries the substitutions, so the notification centre can localize at
 * RENDER time; `title`/`body` are the fallback for a client that does not know
 * this kind. Same shape the audit log uses for the same reason.
 */

import { newId, packJson, type MetaDb } from '@adminium/meta';

/** The stable key the notification centre localizes on. */
export const BACKUP_NOTIFICATION_KIND = 'desktop.backup.completed';

export interface BackupNotificationInput {
  meta: MetaDb;
  /** Who gets the row. `adminium_notifications.user_id` is NOT NULL. */
  userId: string;
  /** Absolute path of the archive — the "Show in folder" target. */
  path: string;
  bytes: number;
  /** How many local source DBs went in, for the body line. */
  databases: number;
  at?: number | undefined;
}

/** Bytes → `12.4 MB`, for the body line only. */
function humanBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? String(value) : value.toFixed(1)} ${units[unit] ?? 'B'}`;
}

/**
 * Insert the row. Best-effort at the CALL SITE, not here: a failure to write a
 * notification must never fail the backup that succeeded (see the route), but it
 * must also not be silently swallowed inside the writer, where nobody would ever
 * learn about it.
 */
export async function notifyBackupCompleted(input: BackupNotificationInput): Promise<void> {
  const at = input.at ?? Date.now();
  await input.meta.db
    .insertInto('adminium_notifications')
    .values({
      id: newId('ntf'),
      userId: input.userId,
      kind: BACKUP_NOTIFICATION_KIND,
      actorLabel: 'Adminium',
      title: 'Backup complete',
      body: `${String(input.databases)} database${input.databases === 1 ? '' : 's'} · ${humanBytes(
        input.bytes,
      )}`,
      entity: packJson({ kind: 'backup', path: input.path, bytes: input.bytes }),
      actionUrl: null,
      readAt: null,
      createdAt: at,
    })
    .execute();
}
