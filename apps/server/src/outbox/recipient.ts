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
 * A text goes to the number on the person's row, or, where the outbox says
 * so (`recipient.textPhone`), to the number typed on the row the message is
 * about (an order's mobile, which the order's box gave its yes for).
 *
 * `identity` is the person's row when the address came from it: the only row
 * a sign-in link may ever be minted for.
 */
import { isTextKind, type Outbox, type OutboxProducer } from '@adminium/manifest';
import type { Kysely } from 'kysely';

import type { SourceDatabase } from '../connections/manager.js';
import type { SnapshotView } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import type { SettingReader } from './timing.js';
import { columnAddressed, columnRecipientOf, type ColumnAddressed } from './column-recipient.js';
import { PLAIN_DOTTED } from '../email/plain-address.js';

export interface Addressed {
  address: string | null;
  language: string | null;
  /** The recipient's own row, when the address is theirs. */
  identity: Row | null;
  /** The person's row (whether or not it holds an address), for the opt-in and the name. */
  person: Row | null;
  /** Sent to a setting's address, not to a person. */
  bySetting: boolean;
  /** Sent to an address the producing row holds (`recipient: {column}`): that row, and the name it greets. */
  byColumn?: ColumnAddressed | undefined;
}

// One plain `local@domain` and nothing else (`email/plain-address.ts`), as the do-not-email list and the mail server read it alike.
export const plausibleAddress = (value: unknown): value is string => typeof value === 'string' && PLAIN_DOTTED.test(value.trim());


/** The longest value read as a phone number: anything longer is not one, and a row's `to` never takes it. */
const NUMBER_MAX = 32;

/** A number as a row holds it, for the send path to read properly. Null when the column holds nothing like one. */
export function numberOnFile(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  return text === '' || text.length > NUMBER_MAX || !/[0-9]/.test(text) ? null : text;
}

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

/** The number a linked row holds (`recipient.textPhone`): the row in hand when it is that one, else read by its key. */
async function numberOnRow(ctx: { db: Kysely<SourceDatabase>; view: SnapshotView; outboxId: string }, row: Row, from: { via: string; column: string }, holder?: { tableId: string; row: Row }): Promise<string | null> {
  const table = referenced(ctx.view, ctx.outboxId, from.via);
  if (table === undefined || row[from.via] === null || row[from.via] === undefined) return null;
  const linked = holder !== undefined && holder.tableId === table && holder.row[ctx.view.table(table).primaryKey[0] ?? ''] === row[from.via] ? holder.row : await rowOf(ctx.db, ctx.view, table, row[from.via]);
  return linked === null ? null : numberOnFile(linked[from.column]);
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
  // An address on the producing row itself (a ticket offered to a friend): there, and nowhere else.
  const onRow = columnRecipientOf(producer);
  if (onRow !== null) {
    const found = await columnAddressed(ctx, producer!, onRow, row, holder);
    return found === null ? none : { ...none, address: found.address, language: found.language, byColumn: found };
  }
  if (producer?.recipient !== undefined && 'setting' in producer.recipient) {
    const value = await ctx.read(producer.recipient.setting);
    return { ...none, address: plausibleAddress(value) ? value.trim() : null, bySetting: true };
  }
  const recipient = definition.recipient;
  const person = await rowOf(ctx.db, ctx.view, recipient.table, row[recipient.via]);
  const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null);
  // A text goes to the number on the person's row: `address` holds it, and no sign-in link is ever made from it.
  if (isTextKind(definition, String(producer?.kind ?? row[definition.columns.kind] ?? ''))) {
    const language = (from: Row | null, column: unknown) => (typeof column === 'string' && from !== null ? text(from[column]) : null);
    // The number typed on the row the message is about (an order's mobile), when the outbox says texts go there and it holds one.
    const typed = recipient.textPhone === undefined ? null : await numberOnRow(ctx, row, recipient.textPhone, holder);
    if (person !== null) return { ...none, person, address: typed ?? (recipient.phone === undefined ? null : numberOnFile(person[recipient.phone])), language: language(person, recipient.language) };
    if (typed !== null) return { ...none, address: typed, language: null };
    const back = recipient.fallback;
    if (back === undefined) return none;
    const backTable = referenced(ctx.view, ctx.outboxId, back.via);
    const backRow =
      backTable === undefined
        ? null
        : holder !== undefined && holder.tableId === backTable && row[back.via] !== undefined && holder.row[ctx.view.table(backTable).primaryKey[0] ?? ''] === row[back.via]
          ? holder.row
          : await rowOf(ctx.db, ctx.view, backTable, row[back.via]);
    return { ...none, address: back.phone === undefined || backRow === null ? null : numberOnFile(backRow[back.phone]), language: language(backRow, back.language) };
  }
  if (person !== null) {
    const address = person[recipient.email ?? ''];
    return {
      ...none,
      person,
      address: plausibleAddress(address) ? address.trim() : null,
      // A language read from the row the message is about is the producer's (`producedLanguage`), not the person's.
      language: typeof recipient.language === 'string' ? text(person[recipient.language]) : null,
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
  const address = found?.[fallback.email ?? ''];
  return {
    ...none,
    address: plausibleAddress(address) ? address.trim() : null,
    language: fallback.language === undefined ? null : text(found?.[fallback.language]),
  };
}
