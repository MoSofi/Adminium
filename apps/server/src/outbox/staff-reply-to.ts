// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A REPLY TO THE REP (`replyTo: {staff}` on a producer): a message about a
 * quote is sent by the business, and a reply to it goes to the person who
 * owns the quote.
 *
 * The row the message is about is the one its producer's `link` names. A
 * staff column of that row — or of the row one of its links names
 * (`deal_id.owner_id`: the quote's deal's owner) — holds the id of somebody
 * who signs in here; the address is that person's own sign-in address, read
 * from Adminium's store when the message goes — never a text of the row,
 * never one somebody typed.
 *
 * NOBODY THERE IS NOT A FAILURE. An empty column, a row that is gone, a
 * person removed, suspended, only invited or a sample person, an address
 * that is not one plain address, a column that is no longer a staff column:
 * each answers null, and the message goes with the house's own Reply-To if
 * the outbox has one, else with none.
 */
import type { OutboxProducer } from '@adminium/manifest';
import { usersRepo, type MetaDb } from '@adminium/meta';
import type { Kysely } from 'kysely';

import type { SourceDatabase } from '../connections/manager.js';
import { parseRelated, relatedTarget } from '../automations/related.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { replyToOf } from '../email/send.js';

/** The sign-in address of the person the staff column names, or null. */
export async function staffReplyTo(
  ctx: { meta: MetaDb; db: Kysely<SourceDatabase>; view: SnapshotView; outboxId: string },
  producer: OutboxProducer | undefined,
  row: Row,
): Promise<string | null> {
  const path = producer?.replyTo?.staff;
  if (producer === undefined || path === undefined) return null;
  try {
    // The row the message is about: the one its producer's link names.
    const about = relatedTarget(ctx.view, ctx.view.table(ctx.outboxId), producer.link);
    if (about === null) return null;
    let table = about.table;
    const hop = parseRelated(path);
    let found = await rowOf(ctx.db, table, about.key, row[producer.link], hop?.link ?? path);
    let column = path;
    // One link further (`deal_id.owner_id`): the row that row's own link names.
    if (hop !== null) {
      const far = relatedTarget(ctx.view, table, hop.link);
      if (far === null || found === null) return null;
      found = await rowOf(ctx.db, far.table, far.key, found[hop.link], hop.column);
      table = far.table;
      column = hop.column;
    }
    // Only a column that holds a staff member now: one an owner has since made a plain text names nobody.
    if (found === null || table.table.columns.find((candidate) => candidate.name === column)?.staff !== true) return null;
    const person = found[column];
    if (person === null || person === undefined || String(person).trim() === '') return null;
    const user = await usersRepo(ctx.meta).findById(String(person));
    return user !== null && user.status === 'active' ? replyToOf(user.email) : null;
  } catch {
    // A reply's address is never worth a message: one that cannot be read is left out.
    return null;
  }
}

/** One column of one row by its key, or null: no key, no such row, or no such column. */
async function rowOf(db: Kysely<SourceDatabase>, table: ResolvedTable, key: string, id: unknown, column: string): Promise<Row | null> {
  if (id === null || id === undefined || id === '' || !table.columns.has(column)) return null;
  return ((await db.selectFrom(table.id as never).select(column as never).where(key as never, '=', id as never).executeTakeFirst()) as Row | undefined) ?? null;
}
