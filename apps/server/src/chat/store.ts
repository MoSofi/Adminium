// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE CHAT STORE: the only code that writes a chat add-on's conversations,
 * messages and choices. Adminium alone writes them (the add-on's roles,
 * steps and an app's grants only read them: `@adminium/manifest` `chatBlockIssues`),
 * for a visitor (the door), for staff (their routes) and for the answerer.
 *
 *  - start a conversation, with its first message, in one transaction;
 *  - add a visitor, staff, automatic or system message, and move the
 *    conversation with it (its last message, its automatic count, a new
 *    state), in one transaction;
 *  - read a conversation, and its messages after a cursor (the messages'
 *    numbered key);
 *  - change a conversation: its state, its presence stamps, the details the
 *    visitor typed, the row it became;
 *  - log the answerer's choice.
 *
 * Every write that touches a message publishes `widget-data:<conn>:<messages>`
 * and `widget-data:<conn>:<conversations>` (`public-api/publish.ts`), so the
 * staff inbox hears it; a change to a conversation alone publishes the
 * conversations channel. Subscribers hold a read grant on the table, and the
 * shared publisher masks the row.
 *
 * ─── WHAT A POLL READS ─────────────────────────────────────────────────────
 * A visitor's window polls every few seconds. What a poll needs to answer
 * "nothing new" (the last message's key and time, the state, who took it) is
 * kept in memory per conversation ({@link ChatStore.latest}), filled by every
 * write here and, on a miss or a cold start, by one read of the tables. So a
 * poll with nothing new reads none of the add-on's tables.
 *
 * ONE PROCESS: the memory is this process's. A write made by another process
 * (two servers behind one address) is not seen by this one's polls until its
 * entry is filled again: run one process per install, as the rate buckets
 * and the realtime hub already require.
 */
import type { Kysely } from 'kysely';
import { sql } from 'kysely';

import type { SourceDatabase } from '../connections/manager.js';
import type { Row } from '../crud/mask.js';
import { readInstant } from '../crud/moments.js';
import { instantFor } from '../crud/instants.js';
import { normalizeWriteValue } from '../crud/write-values.js';
import { insertRow, storableValues, type RecordWriteService, type WriteContext, type WriteTarget } from '../crud/write-service.js';
import { publishPublicWrite } from '../public-api/publish.js';
import type { RealtimeHub } from '../realtime/hub.js';
import type { ChatTable, LiveChat } from './catalog.js';
import { whole, yes } from './settings.js';

export type ChatState = 'bot' | 'waiting' | 'open' | 'closed';
export type ChatMessageKind = 'visitor' | 'staff' | 'automatic' | 'system';
export type ChatOutcome = 'answered' | 'hand-over' | 'error' | 'budget' | 'cap' | 'off';

/** A conversation as the engine reads it; keys as text (a bigint key keeps every digit). */
export interface ChatConversation {
  id: string;
  startedAt: number;
  lastMessageAt: number;
  state: ChatState;
  language: string;
  name: string | null;
  email: string | null;
  cameFrom: string | null;
  outsideHours: boolean;
  takenBy: string | null;
  takenAt: number | null;
  lastVisitorAt: number | null;
  lastStaffAt: number | null;
  closedAt: number | null;
  becameTable: string | null;
  becameKey: string | null;
  automaticCount: number;
}

/** A message as the engine reads it. */
export interface ChatMessage {
  id: string;
  conversationId: string;
  kind: ChatMessageKind;
  body: string;
  event: string | null;
  answerRef: string | null;
  authorId: string | null;
  drafted: boolean;
  sentAt: number;
  mailedAt: number | null;
}

/** A message to add. */
export interface NewChatMessage {
  kind: ChatMessageKind;
  body: string;
  event?: string | null;
  answerRef?: string | null;
  /** The staff member who wrote it (a staff message, or a line their act caused). */
  authorId?: string | null;
  drafted?: boolean;
}

/** What may change on a conversation. Times are epoch ms. */
export interface ChatConversationPatch {
  state?: ChatState;
  language?: string;
  name?: string | null;
  email?: string | null;
  takenBy?: string | null;
  takenAt?: number | null;
  lastVisitorAt?: number | null;
  lastStaffAt?: number | null;
  closedAt?: number | null;
  becameTable?: string | null;
  becameKey?: string | null;
}

/** A new conversation. */
export interface NewChatConversation {
  state: ChatState;
  language: string;
  cameFrom: string | null;
  outsideHours: boolean;
  name?: string | null;
  email?: string | null;
  /** The first message, if any (a visitor's question). */
  first: NewChatMessage | null;
}

/** One choice the answerer made, as the choices table keeps it (`at` epoch ms). */
export interface ChatChoiceRow {
  conversationId: string | number;
  messageId: string | number;
  answerRef: string | null;
  outcome: ChatOutcome;
  model: string | null;
  tokensIn: number;
  tokensOut: number;
  at: number;
}

/** What a poll needs to answer "nothing new", kept per conversation. */
export interface ChatLatest {
  /** The newest message's key ('0': none). */
  lastId: string;
  lastMessageAt: number;
  state: ChatState;
  takenBy: string | null;
  /** When this process last wrote the visitor's heartbeat (`last_visitor_at`). */
  heartbeatAt: number;
}

/** The plain words a system line is stored with: the window and the inbox draw their own from its event. */
export const SYSTEM_LINES: Readonly<Record<string, string>> = {
  asked: 'The visitor asked for a person.',
  'handed-over': 'Handed to a person.',
  taken: 'A person joined the chat.',
  closed: 'The chat was closed.',
  reopened: 'The chat was reopened.',
  left: 'The visitor left the page.',
  enquiry: 'An enquiry was made from this chat.',
};

/** The system lines staff alone read: the visitor's window is never sent them. */
export const STAFF_ONLY_EVENTS: ReadonlySet<string> = new Set(['left', 'enquiry']);

/** Two keys compared as the numbers they are. */
export function compareKeys(a: string, b: string): number {
  const x = BigInt(a);
  const y = BigInt(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** A key as it is bound in a statement: a number while it is a safe one, else its digits. */
export function boundKey(key: string | number): number | string {
  const text = String(key);
  const number = Number(text);
  return Number.isSafeInteger(number) ? number : text;
}

/** A key as text, as each engine hands one back (a number, a bigint, a string). */
function keyText(value: unknown): string {
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value === 'string' && /^\d+$/.test(value)) return value;
  throw new Error(`a chat key is not a number: ${String(value)}`);
}

const ms = (value: unknown): number | null => readInstant(value)?.getTime() ?? null;
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** A conversations row, read. */
export function conversationOf(row: Row, pk: string): ChatConversation {
  return {
    id: keyText(row[pk]),
    startedAt: ms(row['started_at']) ?? 0,
    lastMessageAt: ms(row['last_message_at']) ?? 0,
    state: (text(row['state']) ?? 'closed') as ChatState,
    language: text(row['language']) ?? 'en-US',
    name: text(row['name']),
    email: text(row['email']),
    cameFrom: text(row['came_from']),
    outsideHours: yes(row['outside_hours']),
    takenBy: text(row['taken_by']),
    takenAt: ms(row['taken_at']),
    lastVisitorAt: ms(row['last_visitor_at']),
    lastStaffAt: ms(row['last_staff_at']),
    closedAt: ms(row['closed_at']),
    becameTable: text(row['became_table']),
    becameKey: text(row['became_key']),
    automaticCount: whole(row['automatic_count'], 0),
  };
}

/** A messages row, read. */
export function messageOf(row: Row, pk: string): ChatMessage {
  return {
    id: keyText(row[pk]),
    conversationId: keyText(row['conversation_id']),
    kind: (text(row['kind']) ?? 'system') as ChatMessageKind,
    body: text(row['body']) ?? '',
    event: text(row['event']),
    answerRef: text(row['answer_ref']),
    authorId: text(row['author_id']),
    drafted: yes(row['drafted']),
    sentAt: ms(row['sent_at']) ?? 0,
    mailedAt: ms(row['mailed_at']),
  };
}

const iso = (at: number): string => instantFor(new Date(at));
const isoOrNull = (at: number | null | undefined): string | null | undefined => (at === undefined ? undefined : at === null ? null : iso(at));

/** A patch as the conversations table's columns. */
function patchColumns(patch: ChatConversationPatch): Row {
  const out: Row = {};
  const put = (column: string, value: unknown) => {
    if (value !== undefined) out[column] = value;
  };
  put('state', patch.state);
  put('language', patch.language);
  put('name', patch.name);
  put('email', patch.email);
  put('taken_by', patch.takenBy);
  put('taken_at', isoOrNull(patch.takenAt));
  put('last_visitor_at', isoOrNull(patch.lastVisitorAt));
  put('last_staff_at', isoOrNull(patch.lastStaffAt));
  put('closed_at', isoOrNull(patch.closedAt));
  put('became_table', patch.becameTable);
  put('became_key', patch.becameKey);
  return out;
}

/**
 * Values for a statement of the store's own (an update), as the write path
 * would store them: a naive timestamp as the server's wall time (`normalizeWriteValue`),
 * then each engine's own spelling (`storableValues`: MySQL's instants, SQLite's booleans).
 */
function storedColumns(table: ChatTable['table'], columns: Row, dialect: WriteTarget['dialect']): Row {
  const out: Row = {};
  for (const [name, value] of Object.entries(columns)) {
    const column = table.columns.get(name);
    out[name] = column === undefined || value === null || value === undefined ? value : normalizeWriteValue(column, value);
  }
  return storableValues(table, out, dialect);
}

/** The most conversations whose latest message is kept in memory: past this the oldest go, and are read again. */
const LATEST_MAX = 10_000;

export interface ChatStoreDeps {
  writes: Pick<RecordWriteService, 'check' | 'transaction'>;
  /** The realtime hub; null on a compose with none. */
  hub: () => RealtimeHub | null;
  /**
   * Told, once the write stands, that a conversation waits for a person: it
   * was started waiting, it was handed over, or the visitor wrote while it
   * waits (`waiting.ts` tells staff, once until someone opens it). Never
   * awaited: the visitor is answered whatever it does.
   */
  waiting?: ((chat: LiveChat, conversation: ChatConversation) => void) | undefined;
  now?: () => number;
}

/** The chat a conversation's memory is kept under: its database and its conversations table. */
export type ChatPlace = Pick<LiveChat, 'connectionId'> & { conversations: { table: Pick<ChatTable['table'], 'id'> } };

export function createChatStore(deps: ChatStoreDeps) {
  const now = deps.now ?? Date.now;
  const latestKept = new Map<string, ChatLatest>();

  const memoryKey = (chat: ChatPlace, id: string): string => `${chat.connectionId}\u0000${chat.conversations.table.id}\u0000${id}`;

  /** A conversation that waits for a person, told once its write stood. */
  function toldWaiting(chat: LiveChat, conversation: ChatConversation): void {
    if (conversation.state !== 'waiting' || deps.waiting === undefined) return;
    try {
      deps.waiting(chat, conversation);
    } catch {
      // A notice never fails the write it is about.
    }
  }

  function remember(chat: LiveChat, id: string, latest: ChatLatest): void {
    const key = memoryKey(chat, id);
    latestKept.delete(key);
    latestKept.set(key, latest);
    if (latestKept.size > LATEST_MAX) latestKept.delete(latestKept.keys().next().value!);
  }

  /** Moves what memory keeps for a conversation after a write here. */
  function moved(chat: LiveChat, conversation: ChatConversation, lastId: string | null): void {
    const kept = latestKept.get(memoryKey(chat, conversation.id));
    remember(chat, conversation.id, {
      lastId: lastId ?? kept?.lastId ?? '0',
      lastMessageAt: conversation.lastMessageAt,
      state: conversation.state,
      takenBy: conversation.takenBy,
      heartbeatAt: kept?.heartbeatAt ?? 0,
    });
  }

  const target = (chat: LiveChat, table: ChatTable, db: Kysely<SourceDatabase> = chat.db): WriteTarget => ({ connectionId: chat.connectionId, view: chat.view, table: table.table, db, dialect: chat.dialect });

  const context = (chat: LiveChat): WriteContext => ({ origin: 'public', hops: 0, actor: { kind: 'system', id: null, label: `Chat: ${chat.name}`.slice(0, 200) }, request: null });

  /** One row written as Adminium writes the tables only it writes: filled and checked, then inserted. */
  async function insert(chat: LiveChat, table: ChatTable, db: Kysely<SourceDatabase>, values: Row): Promise<Row> {
    const on = target(chat, table, db);
    const verdict = await deps.writes.check('create', on, context(chat), [values], { capacity: 'unchecked' });
    const good = verdict.rows[0];
    if (good === null || good === undefined) throw new Error(`the chat's ${table.table.name} refused a row: ${JSON.stringify(verdict.issues[0] ?? {})}`);
    return insertRow(db, chat.dialect, table.table, good);
  }

  async function readConversation(chat: LiveChat, id: string, db: Kysely<SourceDatabase> = chat.db): Promise<ChatConversation | null> {
    const { table, pk } = chat.conversations;
    const row = (await db.selectFrom(table.id as never).selectAll().where(sql.ref(pk), '=', boundKey(id)).executeTakeFirst()) as Row | undefined;
    return row === undefined ? null : conversationOf(row, pk);
  }

  async function updateConversation(chat: LiveChat, id: string, columns: Row, db: Kysely<SourceDatabase>): Promise<void> {
    if (Object.keys(columns).length === 0) return;
    const { table, pk } = chat.conversations;
    await db
      .updateTable(table.id as never)
      .set(storedColumns(table, columns, chat.dialect) as never)
      .where(sql.ref(pk), '=', boundKey(id))
      .execute();
  }

  /** Runs `work` in one transaction, or on the caller's when it hands one. */
  async function within<T>(chat: LiveChat, on: Kysely<SourceDatabase> | undefined, work: (db: Kysely<SourceDatabase>) => Promise<T>): Promise<T> {
    if (on !== undefined) return work(on);
    return deps.writes.transaction(target(chat, chat.messages), [], work);
  }

  function publish(chat: LiveChat, table: ChatTable, action: 'create' | 'update', row: Row): void {
    publishPublicWrite(deps.hub(), { connectionId: chat.connectionId, table: table.table, action, pk: { [table.pk]: row[table.pk] }, row });
  }

  /** The values of a message row. */
  function messageValues(conversationId: string, message: NewChatMessage, at: number): Row {
    return {
      conversation_id: boundKey(conversationId),
      kind: message.kind,
      body: message.body,
      event: message.event ?? null,
      answer_ref: message.answerRef ?? null,
      author_id: message.authorId ?? null,
      drafted: message.drafted ?? false,
      sent_at: iso(at),
      mailed_at: null,
    };
  }

  /** Reads the conversation and its newest key into memory: a poll's miss, or a cold start. */
  async function fill(chat: LiveChat, id: string): Promise<ChatLatest | null> {
    const conversation = await readConversation(chat, id);
    if (conversation === null) return null;
    const { table, pk } = chat.messages;
    const newest = (await chat.db
      .selectFrom(table.id as never)
      .select(sql<unknown>`max(${sql.ref(pk)})`.as('last') as never)
      .where(sql.ref('conversation_id'), '=', boundKey(id))
      .executeTakeFirst()) as { last?: unknown } | undefined;
    const last = newest?.last === null || newest?.last === undefined ? '0' : keyText(newest.last);
    const kept = latestKept.get(memoryKey(chat, id));
    const latest: ChatLatest = { lastId: last, lastMessageAt: conversation.lastMessageAt, state: conversation.state, takenBy: conversation.takenBy, heartbeatAt: kept?.heartbeatAt ?? 0 };
    remember(chat, id, latest);
    return latest;
  }

  /**
   * A change to a conversation alone (a state, a stamp, the details typed,
   * the row it became), on the caller's transaction when it hands one.
   * Null when the conversation is gone.
   */
  async function update(chat: LiveChat, id: string, patch: ChatConversationPatch, opts: { on?: Kysely<SourceDatabase> } = {}): Promise<ChatConversation | null> {
    const columns = patchColumns(patch);
    const db = opts.on ?? chat.db;
    await updateConversation(chat, id, columns, db);
    const conversation = await readConversation(chat, id, db);
    if (conversation === null) return null;
    moved(chat, conversation, null);
    if (opts.on === undefined && Object.keys(columns).length > 0) publish(chat, chat.conversations, 'update', { [chat.conversations.pk]: boundKey(id), ...columns });
    return conversation;
  }

  return {
    /**
     * A new conversation, and its first message when it has one, in one
     * transaction (or the caller's: a question left outside hours writes it
     * beside the row it became).
     */
    async start(chat: LiveChat, input: NewChatConversation, opts: { at?: number; on?: Kysely<SourceDatabase> } = {}): Promise<{ conversation: ChatConversation; messages: ChatMessage[] }> {
      const at = opts.at ?? now();
      const written = await within(chat, opts.on, async (db) => {
        const made = await insert(chat, chat.conversations, db, {
          started_at: iso(at),
          last_message_at: iso(at),
          state: input.state,
          language: input.language,
          name: input.name ?? null,
          email: input.email ?? null,
          came_from: input.cameFrom,
          outside_hours: input.outsideHours,
          taken_by: null,
          taken_at: null,
          last_visitor_at: input.first?.kind === 'visitor' ? iso(at) : null,
          last_staff_at: null,
          closed_at: null,
          became_table: null,
          became_key: null,
          automatic_count: 0,
        });
        const id = keyText(made[chat.conversations.pk]);
        const first = input.first === null ? null : await insert(chat, chat.messages, db, messageValues(id, input.first, at));
        // Read back as stored: a default the table filled is what it holds.
        const conversation = (await readConversation(chat, id, db)) ?? conversationOf(made, chat.conversations.pk);
        return { conversation, made, first };
      });
      const { conversation } = written;
      const messages = written.first === null ? [] : [messageOf(written.first, chat.messages.pk)];
      moved(chat, conversation, messages[0]?.id ?? '0');
      // A caller's transaction may still fail: it publishes once it stands.
      if (opts.on === undefined) {
        publish(chat, chat.conversations, 'create', written.made);
        if (written.first !== null) publish(chat, chat.messages, 'create', written.first);
        toldWaiting(chat, conversation);
      }
      return { conversation, messages };
    },

    /** Publishes what {@link start} wrote inside a caller's transaction, once it stood. */
    announceStart(chat: LiveChat, conversation: ChatConversation, messages: readonly ChatMessage[]): void {
      publish(chat, chat.conversations, 'create', { [chat.conversations.pk]: boundKey(conversation.id) });
      for (const message of messages) publish(chat, chat.messages, 'create', { [chat.messages.pk]: boundKey(message.id), conversation_id: boundKey(conversation.id) });
      toldWaiting(chat, conversation);
    },

    /**
     * A message, and the conversation moved with it in the same transaction:
     * its last message, one more automatic answer for an automatic one, and
     * `patch` (a new state, a stamp). Null when the conversation is gone.
     * `keepLast`: a line dated in the past (the visitor left at the time of
     * their last heartbeat) leaves the conversation's last message as it is.
     */
    async add(chat: LiveChat, conversationId: string, message: NewChatMessage, patch: ChatConversationPatch = {}, opts: { at?: number; keepLast?: boolean } = {}): Promise<{ message: ChatMessage; conversation: ChatConversation } | null> {
      const at = opts.at ?? now();
      const moves: Row = { ...patchColumns(patch), ...(opts.keepLast === true ? {} : { last_message_at: iso(at) }) };
      const written = await within(chat, undefined, async (db) => {
        if ((await readConversation(chat, conversationId, db)) === null) return null;
        const row = await insert(chat, chat.messages, db, messageValues(conversationId, message, at));
        await updateConversation(chat, conversationId, moves, db);
        if (message.kind === 'automatic') {
          const { table, pk } = chat.conversations;
          await db
            .updateTable(table.id as never)
            .set({ automatic_count: sql`${sql.ref('automatic_count')} + 1` } as never)
            .where(sql.ref(pk), '=', boundKey(conversationId))
            .execute();
        }
        const conversation = await readConversation(chat, conversationId, db);
        return conversation === null ? null : { row, conversation };
      });
      if (written === null) return null;
      const added = messageOf(written.row, chat.messages.pk);
      moved(chat, written.conversation, added.id);
      publish(chat, chat.messages, 'create', written.row);
      if (Object.keys(moves).length > 0) publish(chat, chat.conversations, 'update', { [chat.conversations.pk]: boundKey(conversationId), ...moves });
      // A visitor still waiting, or a conversation just handed to a person: staff are told (once until someone opens it).
      if (message.kind === 'visitor' || message.event === 'asked' || message.event === 'handed-over') toldWaiting(chat, written.conversation);
      return { message: added, conversation: written.conversation };
    },

    /** A conversation, read now. */
    conversation: (chat: LiveChat, id: string) => readConversation(chat, id),

    /** A message, read now; null when it is not one of this conversation's. */
    async message(chat: LiveChat, conversationId: string, messageId: string): Promise<ChatMessage | null> {
      const { table, pk } = chat.messages;
      const row = (await chat.db
        .selectFrom(table.id as never)
        .selectAll()
        .where(sql.ref(pk), '=', boundKey(messageId))
        .where(sql.ref('conversation_id'), '=', boundKey(conversationId))
        .executeTakeFirst()) as Row | undefined;
      return row === undefined ? null : messageOf(row, pk);
    },

    /** The conversation's newest system line with this event, or null. */
    async lastEvent(chat: LiveChat, conversationId: string, event: string): Promise<ChatMessage | null> {
      const { table, pk } = chat.messages;
      const row = (await chat.db
        .selectFrom(table.id as never)
        .selectAll()
        .where(sql.ref('conversation_id'), '=', boundKey(conversationId))
        .where(sql.ref('kind'), '=', 'system')
        .where(sql.ref('event'), '=', event)
        .orderBy(sql.ref(pk) as never, 'desc')
        .limit(1)
        .executeTakeFirst()) as Row | undefined;
      return row === undefined ? null : messageOf(row, pk);
    },

    /** Stamps when a staff message was also mailed to the visitor (`mailed_at`). */
    async markMailed(chat: LiveChat, messageId: string, at: number): Promise<void> {
      const { table, pk } = chat.messages;
      await chat.db
        .updateTable(table.id as never)
        .set(storedColumns(table, { mailed_at: iso(at) }, chat.dialect) as never)
        .where(sql.ref(pk), '=', boundKey(messageId))
        .execute();
      publish(chat, chat.messages, 'update', { [pk]: boundKey(messageId), mailed_at: iso(at) });
    },

    /** The conversation's messages after the key `after` ('0': from the first), oldest first, at most `limit`. */
    async since(chat: LiveChat, conversationId: string, after: string, limit = 200): Promise<ChatMessage[]> {
      const { table, pk } = chat.messages;
      const rows = (await chat.db
        .selectFrom(table.id as never)
        .selectAll()
        .where(sql.ref('conversation_id'), '=', boundKey(conversationId))
        .where(sql.ref(pk), '>', boundKey(after))
        .orderBy(sql.ref(pk) as never)
        .limit(limit)
        .execute()) as Row[];
      return rows.map((row) => messageOf(row, pk));
    },

    /** How many messages the visitor has sent in a conversation. */
    async visitorCount(chat: LiveChat, conversationId: string): Promise<number> {
      const { table } = chat.messages;
      const row = (await chat.db
        .selectFrom(table.id as never)
        .select(sql<unknown>`count(*)`.as('n') as never)
        .where(sql.ref('conversation_id'), '=', boundKey(conversationId))
        .where(sql.ref('kind'), '=', 'visitor')
        .executeTakeFirst()) as { n?: unknown } | undefined;
      return Number(row?.n ?? 0);
    },

    /**
     * A change to a conversation alone (a state, a stamp, the details typed,
     * the row it became), on the caller's transaction when it hands one.
     * Null when the conversation is gone.
     */
    update,

    /**
     * Links the row of an app's table a conversation became (`<app>:<table>`
     * and its key), only while it became none: one conditional statement, so
     * of two links at the same moment exactly one wins (`linked`), and the
     * other finds the first's row on the conversation.
     */
    async link(chat: LiveChat, id: string, became: { table: string; key: string }, opts: { on?: Kysely<SourceDatabase> } = {}): Promise<{ linked: boolean; conversation: ChatConversation | null }> {
      const db = opts.on ?? chat.db;
      const { table, pk } = chat.conversations;
      const columns = patchColumns({ becameTable: became.table, becameKey: became.key });
      const result = await db
        .updateTable(table.id as never)
        .set(storedColumns(table, columns, chat.dialect) as never)
        .where(sql.ref(pk), '=', boundKey(id))
        .where(sql.ref('became_key'), 'is', null)
        .executeTakeFirst();
      const linked = Number(result.numUpdatedRows) > 0;
      const conversation = await readConversation(chat, id, db);
      if (conversation !== null) moved(chat, conversation, null);
      if (linked && opts.on === undefined) publish(chat, chat.conversations, 'update', { [pk]: boundKey(id), ...columns });
      return { linked, conversation };
    },

    /** One choice the answerer made, in the choices table. */
    async logChoice(chat: LiveChat, choice: ChatChoiceRow): Promise<void> {
      await insert(chat, chat.choices, chat.db, {
        conversation_id: boundKey(choice.conversationId),
        message_id: boundKey(choice.messageId),
        answer_ref: choice.answerRef,
        outcome: choice.outcome,
        model: choice.model,
        tokens_in: choice.tokensIn,
        tokens_out: choice.tokensOut,
        at: iso(choice.at),
      });
    },

    /**
     * What a poll needs about a conversation: from memory when this process
     * wrote or read it last, else read once from the tables. Null when the
     * conversation is gone.
     */
    async latest(chat: LiveChat, id: string): Promise<ChatLatest | null> {
      return latestKept.get(memoryKey(chat, id)) ?? (await fill(chat, id));
    },

    /**
     * The visitor's heartbeat: `last_visitor_at` written at most once every
     * `every` ms per conversation (presence reads it in minutes), so a poll
     * every few seconds writes once a minute.
     */
    async heartbeat(chat: LiveChat, id: string, at: number, every: number): Promise<void> {
      const kept = latestKept.get(memoryKey(chat, id));
      if (kept !== undefined && at - kept.heartbeatAt < every) return;
      if (kept !== undefined) kept.heartbeatAt = at;
      await updateConversation(chat, id, { last_visitor_at: iso(at) }, chat.db);
    },

    /** Forgets what memory holds for one conversation (erased), or every one. */
    forget(chat?: ChatPlace, id?: string): void {
      if (chat === undefined || id === undefined) latestKept.clear();
      else latestKept.delete(memoryKey(chat, id));
    },
  };
}

export type ChatStore = ReturnType<typeof createChatStore>;
