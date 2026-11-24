// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Where conversations are kept: `adminium_text_threads`,
 * `adminium_text_thread_messages`, `adminium_text_reply_switches` and
 * `adminium_text_auto_answers`.
 *
 * A number arrives hashed, and its display copy and every message's words
 * arrive sealed: the keys are the service's. A store that cannot be read
 * throws.
 *
 * ─── ONCE, WHATEVER RUNS AT THE SAME TIME ──────────────────────────────────
 *
 *   one thread per number and app   a unique index; a second create finds the first
 *   one message per inbound event   a unique index on `event_id`
 *   one "not read" answer a period  a single update, `where answered_at < since`
 */
import { newId, type AddressHash, type MetaDb } from '@adminium/meta';
import { sql, type ExpressionBuilder, type Kysely } from 'kysely';

import { TEXT_THREAD_DIRECTIONS, TEXT_THREAD_KINDS, type TextThreadDirection, type TextThreadKind, type TextThreadMessageRecord, type TextThreadRecord, type TextThreadRecordRef } from './types.js';

interface ThreadTable {
  id: string;
  phoneHash: string;
  keyVersion: number;
  appKey: string;
  phoneEncrypted: string | null;
  phoneMasked: string | null;
  line: string | null;
  recordConnection: string | null;
  recordTable: string | null;
  recordKey: string | null;
  lastAt: number;
  lastDirection: string;
  lastKind: string;
  unread: number;
  readAt: number | null;
  readById: string | null;
  readByLabel: string | null;
  createdAt: number;
  updatedAt: number;
}

interface MessageTable {
  id: string;
  threadId: string;
  direction: string;
  kind: string;
  sealedBody: string | null;
  eventId: string | null;
  deliveryId: string | null;
  outcome: string | null;
  byId: string | null;
  byLabel: string | null;
  at: number;
  createdAt: number;
}

interface SwitchTable {
  appKey: string;
  replies: string;
  changedById: string | null;
  changedByLabel: string | null;
  changedAt: number;
}

interface AnswerTable {
  id: string;
  phoneHash: string;
  keyVersion: number;
  answeredAt: number;
}

interface DeliveryTable {
  id: string;
  phoneHash: string | null;
  keyVersion: number | null;
  state: string;
  reason: string | null;
  providerStatus: string | null;
  aboutApp: string | null;
  aboutTemplate: string | null;
  createdAt: number;
}

interface ThreadTables {
  adminium_text_threads: ThreadTable;
  adminium_text_thread_messages: MessageTable;
  adminium_text_reply_switches: SwitchTable;
  adminium_text_auto_answers: AnswerTable;
  adminium_text_deliveries: DeliveryTable;
}

export interface TextThreadInput {
  phone: AddressHash;
  appKey: string;
  phoneEncrypted: string;
  phoneMasked: string;
  line: string | null;
  at: number;
}

export interface TextMessageInput {
  threadId: string;
  direction: TextThreadDirection;
  kind: TextThreadKind;
  sealedBody: string | null;
  eventId?: string | null | undefined;
  deliveryId?: string | null | undefined;
  outcome?: string | null | undefined;
  by?: { id: string; label: string } | null | undefined;
  at: number;
}

/** A text an app sent the number, as the delivery record keeps it: no words. */
export interface TextSentByApp {
  deliveryId: string;
  template: string | null;
  state: string;
  reason: string | null;
  providerStatus: string | null;
  at: number;
}

export interface TextReplySwitchRecord {
  appKey: string;
  replies: 'on' | 'off';
  changedBy: { id: string; label: string } | null;
  changedAt: number;
}

export interface TextThreadPageQuery {
  /** `all`, or the apps whose threads may be listed. */
  apps: 'all' | readonly string[];
  /** One app's alone; `''` for the threads no app owns. */
  app?: string | undefined;
  unreadOnly?: boolean | undefined;
  limit: number;
  after?: { lastAt: number; id: string } | undefined;
}

export interface TextThreadStore {
  findThread(hashes: readonly AddressHash[], appKey: string): Promise<TextThreadRecord | null>;
  /** One thread per number and app: a second create finds the first. */
  createThread(input: TextThreadInput, hashes: readonly AddressHash[]): Promise<TextThreadRecord>;
  threadById(id: string): Promise<TextThreadRecord | null>;
  /** Every thread of the number, whatever its app. */
  threadsOf(hashes: readonly AddressHash[]): Promise<TextThreadRecord[]>;
  page(query: TextThreadPageQuery): Promise<TextThreadRecord[]>;
  /** Threads with unread messages, by app (`''` for none). */
  unreadByApp(): Promise<Map<string, number>>;
  /** False when a message from this inbound event is already here. */
  addMessage(input: TextMessageInput): Promise<{ added: boolean; message: TextThreadMessageRecord | null }>;
  /** A new last line, an unread one when it came in. */
  touch(threadId: string, fields: { at: number; direction: TextThreadDirection; kind: TextThreadKind; unread: boolean; line?: string | null | undefined; record?: TextThreadRecordRef | undefined }): Promise<void>;
  setOutcome(messageId: string, outcome: string, deliveryId: string | null): Promise<void>;
  messageById(id: string): Promise<TextThreadMessageRecord | null>;
  /** Newest first, before the cursor. */
  messages(threadId: string, opts: { limit: number; before?: { at: number; id: string } | undefined }): Promise<TextThreadMessageRecord[]>;
  latestMessages(threadIds: readonly string[]): Promise<Map<string, TextThreadMessageRecord>>;
  /** The latest inbound message of a thread. */
  lastIn(threadId: string): Promise<number | null>;
  markRead(threadId: string, by: { id: string; label: string }, at: number): Promise<boolean>;
  /** The texts an app sent the number by template, newest first, at or before `before`. */
  sentByApp(hashes: readonly AddressHash[], appKey: string, opts: { limit: number; before?: number | undefined }): Promise<TextSentByApp[]>;
  /** The app that texted the number last, or null. */
  lastAppOf(hashes: readonly AddressHash[]): Promise<string | null>;
  /** The apps that texted the number at or after `since`, the latest first, each once. */
  appsTextedSince(hashes: readonly AddressHash[], since: number): Promise<string[]>;
  /** Whether this business ever texted the number, by any app or none. */
  textedBefore(hashes: readonly AddressHash[]): Promise<boolean>;
  /** How many "not read" answers went at or after `since`, for every number. */
  answersSince(since: number): Promise<number>;
  deliveryStates(ids: readonly string[]): Promise<Map<string, { state: string; reason: string | null; providerStatus: string | null }>>;
  switches(): Promise<TextReplySwitchRecord[]>;
  setSwitch(appKey: string, replies: 'on' | 'off', by: { id: string; label: string } | null, at: number): Promise<void>;
  /** Takes this number's "not read" answer, unless one went at or after `since`. True: this caller sends it. */
  takeAnswer(write: AddressHash, hashes: readonly AddressHash[], since: number, at: number): Promise<boolean>;
  /** Removes every thread, message and answer mark of these hashes. Answers how many threads and messages went. */
  eraseFor(hashes: readonly AddressHash[]): Promise<{ threads: number; messages: number }>;
  countFor(hashes: readonly AddressHash[]): Promise<{ threads: number; messages: number }>;
  /** Only the threads of these hashes about one of these records, with their messages. */
  eraseForRecords(hashes: readonly AddressHash[], records: readonly TextThreadRecordRef[]): Promise<{ threads: number; messages: number }>;
  countForRecords(hashes: readonly AddressHash[], records: readonly TextThreadRecordRef[]): Promise<{ threads: number; messages: number }>;
  /** Messages older than `before`, then threads left with none, then answer marks older than `answersBefore`. */
  sweep(before: number, answersBefore: number, batch: number): Promise<{ messages: number; threads: number; answers: number }>;
}

const DIRECTION_SET: ReadonlySet<string> = new Set(TEXT_THREAD_DIRECTIONS);
const KIND_SET: ReadonlySet<string> = new Set(TEXT_THREAD_KINDS);

const num = (value: number | string | null): number | null => (value === null ? null : Number(value));

function decodeThread(row: ThreadTable): TextThreadRecord {
  return {
    id: row.id,
    phone: { hash: row.phoneHash, version: Number(row.keyVersion) },
    appKey: row.appKey,
    phoneEncrypted: row.phoneEncrypted,
    phoneMasked: row.phoneMasked,
    line: row.line,
    record: row.recordConnection !== null && row.recordTable !== null && row.recordKey !== null ? { connectionId: row.recordConnection, table: row.recordTable, key: row.recordKey } : null,
    lastAt: Number(row.lastAt),
    lastDirection: row.lastDirection === 'out' ? 'out' : 'in',
    lastKind: KIND_SET.has(row.lastKind) ? (row.lastKind as TextThreadKind) : 'message',
    unread: Number(row.unread),
    readAt: num(row.readAt),
    readBy: row.readById === null ? null : { id: row.readById, label: row.readByLabel ?? '' },
    createdAt: Number(row.createdAt),
  };
}

function decodeMessage(row: MessageTable): TextThreadMessageRecord {
  if (!DIRECTION_SET.has(row.direction) || !KIND_SET.has(row.kind)) throw new Error('A conversation holds a message this version cannot read.');
  return {
    id: row.id,
    threadId: row.threadId,
    direction: row.direction as TextThreadDirection,
    kind: row.kind as TextThreadKind,
    sealedBody: row.sealedBody,
    eventId: row.eventId,
    deliveryId: row.deliveryId,
    outcome: row.outcome,
    by: row.byId === null ? null : { id: row.byId, label: row.byLabel ?? '' },
    at: Number(row.at),
  };
}

/** One of these hashes, each under its own key version. */
function ofHashes<T extends 'adminium_text_threads' | 'adminium_text_auto_answers' | 'adminium_text_deliveries'>(hashes: readonly AddressHash[]) {
  return (eb: ExpressionBuilder<ThreadTables, T>) =>
    eb.or(hashes.map((one) => eb.and([eb(sql.ref('phoneHash'), '=', one.hash), eb(sql.ref('keyVersion'), '=', one.version)])));
}

/** Rows deleted in one statement. */
const DELETE_BATCH = 500;

export function createTextThreadStore(meta: MetaDb): TextThreadStore {
  const db = meta.db as unknown as Kysely<ThreadTables>;
  const dialect = meta.dialect;

  async function findThread(hashes: readonly AddressHash[], appKey: string): Promise<TextThreadRecord | null> {
    if (hashes.length === 0) return null;
    const rows = await db.selectFrom('adminium_text_threads').selectAll().where(ofHashes(hashes)).where('appKey', '=', appKey).execute();
    // The exact app: a column's collation never makes two apps one.
    const row = (rows as ThreadTable[]).filter((one) => one.appKey === appKey).sort((a, b) => Number(b.keyVersion) - Number(a.keyVersion))[0];
    return row === undefined ? null : decodeThread(row);
  }

  async function threadById(id: string): Promise<TextThreadRecord | null> {
    const row = await db.selectFrom('adminium_text_threads').selectAll().where('id', '=', id).executeTakeFirst();
    return row === undefined ? null : decodeThread(row as ThreadTable);
  }

  async function messageById(id: string): Promise<TextThreadMessageRecord | null> {
    const row = await db.selectFrom('adminium_text_thread_messages').selectAll().where('id', '=', id).executeTakeFirst();
    return row === undefined ? null : decodeMessage(row as MessageTable);
  }

  async function threadIdsOf(hashes: readonly AddressHash[]): Promise<string[]> {
    if (hashes.length === 0) return [];
    return (await db.selectFrom('adminium_text_threads').select('id').where(ofHashes(hashes)).execute()).map((row) => row.id);
  }

  /** The threads of these hashes about one of these records: compared exactly, whatever a column's collation. */
  async function recordThreadIds(hashes: readonly AddressHash[], records: readonly TextThreadRecordRef[]): Promise<string[]> {
    if (hashes.length === 0 || records.length === 0) return [];
    const rows = (await db.selectFrom('adminium_text_threads').selectAll().where(ofHashes(hashes)).where('recordKey', 'is not', null).execute()) as ThreadTable[];
    return rows.filter((row) => records.some((one) => one.connectionId === row.recordConnection && one.table === row.recordTable && one.key === row.recordKey)).map((row) => row.id);
  }

  async function messageCount(threadIds: readonly string[]): Promise<number> {
    let total = 0;
    for (let at = 0; at < threadIds.length; at += DELETE_BATCH) {
      const row = await db
        .selectFrom('adminium_text_thread_messages')
        .select((eb) => eb.fn.countAll<number | string>().as('count'))
        .where('threadId', 'in', threadIds.slice(at, at + DELETE_BATCH))
        .executeTakeFirstOrThrow();
      total += Number(row.count);
    }
    return total;
  }

  return {
    findThread,
    threadById,
    messageById,

    async createThread(input, hashes) {
      const id = newId('tth');
      const insert = db.insertInto('adminium_text_threads').values({
        id,
        phoneHash: input.phone.hash,
        keyVersion: input.phone.version,
        appKey: input.appKey,
        phoneEncrypted: input.phoneEncrypted,
        phoneMasked: input.phoneMasked,
        line: input.line,
        recordConnection: null,
        recordTable: null,
        recordKey: null,
        lastAt: input.at,
        lastDirection: 'in',
        lastKind: 'message',
        unread: 0,
        readAt: null,
        readById: null,
        readByLabel: null,
        createdAt: input.at,
        updatedAt: input.at,
      });
      // Made by another reply in the same instant: that one is the thread.
      if (dialect === 'mysql') await insert.onDuplicateKeyUpdate({ id: sql`id` }).execute();
      else await insert.onConflict((conflict) => conflict.doNothing()).execute();
      const found = await findThread([input.phone, ...hashes], input.appKey);
      if (found === null) throw new Error('A conversation could not be kept.');
      return found;
    },

    async threadsOf(hashes) {
      if (hashes.length === 0) return [];
      return ((await db.selectFrom('adminium_text_threads').selectAll().where(ofHashes(hashes)).execute()) as ThreadTable[]).map(decodeThread);
    },

    async page(query) {
      if (query.apps !== 'all' && query.apps.length === 0) return [];
      let select = db.selectFrom('adminium_text_threads').selectAll();
      if (query.apps !== 'all') select = select.where('appKey', 'in', [...query.apps]);
      if (query.app !== undefined) select = select.where('appKey', '=', query.app);
      if (query.unreadOnly === true) select = select.where('unread', '>', 0);
      const after = query.after;
      if (after !== undefined) select = select.where((eb) => eb.or([eb('lastAt', '<', after.lastAt), eb.and([eb('lastAt', '=', after.lastAt), eb('id', '<', after.id)])]));
      const rows = (await select.orderBy('lastAt', 'desc').orderBy('id', 'desc').limit(query.limit).execute()) as ThreadTable[];
      const allowed = query.apps === 'all' ? null : new Set(query.apps);
      // The exact app again: a column's collation never widens whose threads these are.
      return rows.filter((row) => (allowed === null || allowed.has(row.appKey)) && (query.app === undefined || row.appKey === query.app)).map(decodeThread);
    },

    async unreadByApp() {
      const rows = await db
        .selectFrom('adminium_text_threads')
        .select(['appKey', (eb) => eb.fn.countAll<number | string>().as('count')])
        .where('unread', '>', 0)
        .groupBy('appKey')
        .execute();
      return new Map(rows.map((row) => [row.appKey, Number(row.count)]));
    },

    async addMessage(input) {
      const id = newId('ttm');
      const insert = db.insertInto('adminium_text_thread_messages').values({
        id,
        threadId: input.threadId,
        direction: input.direction,
        kind: input.kind,
        sealedBody: input.sealedBody,
        eventId: input.eventId ?? null,
        deliveryId: input.deliveryId ?? null,
        outcome: input.outcome ?? null,
        byId: input.by?.id ?? null,
        byLabel: input.by?.label ?? null,
        at: input.at,
        createdAt: input.at,
      });
      // A retried event, or a reply sent again with its key: its message is here already.
      if (dialect === 'mysql') await insert.onDuplicateKeyUpdate({ id: sql`id` }).execute();
      else await insert.onConflict((conflict) => conflict.doNothing()).execute();
      const mine = await messageById(id);
      if (mine !== null) return { added: true, message: mine };
      let first = db.selectFrom('adminium_text_thread_messages').selectAll();
      if (input.eventId !== null && input.eventId !== undefined) first = first.where('eventId', '=', input.eventId);
      else if (input.deliveryId !== null && input.deliveryId !== undefined) first = first.where('deliveryId', '=', input.deliveryId);
      else return { added: false, message: null };
      const row = await first.executeTakeFirst();
      return { added: false, message: row === undefined ? null : decodeMessage(row as MessageTable) };
    },

    async touch(threadId, fields) {
      await db
        .updateTable('adminium_text_threads')
        .set((eb) => ({
          lastAt: sql<number>`case when ${sql.ref('lastAt')} > ${sql.lit(fields.at)} then ${sql.ref('lastAt')} else ${sql.lit(fields.at)} end`,
          lastDirection: sql<string>`case when ${sql.ref('lastAt')} > ${sql.lit(fields.at)} then ${sql.ref('lastDirection')} else ${fields.direction} end`,
          lastKind: sql<string>`case when ${sql.ref('lastAt')} > ${sql.lit(fields.at)} then ${sql.ref('lastKind')} else ${fields.kind} end`,
          unread: fields.unread ? eb('unread', '+', 1) : eb.ref('unread'),
          updatedAt: fields.at,
          ...(fields.line === undefined || fields.line === null ? {} : { line: fields.line }),
          ...(fields.record === undefined ? {} : { recordConnection: fields.record.connectionId, recordTable: fields.record.table, recordKey: fields.record.key }),
        }))
        .where('id', '=', threadId)
        .execute();
    },

    async setOutcome(messageId, outcome, deliveryId) {
      await db.updateTable('adminium_text_thread_messages').set({ outcome, deliveryId }).where('id', '=', messageId).execute();
    },

    async messages(threadId, opts) {
      let select = db.selectFrom('adminium_text_thread_messages').selectAll().where('threadId', '=', threadId);
      const before = opts.before;
      if (before !== undefined) select = select.where((eb) => eb.or([eb('at', '<', before.at), eb.and([eb('at', '=', before.at), eb('id', '<', before.id)])]));
      return ((await select.orderBy('at', 'desc').orderBy('id', 'desc').limit(opts.limit).execute()) as MessageTable[]).map(decodeMessage);
    },

    async latestMessages(threadIds) {
      const out = new Map<string, TextThreadMessageRecord>();
      for (const threadId of threadIds) {
        const row = await db.selectFrom('adminium_text_thread_messages').selectAll().where('threadId', '=', threadId).orderBy('at', 'desc').orderBy('id', 'desc').limit(1).executeTakeFirst();
        if (row !== undefined) out.set(threadId, decodeMessage(row as MessageTable));
      }
      return out;
    },

    async lastIn(threadId) {
      const row = await db.selectFrom('adminium_text_thread_messages').select('at').where('threadId', '=', threadId).where('direction', '=', 'in').orderBy('at', 'desc').limit(1).executeTakeFirst();
      return row === undefined ? null : Number(row.at);
    },

    async markRead(threadId, by, at) {
      const result = await db.updateTable('adminium_text_threads').set({ unread: 0, readAt: at, readById: by.id, readByLabel: by.label }).where('id', '=', threadId).executeTakeFirst();
      return Number(result.numUpdatedRows) === 1;
    },

    async sentByApp(hashes, appKey, opts) {
      if (hashes.length === 0 || appKey === '') return [];
      let select = db
        .selectFrom('adminium_text_deliveries')
        .select(['id', 'state', 'reason', 'providerStatus', 'aboutApp', 'aboutTemplate', 'createdAt'])
        .where(ofHashes(hashes))
        .where('aboutApp', '=', appKey)
        // Words a person typed are the thread's own message: that one is shown, with this delivery's state.
        .where('aboutTemplate', 'is not', null);
      if (opts.before !== undefined) select = select.where('createdAt', '<=', opts.before);
      const rows = await select.orderBy('createdAt', 'desc').orderBy('id', 'desc').limit(opts.limit).execute();
      return rows
        .filter((row) => row.aboutApp === appKey)
        .map((row) => ({ deliveryId: row.id, template: row.aboutTemplate, state: row.state, reason: row.reason, providerStatus: row.providerStatus, at: Number(row.createdAt) }));
    },

    async lastAppOf(hashes) {
      if (hashes.length === 0) return null;
      const row = await db
        .selectFrom('adminium_text_deliveries')
        .select('aboutApp')
        .where(ofHashes(hashes))
        .where('aboutApp', 'is not', null)
        .orderBy('createdAt', 'desc')
        .orderBy('id', 'desc')
        .limit(1)
        .executeTakeFirst();
      return row?.aboutApp ?? null;
    },

    async appsTextedSince(hashes, since) {
      if (hashes.length === 0) return [];
      const rows = await db
        .selectFrom('adminium_text_deliveries')
        .select(['aboutApp', 'createdAt'])
        .where(ofHashes(hashes))
        .where('aboutApp', 'is not', null)
        .where('createdAt', '>=', since)
        .orderBy('createdAt', 'desc')
        .orderBy('id', 'desc')
        .limit(DELETE_BATCH)
        .execute();
      return [...new Set(rows.flatMap((row) => (row.aboutApp === null ? [] : [row.aboutApp])))];
    },

    async textedBefore(hashes) {
      if (hashes.length === 0) return false;
      return (await db.selectFrom('adminium_text_deliveries').select('id').where(ofHashes(hashes)).limit(1).executeTakeFirst()) !== undefined;
    },

    async answersSince(since) {
      const row = await db
        .selectFrom('adminium_text_auto_answers')
        .select((eb) => eb.fn.countAll<number | string>().as('count'))
        .where('answeredAt', '>=', since)
        .executeTakeFirstOrThrow();
      return Number(row.count);
    },

    async deliveryStates(ids) {
      const out = new Map<string, { state: string; reason: string | null; providerStatus: string | null }>();
      for (let at = 0; at < ids.length; at += DELETE_BATCH) {
        const rows = await db.selectFrom('adminium_text_deliveries').select(['id', 'state', 'reason', 'providerStatus']).where('id', 'in', ids.slice(at, at + DELETE_BATCH)).execute();
        for (const row of rows) out.set(row.id, { state: row.state, reason: row.reason, providerStatus: row.providerStatus });
      }
      return out;
    },

    async switches() {
      const rows = await db.selectFrom('adminium_text_reply_switches').selectAll().orderBy('appKey', 'asc').execute();
      return rows.map((row) => ({
        appKey: row.appKey,
        replies: row.replies === 'off' ? 'off' : 'on',
        changedBy: row.changedById === null ? null : { id: row.changedById, label: row.changedByLabel ?? '' },
        changedAt: Number(row.changedAt),
      }));
    },

    async setSwitch(appKey, replies, by, at) {
      const values = { appKey, replies, changedById: by?.id ?? null, changedByLabel: by?.label ?? null, changedAt: at };
      const insert = db.insertInto('adminium_text_reply_switches').values(values);
      const update = { replies, changedById: values.changedById, changedByLabel: values.changedByLabel, changedAt: at };
      if (dialect === 'mysql') await insert.onDuplicateKeyUpdate(update).execute();
      else await insert.onConflict((conflict) => conflict.column('appKey').doUpdateSet(update)).execute();
    },

    async takeAnswer(write, hashes, since, at) {
      if (hashes.length > 0) {
        // Under an older key version: the row that is there decides, and moves only if its time is up.
        const moved = await db.updateTable('adminium_text_auto_answers').set({ answeredAt: at }).where(ofHashes(hashes)).where('answeredAt', '<', since).executeTakeFirst();
        if (Number(moved.numUpdatedRows) > 0) return true;
        const held = await db.selectFrom('adminium_text_auto_answers').select('id').where(ofHashes(hashes)).limit(1).executeTakeFirst();
        if (held !== undefined) return false;
      }
      const id = newId('taa');
      const insert = db.insertInto('adminium_text_auto_answers').values({ id, phoneHash: write.hash, keyVersion: write.version, answeredAt: at });
      // Two at once: the row written is the one answer, and only its writer sends it.
      if (dialect === 'mysql') await insert.onDuplicateKeyUpdate({ id: sql`id` }).execute();
      else await insert.onConflict((conflict) => conflict.doNothing()).execute();
      const row = await db.selectFrom('adminium_text_auto_answers').select('id').where('phoneHash', '=', write.hash).where('keyVersion', '=', write.version).executeTakeFirst();
      return row?.id === id;
    },

    async eraseFor(hashes) {
      const ids = await threadIdsOf(hashes);
      let messages = 0;
      for (let at = 0; at < ids.length; at += DELETE_BATCH) {
        const result = await db.deleteFrom('adminium_text_thread_messages').where('threadId', 'in', ids.slice(at, at + DELETE_BATCH)).executeTakeFirst();
        messages += Number(result.numDeletedRows);
      }
      let threads = 0;
      if (hashes.length > 0) {
        threads = Number((await db.deleteFrom('adminium_text_threads').where(ofHashes(hashes)).executeTakeFirst()).numDeletedRows);
        await db.deleteFrom('adminium_text_auto_answers').where(ofHashes(hashes)).execute();
      }
      return { threads, messages };
    },

    async countFor(hashes) {
      const ids = await threadIdsOf(hashes);
      return { threads: ids.length, messages: await messageCount(ids) };
    },

    async eraseForRecords(hashes, records) {
      const ids = await recordThreadIds(hashes, records);
      let messages = 0;
      let threads = 0;
      for (let at = 0; at < ids.length; at += DELETE_BATCH) {
        const batch = ids.slice(at, at + DELETE_BATCH);
        messages += Number((await db.deleteFrom('adminium_text_thread_messages').where('threadId', 'in', batch).executeTakeFirst()).numDeletedRows);
        threads += Number((await db.deleteFrom('adminium_text_threads').where('id', 'in', batch).executeTakeFirst()).numDeletedRows);
      }
      return { threads, messages };
    },

    async countForRecords(hashes, records) {
      const ids = await recordThreadIds(hashes, records);
      return { threads: ids.length, messages: await messageCount(ids) };
    },

    async sweep(before, answersBefore, batch) {
      const old = await db.selectFrom('adminium_text_thread_messages').select('id').where('at', '<', before).limit(batch).execute();
      let messages = 0;
      if (old.length > 0) messages = Number((await db.deleteFrom('adminium_text_thread_messages').where('id', 'in', old.map((row) => row.id)).executeTakeFirst()).numDeletedRows);
      // A thread whose last line is past its time and that holds nothing more.
      const stale = await db
        .selectFrom('adminium_text_threads')
        .select('id')
        .where('lastAt', '<', before)
        .where(({ not, exists, selectFrom }) => not(exists(selectFrom('adminium_text_thread_messages').select('id').whereRef('adminium_text_thread_messages.threadId', '=', 'adminium_text_threads.id'))))
        .limit(batch)
        .execute();
      let threads = 0;
      if (stale.length > 0) threads = Number((await db.deleteFrom('adminium_text_threads').where('id', 'in', stale.map((row) => row.id)).where('lastAt', '<', before).executeTakeFirst()).numDeletedRows);
      const answers = Number((await db.deleteFrom('adminium_text_auto_answers').where('answeredAt', '<', answersBefore).executeTakeFirst()).numDeletedRows);
      return { messages, threads, answers };
    },
  };
}
