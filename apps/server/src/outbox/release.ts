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
 */
import { removalTableOf, type Outbox } from '@adminium/manifest';
import type { Kysely } from 'kysely';

import type { SourceDatabase } from '../connections/manager.js';
import type { Row } from '../crud/mask.js';
import { skipSentence } from './timing.js';

type Db = Kysely<SourceDatabase>;

/** One outbox link that lets go of a table's rows as they are removed. */
export interface ReleasedLink {
  /** The outbox table, by its id. */
  outbox: string;
  /** The outbox's key column. */
  key: string;
  /** The link column that names the row. */
  link: string;
  status: string;
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
 * Empty every released link to the row `id`, and skip its messages that had
 * not gone. Inside the caller's transaction. Answers what it changed.
 */
export async function releaseLinks(db: Db, links: readonly ReleasedLink[], id: unknown): Promise<Released[]> {
  const out: Released[] = [];
  if (id === null || id === undefined) return out;
  for (const link of links) {
    const where = link.skipReason ?? link.error;
    const rows = (await db
      .selectFrom(link.outbox as never)
      .select([link.key, link.status, ...(where === undefined ? [] : [where])] as never)
      .where(link.link as never, '=', id as never)
      .execute()) as Row[];
    if (rows.length === 0) continue;
    const waiting = rows.filter((row) => row[link.status] === 'queued' || row[link.status] === 'held').map((row) => row[link.key]);
    if (waiting.length > 0) {
      await db
        .updateTable(link.outbox as never)
        .set({ [link.status]: 'skipped', ...(link.skipReason !== undefined ? { [link.skipReason]: REMOVED_SKIP } : link.error !== undefined ? { [link.error]: skipSentence(REMOVED_SKIP) } : {}) } as never)
        .where(link.key as never, 'in', waiting as never)
        .execute();
    }
    await db.updateTable(link.outbox as never).set({ [link.link]: null } as never).where(link.link as never, '=', id as never).execute();
    out.push({ link, id, rows: rows.map((row) => ({ key: row[link.key], status: row[link.status], reason: where === undefined ? null : row[where] })) });
  }
  return out;
}

/** Put back what a release changed: the row did not go after all. */
export async function restoreLinks(db: Db, released: readonly Released[]): Promise<void> {
  for (const { link, id, rows } of released) {
    const where = link.skipReason ?? link.error;
    for (const row of rows) {
      await db
        .updateTable(link.outbox as never)
        .set({ [link.link]: id, [link.status]: row.status, ...(where === undefined ? {} : { [where]: row.reason }) } as never)
        .where(link.key as never, '=', row.key as never)
        .execute();
    }
  }
}
