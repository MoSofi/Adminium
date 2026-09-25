// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHO A MESSAGE GOES TO, looked up as it is now.
 *
 * Most messages go to the outbox's recipient: the person the row links
 * (`recipient.via`), else what the row the fallback links carries (a first
 * visit's own email). A producer may instead name a setting holding an
 * address — the studio's own `reply_to` for the notices it receives. Such a
 * message goes there or nowhere: it never falls back to the person the row
 * links, who would then read a notice meant for the studio.
 *
 * `identity` is the person's row when the address came from it: the only row
 * a sign-in link may ever be minted for.
 */
import type { Outbox, OutboxProducer } from '@adminium/manifest';
import type { Kysely } from 'kysely';

import type { SourceDatabase } from '../connections/manager.js';
import type { SnapshotView } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import type { SettingReader } from './timing.js';

export interface Addressed {
  address: string | null;
  language: string | null;
  /** The recipient's own row, when the address is theirs. */
  identity: Row | null;
  /** The person's row (whether or not it holds an address), for the opt-in and the name. */
  person: Row | null;
  /** Sent to a setting's address, not to a person. */
  bySetting: boolean;
}

export const plausibleAddress = (value: unknown): value is string => typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

/** An address as compared: trimmed, lower-case. */
export const normalAddress = (value: unknown): string => (typeof value === 'string' ? value.trim().toLowerCase() : '');

/** The table a column's foreign key points at. */
export function referenced(view: SnapshotView, tableId: string, column: string): string | undefined {
  return view.model.relations.find((relation) => relation.from.tableId === tableId && relation.from.columns.length === 1 && relation.from.columns[0] === column)?.to.tableId;
}

/** One row by its single-column key. */
export async function rowOf(db: Kysely<SourceDatabase>, view: SnapshotView, tableId: string | undefined, id: unknown): Promise<Row | null> {
  if (tableId === undefined || id === null || id === undefined) return null;
  const key = view.table(tableId).primaryKey[0];
  if (key === undefined) return null;
  return ((await db.selectFrom(tableId as never).selectAll().where(key as never, '=', id as never).executeTakeFirst()) as Row | undefined) ?? null;
}

/**
 * Where a message goes, for a row of the outbox (or the values a producer is
 * about to write): the producer's setting, else the person, else the
 * fallback holder. `holder` is a row already in hand for the fallback (the
 * producing row itself).
 */
export async function addressFor(
  ctx: { db: Kysely<SourceDatabase>; view: SnapshotView; outboxId: string; read: SettingReader },
  definition: Outbox,
  producer: OutboxProducer | undefined,
  row: Row,
  holder?: { tableId: string; row: Row },
): Promise<Addressed> {
  const none: Addressed = { address: null, language: null, identity: null, person: null, bySetting: false };
  if (producer?.recipient !== undefined) {
    const value = await ctx.read(producer.recipient.setting);
    return { ...none, address: plausibleAddress(value) ? value.trim() : null, bySetting: true };
  }
  const recipient = definition.recipient;
  const person = await rowOf(ctx.db, ctx.view, recipient.table, row[recipient.via]);
  const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null);
  if (person !== null) {
    const address = person[recipient.email];
    return {
      ...none,
      person,
      address: plausibleAddress(address) ? address.trim() : null,
      language: recipient.language === undefined ? null : text(person[recipient.language]),
      identity: plausibleAddress(address) ? person : null,
    };
  }
  const fallback = recipient.fallback;
  if (fallback === undefined) return none;
  const holderTable = referenced(ctx.view, ctx.outboxId, fallback.via);
  const found =
    holderTable === undefined
      ? null
      : holder !== undefined && holder.tableId === holderTable && row[fallback.via] !== undefined && holder.row[ctx.view.table(holderTable).primaryKey[0] ?? ''] === row[fallback.via]
        ? holder.row
        : await rowOf(ctx.db, ctx.view, holderTable, row[fallback.via]);
  const address = found?.[fallback.email];
  return {
    ...none,
    address: plausibleAddress(address) ? address.trim() : null,
    language: fallback.language === undefined ? null : text(found?.[fallback.language]),
  };
}
