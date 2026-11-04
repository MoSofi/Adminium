// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A MESSAGE NEVER STOPS THE ROW IT IS ABOUT FROM BEING REMOVED.
 *
 * An outbox row names the row it is about through a foreign key, and that
 * key has no delete action: a visit with one message in the log, sent a year
 * ago or waiting to go, could never be removed again. An app that says a
 * row's removal is something its people are written about (a producer with
 * `onDelete`) says with it that the row may go, so for that table, and for
 * the link that producer names:
 *
 *  - as a row goes, every message that names it through the link LOSES THE
 *    LINK. The message stays in the log, with its kind, its address, when it
 *    went and what it kept of the row (`was`); it no longer says which row;
 *  - a message about it that had NOT GONE YET (queued, or held for a person)
 *    is skipped as no longer needed: nobody is told a visit moved after it
 *    was called off, and a template that reads the row could not be filled.
 *
 * Both happen in the statement's own transaction, just before the DELETE, and
 * are put back when the DELETE then removes nothing (a row out of the
 * caller's reach). A refusal (the table's states, another table's key) rolls
 * them back with everything else.
 *
 * WHY NOT A DELETE ACTION ON THE KEY. `ON DELETE SET NULL` would do the first
 * half inside the database, for every writer. It would also need each
 * installed outbox table's key dropped and made again (a rebuild of the
 * whole table on SQLite) by an update nobody reviewed as a schema change, and
 * it cannot skip a waiting message. So the link is emptied here, where the
 * row is removed through Adminium; a row removed by a statement Adminium did
 * not write is still refused by the database while a message names it.
 *
 * A TABLE WHOSE ROWS EXPIRE. An add-on that says its rows go after a time
 * (`expire`: a shopper's design never ordered) says with it that they may go
 * whatever was mailed about them, so every link of every outbox that points
 * at such a table lets go the same way, on every removal of its rows: the
 * daily expiry, a staff delete, a guest deleting their own draft. A message
 * already sent stays in the log as it was sent (kind, address, when it went);
 * one not sent yet is skipped, never sent about a row that is gone.
 */
import { removalTableOf, type Outbox } from '@adminium/manifest';
import type { Kysely } from 'kysely';

import type { SourceDatabase } from '../connections/manager.js';
import type { Row } from '../crud/mask.js';
import { skipSentence } from './skip-sentence.js';

type Db = Kysely<SourceDatabase>;

/** One outbox link that lets go of a table's rows as they are removed. */
export interface ReleasedLink {
  /** The outbox table, by its id. */
  outbox: string;
  /** The outbox's key column. */
  key: string;
  /** The link column that names the row. */
  link: string;
  /**
   * The message's status column: a message not gone yet is skipped. Absent
   * for a table whose rows only lose the link (a form answer's files, which
   * go after the answer: `forms/files.ts`).
   */
  status?: string | undefined;
  /** Where a skip says why: the reason column, else the error column, else nowhere. */
  skipReason?: string | undefined;
  error?: string | undefined;
}

/** What one release changed, so it can be put back: each message, with the status it had. */
export interface Released {
  link: ReleasedLink;
  id: unknown;
  rows: { key: unknown; status: unknown; reason: unknown }[];
}

/** The reason a message still waiting is skipped for when its row is removed. */
export const REMOVED_SKIP = 'no-longer-needed' as const;

/**
 * The links of one outbox that let go of `tableId`'s rows: the `link` of
 * each producer that announces a removal there. `keyOf` answers the outbox
 * table's single key column (none: nothing is released).
 */
export function releasedLinksOf(definition: Outbox, tableId: string, keyOf: (outbox: string) => string | undefined): ReleasedLink[] {
  const out = new Map<string, ReleasedLink>();
  const key = keyOf(definition.table);
  if (key === undefined) return [];
  for (const producer of definition.producers ?? []) {
    if (removalTableOf(producer) !== tableId || out.has(producer.link)) continue;
    const cols = definition.columns;
    out.set(producer.link, {
      outbox: definition.table,
      key,
      link: producer.link,
      status: cols.status,
      ...(cols.skipReason === undefined ? {} : { skipReason: cols.skipReason }),
      ...(cols.error === undefined ? {} : { error: cols.error }),
    });
  }
  return [...out.values()];
}

/**
 * The links of one outbox that let go of the rows of a table whose rows
 * EXPIRE (`expire` on an add-on's table: a design never ordered goes 90 days
 * after its last change): every link column of the outbox that points at
 * `tableId`, whatever its producers listen for. A message about such a row
 * must never keep it: a design whose private link was mailed once would
 * otherwise be kept for ever, words and photos with it. `pointsAt` answers
 * the table a column of the outbox points at.
 */
export function expiringLinksOf(definition: Outbox, tableId: string, keyOf: (outbox: string) => string | undefined, pointsAt: (outbox: string, column: string) => string | undefined): ReleasedLink[] {
  const key = keyOf(definition.table);
  if (key === undefined) return [];
  const columns = new Set([...Object.values(definition.links ?? {}), ...(definition.producers ?? []).map((producer) => producer.link)]);
  const cols = definition.columns;
  return [...columns]
    .filter((column) => pointsAt(definition.table, column) === tableId)
    .map((link) => ({
      outbox: definition.table,
      key,
      link,
      status: cols.status,
      ...(cols.skipReason === undefined ? {} : { skipReason: cols.skipReason }),
      ...(cols.error === undefined ? {} : { error: cols.error }),
    }));
}

/** The links of `more` not already in `links` (the same outbox and column), added to them. */
export function withLinks(links: readonly ReleasedLink[], more: readonly ReleasedLink[]): ReleasedLink[] {
  const out = [...links];
  for (const link of more) if (!out.some((one) => one.outbox === link.outbox && one.link === link.link)) out.push(link);
  return out;
}

/**
 * Empty every released link to the row `id`, and skip its messages that had
 * not gone. Inside the caller's transaction. Answers what it changed.
 */
export async function releaseLinks(db: Db, links: readonly ReleasedLink[], id: unknown): Promise<Released[]> {
  const out: Released[] = [];
  if (id === null || id === undefined) return out;
  for (const link of links) {
    const status = link.status;
    const where = status === undefined ? undefined : (link.skipReason ?? link.error);
    const rows = (await db
      .selectFrom(link.outbox as never)
      .select([link.key, ...(status === undefined ? [] : [status]), ...(where === undefined ? [] : [where])] as never)
      .where(link.link as never, '=', id as never)
      .execute()) as Row[];
    if (rows.length === 0) continue;
    const waiting = status === undefined ? [] : rows.filter((row) => row[status] === 'queued' || row[status] === 'held').map((row) => row[link.key]);
    if (status !== undefined && waiting.length > 0) {
      await db
        .updateTable(link.outbox as never)
        .set({ [status]: 'skipped', ...(link.skipReason !== undefined ? { [link.skipReason]: REMOVED_SKIP } : link.error !== undefined ? { [link.error]: skipSentence(REMOVED_SKIP) } : {}) } as never)
        .where(link.key as never, 'in', waiting as never)
        .execute();
    }
    await db.updateTable(link.outbox as never).set({ [link.link]: null } as never).where(link.link as never, '=', id as never).execute();
    out.push({ link, id, rows: rows.map((row) => ({ key: row[link.key], status: status === undefined ? null : row[status], reason: where === undefined ? null : row[where] })) });
  }
  return out;
}

/** Put back what a release changed: the row did not go after all. */
export async function restoreLinks(db: Db, released: readonly Released[]): Promise<void> {
  for (const { link, id, rows } of released) {
    const where = link.status === undefined ? undefined : (link.skipReason ?? link.error);
    for (const row of rows) {
      await db
        .updateTable(link.outbox as never)
        .set({ [link.link]: id, ...(link.status === undefined ? {} : { [link.status]: row.status }), ...(where === undefined ? {} : { [where]: row.reason }) } as never)
        .where(link.key as never, '=', row.key as never)
        .execute();
    }
  }
}
