// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A MESSAGE TO AN ADDRESS THE PRODUCING ROW HOLDS (`recipient: {column}`): a
 * ticket offered to a friend goes to the address the ticket was sent on to,
 * not to anyone the outbox's recipient link names.
 *
 * The producing row is the row the message links by the producer's `link`.
 * Its address is read as it is when the message goes (a send changed before
 * it went goes to the new address); its `name` column greets. That row — and
 * only that row — is the one whose codes the message may carry, and only
 * while the message goes to that very address: the ticket's own link reaches
 * the friend, the order's link and every other row's code stay withheld.
 *
 * What makes this safe to offer publicly lives with the change that fills the
 * column (`limits`: so many a day per address, a plain-text name).
 */
import type { OutboxProducer } from '@adminium/manifest';
import type { Kysely } from 'kysely';

import type { SourceDatabase } from '../connections/manager.js';
import type { SnapshotView } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';

/** The producing row's column a producer sends to, and the column naming who it is for; null for any other producer. */
export function columnRecipientOf(producer: OutboxProducer | undefined): { column: string; name?: string | undefined; language?: string | undefined } | null {
  const recipient = producer?.recipient;
  return recipient !== undefined && 'column' in recipient ? recipient : null;
}

/** Where such a message goes: the producing row, its address, and the name it greets. */
export interface ColumnAddressed {
  /** The producing row's table and key: the one row whose codes the message may carry. */
  table: string;
  id: unknown;
  address: string | null;
  name: string | null;
  /** The language the producing row holds for the message (its `language` column), or null. */
  language: string | null;
}

const plausible = (value: unknown): value is string => typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

/**
 * The producing row of a message (or of the values a producer is about to
 * write), read through the producer's link — or `holder`, when it is that row
 * already in hand — and the address and name it holds now.
 */
export async function columnAddressed(
  ctx: { db: Kysely<SourceDatabase>; view: SnapshotView; outboxId: string },
  producer: OutboxProducer,
  recipient: { column: string; name?: string | undefined; language?: string | undefined },
  row: Row,
  holder?: { tableId: string; row: Row },
): Promise<ColumnAddressed | null> {
  const tableId = ctx.view.model.relations.find(
    (relation) => relation.through === null && relation.from.tableId === ctx.outboxId && relation.from.columns.length === 1 && relation.from.columns[0] === producer.link,
  )?.to.tableId;
  const id = row[producer.link];
  if (tableId === undefined || id === null || id === undefined) return null;
  const key = ctx.view.table(tableId).primaryKey[0];
  if (key === undefined) return null;
  const producing =
    holder !== undefined && holder.tableId === tableId && String(holder.row[key]) === String(id)
      ? holder.row
      : (((await ctx.db.selectFrom(tableId as never).selectAll().where(key as never, '=', id as never).executeTakeFirst()) as Row | undefined) ?? null);
  if (producing === null) return null;
  const address = producing[recipient.column];
  const name = recipient.name === undefined ? null : producing[recipient.name];
  const language = recipient.language === undefined ? null : producing[recipient.language];
  return {
    table: tableId,
    id: producing[key],
    address: plausible(address) ? address.trim() : null,
    name: typeof name === 'string' && name.trim() !== '' ? name.trim() : null,
    language: typeof language === 'string' && language.trim() !== '' ? language.trim() : null,
  };
}
