// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A PERSON'S WEBSITE CHATS: the part of a person's data a chat add-on keeps
 * (`sources.ts` finds, `export.ts` downloads, `erase.ts` erases).
 *
 * A conversation is theirs when:
 *  - the address the visitor typed in it is theirs; or
 *  - it became a row (an enquiry, from a question left outside hours or
 *    "Make an enquiry") that is one of their rows or one of the copies of
 *    them (`became_table` / `became_key`). A chat where nobody typed an
 *    address is found, and erased, with the enquiry it became.
 *
 * With each conversation go its messages and the automatic answerer's
 * choices about it. The download writes each table's rows whole; an erasure
 * deletes all three, through the one function that removes conversations
 * (`chat/transcripts.ts`), which also makes the chat store forget them.
 *
 * Read as the privacy action, as the rest of a person's data: no role's
 * limits. The address is compared as `normaliseAddress` spells it.
 */
import type { Dialect } from '@adminium/engine';
import { appTablesRepo, realTableOf, type MetaDb } from '@adminium/meta';
import { sql, type Kysely } from 'kysely';

import { chatAddOnsOn, deleteConversations, storedChatAddOns, type ChatAddOnTables, type ChatForget } from '../chat/transcripts.js';
import type { ConnectionManager, SourceDatabase } from '../connections/manager.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { loadSnapshotView } from '../data-io/snapshot-view.js';
import { rowKeyOf } from '../payments/payables.js';
import type { FoundSource } from './types.js';
import { plainValue } from './values.js';

/** How many conversations one read of their messages names. */
const BATCH = 200;

/** One of the person's rows (or a copy of them): what a conversation's `became` link may point at. */
export interface TheirRow {
  connectionId: string;
  /** The table's id in its database's snapshot. */
  table: string;
  /** Its row key, as the record pages name it. */
  key: string;
}

/** One chat add-on's rows of one person. */
export interface ChatPersonRows {
  connectionId: string;
  db: Kysely<SourceDatabase>;
  dialect: Dialect;
  addOn: ChatAddOnTables;
  conversations: Row[];
  messages: Row[];
  choices: Row[];
}

export interface ChatRowsDeps {
  meta: MetaDb;
  manager: Pick<ConnectionManager, 'data'>;
  /** Makes the chat store forget an erased conversation; absent, nothing is kept to forget. */
  chatForget?: ChatForget | undefined;
}

const addressIs = (column: string, address: string) => sql<boolean>`lower(trim(${sql.ref(column)})) = ${address}`;

/** The names a `became_table` may hold for a table: its id, and `<app>:<ref>` for each app that holds it. */
async function namesOf(meta: MetaDb, connectionId: string, view: SnapshotView, tableId: string): Promise<string[]> {
  const out = new Set<string>([tableId]);
  for (const record of await appTablesRepo(meta).forConnection(connectionId)) {
    try {
      if (view.table(realTableOf(record)).id === tableId) out.add(`${record.appKey}:${record.ref}`);
    } catch {
      // A table gone from the snapshot names nothing.
    }
  }
  return [...out];
}

/** Rows of `table` whose `column` is one of `keys`, in batches. */
async function rowsIn(db: Kysely<SourceDatabase>, table: ResolvedTable | null, column: string, keys: readonly unknown[]): Promise<Row[]> {
  if (table === null || !table.columns.has(column) || keys.length === 0) return [];
  const out: Row[] = [];
  for (let at = 0; at < keys.length; at += BATCH) {
    let query = db
      .selectFrom(table.id as never)
      .selectAll()
      .where(sql.ref(column), 'in', keys.slice(at, at + BATCH) as never);
    for (const pk of table.primaryKey) query = query.orderBy(sql.ref(pk) as never);
    out.push(...((await query.execute()) as Row[]));
  }
  return out;
}

/**
 * Every chat add-on's conversations of one person: by the address, and by
 * the rows of theirs a conversation became (`limit`: the most conversations
 * a search keeps per add-on), with their messages and choices.
 */
export async function findChatRows(deps: ChatRowsDeps, address: string, theirs: readonly TheirRow[], limit?: number): Promise<ChatPersonRows[]> {
  const stored = await storedChatAddOns(deps.meta);
  const out: ChatPersonRows[] = [];
  for (const connectionId of [...new Set(stored.map((one) => one.connectionId))].sort()) {
    let view: SnapshotView;
    try {
      view = await loadSnapshotView(deps.meta, connectionId, { forOthers: true });
    } catch {
      continue;
    }
    const { db, dialect } = await deps.manager.data(connectionId);
    // The rows of theirs on this database, by every name a conversation's link may give their table.
    const linked: { names: string[]; keys: string[] }[] = [];
    const byTable = new Map<string, string[]>();
    for (const row of theirs) if (row.connectionId === connectionId) byTable.set(row.table, [...(byTable.get(row.table) ?? []), row.key]);
    for (const [table, keys] of byTable) linked.push({ names: await namesOf(deps.meta, connectionId, view, table), keys: [...new Set(keys)] });

    for (const addOn of await chatAddOnsOn(deps.meta, connectionId, view, stored)) {
      const table = addOn.conversations;
      if (table === null) continue;
      const conditions = [
        ...(table.columns.has('email') ? [addressIs('email', address)] : []),
        ...(table.columns.has('became_table') && table.columns.has('became_key')
          ? linked.map(
              (one) =>
                sql<boolean>`(${sql.ref('became_table')} in (${sql.join(one.names.map((name) => sql`${name}`))}) and ${sql.ref('became_key')} in (${sql.join(one.keys.map((key) => sql`${key}`))}))`,
            )
          : []),
      ];
      if (conditions.length === 0) continue;
      let query = db
        .selectFrom(table.id as never)
        .selectAll()
        .where(sql<boolean>`(${sql.join(conditions, sql` or `)})`);
      for (const pk of table.primaryKey) query = query.orderBy(sql.ref(pk) as never);
      const conversations = (await (limit === undefined ? query : query.limit(limit)).execute()) as Row[];
      if (conversations.length === 0) continue;
      const key = table.primaryKey[0]!;
      const keys = conversations.map((row) => row[key]);
      out.push({
        connectionId,
        db,
        dialect,
        addOn,
        conversations,
        messages: await rowsIn(db, addOn.messages, 'conversation_id', keys),
        choices: await rowsIn(db, addOn.choices, 'conversation_id', keys),
      });
    }
  }
  return out;
}

const plain = (row: Row): Record<string, unknown> => Object.fromEntries(Object.entries(row).map(([column, value]) => [column, plainValue(value)]));

/** Their conversations, messages and choices as sources of a person's data (the download's rows included). */
export function chatSources(found: readonly ChatPersonRows[]): FoundSource[] {
  const out: FoundSource[] = [];
  for (const one of found) {
    const parts = [
      ['chat-conversations', 'gave', one.addOn.conversations, one.conversations, one.addOn.block.conversations],
      ['chat-messages', 'gave', one.addOn.messages, one.messages, one.addOn.block.messages],
      ['chat-choices', 'held', one.addOn.choices, one.choices, one.addOn.block.choices],
    ] as const;
    for (const [kind, group, table, rows, ref] of parts) {
      if (table === null || rows.length === 0) continue;
      out.push({
        id: `${kind}-${one.addOn.key}`,
        kind,
        group,
        connectionId: one.connectionId,
        table: table.id,
        app: one.addOn.key,
        ref,
        label: table.table.label ?? table.name,
        keptByLaw: null,
        count: rows.length,
        keys: rows.map((row) => rowKeyOf(table, row)),
        rows: rows.map(plain),
      });
    }
  }
  return out;
}

/** Erases their conversations with their messages and choices. Answers the rows removed, per source id. */
export async function eraseChatRows(found: readonly ChatPersonRows[], forget?: ChatForget): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const one of found) {
    const key = one.addOn.conversations?.primaryKey[0];
    if (key === undefined || one.conversations.length === 0) continue;
    const gone = await deleteConversations({ db: one.db, connectionId: one.connectionId, addOn: one.addOn, forget }, one.conversations.map((row) => row[key]));
    counts[`chat-conversations-${one.addOn.key}`] = gone.conversations;
    if (gone.messages > 0) counts[`chat-messages-${one.addOn.key}`] = gone.messages;
    if (gone.choices > 0) counts[`chat-choices-${one.addOn.key}`] = gone.choices;
  }
  return counts;
}
