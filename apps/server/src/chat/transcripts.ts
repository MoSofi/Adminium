// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A WEBSITE CHAT'S TRANSCRIPTS, AS THE ENGINE KEEPS AND REMOVES THEM.
 *
 *  - WHERE: each installed (or switched-off) add-on that declares
 *    `addOn.chat`, on the database it was installed on, with its
 *    conversations, messages, choices and settings tables, found through the
 *    add-on's own record of each table (a table it no longer holds is not
 *    found). A pure read of the meta store and the snapshot.
 *  - REMOVING: {@link deleteConversations} is the one function every engine
 *    path that removes conversations goes through (a person's erasure, the
 *    keeping sweep): a conversation goes with its messages and its choices,
 *    in that order (their links to it have no delete action), as the system,
 *    in batches, never through a staff save. The store forgets what it kept
 *    of each, so a visitor's poll on a removed conversation is told it is lost.
 *  - KEEPING ({@link sweepChatTranscripts}): the add-on's settings say how
 *    many months conversations are kept (`transcripts_months`; 12 when the
 *    settings row is not made yet, empty: kept until somebody removes them).
 *    Once a day every conversation whose last message is older goes.
 *  - WHO WRITES ({@link chatOwnTable}): Adminium alone writes conversations,
 *    messages and choices; a person's create or change of one, through any
 *    door, is refused, as a forms add-on's answers are. Staff act through the
 *    chat's own routes.
 */
import type { Dialect } from '@adminium/engine';
import { chatOf, isAddOnManifest, validateManifest, type AddOnChat, type AddOnManifest } from '@adminium/manifest';
import { appTablesRepo, manifestsRepo, realTableOf, type AppTableRecord, type MetaDb } from '@adminium/meta';
import { sql, type Kysely } from 'kysely';

import type { AddOnInstalls } from '../apps/table-ref.js';
import type { ConnectionManager, SourceDatabase } from '../connections/manager.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import { bindWriteValue } from '../crud/write-values.js';
import { loadSnapshotView } from '../data-io/snapshot-view.js';
import { monthsBefore } from '../forms/answers.js';
import { readChatSettings } from './settings.js';
import type { ChatPlace } from './store.js';

/** How many conversations one statement removes. */
const BATCH = 200;
/** The states in which an add-on still holds a table, and the statuses in which its tables are still there. */
const HELD = new Set(['created', 'adopted', 'shared']);
const PRESENT = new Set(['installed', 'disabled']);

const NO_SECRETS = {
  encrypt: (): string => {
    throw new Error('reading the chat add-ons never stores a credential');
  },
  decrypt: (): string => {
    throw new Error('reading the chat add-ons never reads a credential');
  },
};

/** Whether a table is one of the tables a chat add-on's conversations are kept in, which Adminium alone writes. */
export function chatOwnTable(installs: AddOnInstalls, connectionId: string, tableId: string): boolean {
  for (const key of installs.keys?.(connectionId) ?? []) {
    const installed = installs.installed(connectionId, key);
    const block = installed === null ? null : chatOf(installed.manifest);
    if (block === null) continue;
    for (const ref of [block.conversations, block.messages, block.choices]) if (installs.tableOf(connectionId, key, ref) === tableId) return true;
  }
  return false;
}

/** A chat add-on as stored: its key, database, status and manifest. */
export interface StoredChatAddOn {
  key: string;
  name: string;
  connectionId: string;
  status: string;
  manifest: AddOnManifest;
  block: AddOnChat;
}

/** One chat add-on on one database, with its tables (null: not there). */
export interface ChatAddOnTables extends StoredChatAddOn {
  conversations: ResolvedTable | null;
  messages: ResolvedTable | null;
  choices: ResolvedTable | null;
  settings: ResolvedTable | null;
}

/** Every installed (or switched-off) add-on that declares chat, by key. */
export async function storedChatAddOns(meta: MetaDb): Promise<StoredChatAddOn[]> {
  const out: StoredChatAddOn[] = [];
  for (const entry of await manifestsRepo(meta, NO_SECRETS).list('add-on')) {
    if (entry.row.connectionId === null || !PRESENT.has(entry.row.status)) continue;
    const read = validateManifest(entry.document);
    if (!read.ok || !isAddOnManifest(read.manifest)) continue;
    const block = chatOf(read.manifest);
    if (block === null) continue;
    const name = typeof read.manifest.name === 'string' ? read.manifest.name : entry.row.manifestKey;
    out.push({ key: entry.row.manifestKey, name, connectionId: entry.row.connectionId, status: entry.row.status, manifest: read.manifest, block });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

function tableIn(view: SnapshotView, record: AppTableRecord | undefined): ResolvedTable | null {
  if (record === undefined) return null;
  try {
    return view.table(realTableOf(record));
  } catch {
    return null;
  }
}

/** The chat add-ons on one database, each with its tables as that database's snapshot has them. */
export async function chatAddOnsOn(meta: MetaDb, connectionId: string, view: SnapshotView, stored?: readonly StoredChatAddOn[]): Promise<ChatAddOnTables[]> {
  const addOns = (stored ?? (await storedChatAddOns(meta))).filter((one) => one.connectionId === connectionId);
  if (addOns.length === 0) return [];
  const records = await appTablesRepo(meta).forConnection(connectionId);
  return addOns.map((addOn) => {
    const of = (ref: string | undefined) => (ref === undefined ? null : tableIn(view, records.find((record) => record.appKey === addOn.key && record.ref === ref && HELD.has(record.state))));
    const settingsRef = (addOn.manifest.addOn as { settingsTable?: string }).settingsTable;
    return { ...addOn, conversations: of(addOn.block.conversations), messages: of(addOn.block.messages), choices: of(addOn.block.choices), settings: of(settingsRef) };
  });
}

/** How many months a chat add-on keeps its conversations; null keeps them until somebody removes them. */
export async function transcriptsMonths(db: Kysely<SourceDatabase>, addOn: Pick<ChatAddOnTables, 'settings'>): Promise<number | null> {
  const settings = addOn.settings;
  if (settings === null) return readChatSettings(null).transcriptsMonths;
  let query = db.selectFrom(settings.id as never).selectAll();
  for (const column of settings.primaryKey) query = query.orderBy(sql.ref(column) as never);
  const row = (await query.limit(1).executeTakeFirst()) as Record<string, unknown> | undefined;
  return readChatSettings(row ?? null).transcriptsMonths;
}

/** What one removal took. */
export interface ConversationsGone {
  conversations: number;
  messages: number;
  choices: number;
}

/** Forgets what the chat store keeps of a removed conversation. */
export type ChatForget = (chat: ChatPlace, id: string) => void;

/**
 * Removes these conversations (by their key's values) with their messages and
 * choices (see the header), each batch in one transaction.
 */
export async function deleteConversations(target: { db: Kysely<SourceDatabase>; connectionId: string; addOn: Pick<ChatAddOnTables, 'conversations' | 'messages' | 'choices'>; forget?: ChatForget | undefined }, keys: readonly unknown[]): Promise<ConversationsGone> {
  const { conversations, messages, choices } = target.addOn;
  const key = conversations?.primaryKey[0];
  const gone: ConversationsGone = { conversations: 0, messages: 0, choices: 0 };
  if (conversations === null || key === undefined || keys.length === 0) return gone;
  for (let at = 0; at < keys.length; at += BATCH) {
    const group = keys.slice(at, at + BATCH);
    await target.db.transaction().execute(async (trx) => {
      if (choices !== null) gone.choices += Number((await trx.deleteFrom(choices.id as never).where(sql.ref('conversation_id'), 'in', group as never).executeTakeFirst()).numDeletedRows);
      if (messages !== null) gone.messages += Number((await trx.deleteFrom(messages.id as never).where(sql.ref('conversation_id'), 'in', group as never).executeTakeFirst()).numDeletedRows);
      gone.conversations += Number((await trx.deleteFrom(conversations.id as never).where(sql.ref(key), 'in', group as never).executeTakeFirst()).numDeletedRows);
    });
    for (const id of group) target.forget?.({ connectionId: target.connectionId, conversations: { table: { id: conversations.id } } }, String(id));
  }
  return gone;
}

export interface ChatTranscriptsSweepDeps {
  meta: MetaDb;
  manager: Pick<ConnectionManager, 'data'>;
  now?: (() => number) | undefined;
  viewFor?: ((connectionId: string) => Promise<SnapshotView | null>) | undefined;
  forget?: ChatForget | undefined;
}

/** Removes the conversations each chat add-on keeps no longer (see the header). Answers how many went, per add-on. */
export async function sweepChatTranscripts(deps: ChatTranscriptsSweepDeps): Promise<Record<string, number>> {
  const now = (deps.now ?? Date.now)();
  const stored = await storedChatAddOns(deps.meta);
  const out: Record<string, number> = {};
  for (const connectionId of [...new Set(stored.map((one) => one.connectionId))].sort()) {
    let view: SnapshotView | null;
    try {
      view = deps.viewFor === undefined ? await loadSnapshotView(deps.meta, connectionId, { forOthers: true }) : await deps.viewFor(connectionId);
    } catch {
      view = null;
    }
    if (view === null) continue;
    let handle: { db: Kysely<SourceDatabase>; dialect: Dialect };
    try {
      handle = await deps.manager.data(connectionId);
    } catch {
      // A database that cannot be reached now is swept on a later day.
      continue;
    }
    for (const addOn of await chatAddOnsOn(deps.meta, connectionId, view, stored)) {
      const conversations = addOn.conversations;
      const last = conversations?.columns.get('last_message_at');
      const key = conversations?.primaryKey[0];
      if (conversations === null || last === undefined || key === undefined) continue;
      const months = await transcriptsMonths(handle.db, addOn);
      if (months === null) continue;
      const before = bindWriteValue(last, new Date(monthsBefore(now, months)).toISOString(), handle.dialect);
      let gone = 0;
      for (;;) {
        const due = (await handle.db
          .selectFrom(conversations.id as never)
          .select(sql.ref(key).as('key') as never)
          .where(sql.ref('last_message_at'), '<', before as never)
          .limit(BATCH * 5)
          .execute()) as { key: unknown }[];
        if (due.length === 0) break;
        const removed = await deleteConversations({ db: handle.db, connectionId, addOn, forget: deps.forget }, due.map((row) => row.key));
        gone += removed.conversations;
        if (removed.conversations === 0 || due.length < BATCH * 5) break;
      }
      if (gone > 0) out[addOn.key] = (out[addOn.key] ?? 0) + gone;
    }
  }
  return out;
}
