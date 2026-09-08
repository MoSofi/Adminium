// SPDX-License-Identifier: AGPL-3.0-only
import { attachmentsOf, chatRowsOf } from '../../families/communication/chat-lib.js';
import type { ChatMessage } from '../../families/communication/chat-lib.js';
import type { ConversationRow } from '../../families/communication/ConversationInbox.js';

/**
 * `page-chat` field mapping (09-generated-app.md §7.9) — PURE module.
 *
 * The §14 generator binds `conversation-inbox` to the conversation table and
 * `chat-thread` to its messages child (candidates rule
 * `communication.conversation-message-pair`), storing only `title` + `binding`
 * — no column naming. This module projects both payloads onto the widgets'
 * row models by DETERMINISTIC vocabulary detection over the payload's own
 * keys, including the spec's email→name derivation (§7.9 "email→name
 * derivation") and the conversation-FK detection that scopes the thread to
 * the selected conversation.
 */

export interface ChatMessageFieldMap {
  author?: string | undefined;
  body?: string | undefined;
  sentAt?: string | undefined;
  attachments?: string | undefined;
  /**
   * A column saying WHICH SIDE wrote the row, where the table has one.
   *
   * Optional and usually absent — most message tables in the fleet identify
   * the writer by name or e-mail alone. Where it IS present it outranks the
   * name, and `toChatMessages` says why.
   */
  senderKind?: string | undefined;
}

export interface ConversationFieldMap {
  name?: string | undefined;
  preview?: string | undefined;
  sentAt?: string | undefined;
  unread?: string | undefined;
  online?: string | undefined;
  group?: string | undefined;
}

function keysOf(rows: readonly Record<string, unknown>[]): Set<string> {
  const keys = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) keys.add(key);
  return keys;
}

function firstPresent(keys: ReadonlySet<string>, candidates: readonly string[]): string | undefined {
  return candidates.find((name) => keys.has(name));
}

function str(row: Record<string, unknown>, field: string | undefined): string | undefined {
  if (field === undefined) return undefined;
  const value = row[field];
  if (typeof value === 'string') return value === '' ? undefined : value;
  if (typeof value === 'number') return String(value);
  return undefined;
}

/** Email → display name (09 §7.9): `ava.reyes@acme.dev` → `Ava Reyes`. */
export function displayNameOf(value: string): string {
  const at = value.indexOf('@');
  if (at <= 0) return value;
  return value
    .slice(0, at)
    .split(/[._-]+/)
    .filter((part) => part !== '')
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
}

// ── messages (chat-thread pane) ─────────────────────────────────────────────

export function detectMessageFields(rows: readonly Record<string, unknown>[]): ChatMessageFieldMap {
  const keys = keysOf(rows);
  return {
    body: firstPresent(keys, ['body', 'message', 'content', 'text', 'message_text', 'message_body']),
    sentAt: firstPresent(keys, ['sent_at', 'sentAt', 'created_at', 'ts', 'timestamp', 'created']),
    author: firstPresent(keys, [
      'author', 'author_name', 'author_email',
      'sender', 'sender_name', 'sender_email',
      'from_email', 'from',
      'user_email', 'user_name', 'username', 'user', 'email',
    ]),
    attachments: firstPresent(keys, ['attachments', 'files']),
    /*
     * DELIBERATELY THE NARROWEST LIST IN THIS FILE. Every other vocabulary
     * here only decides which column to READ; this one decides which SIDE of
     * the thread a bubble lands on, so a false positive would re-side an
     * existing app's whole history. `role`, `type` and `direction` were all
     * considered and left out: each is common enough to appear on a table that
     * means something else by it, and the fallback — matching the author name
     * — is the behaviour every generated app has today and is not broken.
     */
    senderKind: firstPresent(keys, ['sender_kind', 'sender_type', 'author_kind', 'author_type']),
  };
}

/**
 * The values of a sender-kind column that mean "the business wrote this".
 *
 * `staff` is what Adminium's own `requiredSchema` uses; the other two are the
 * words an operator's existing table is most likely to use for the same idea.
 * Anything else — `customer`, `visitor`, `bot`, a blank — is not the viewer.
 */
const OWN_SENDER_KINDS = new Set(['staff', 'agent', 'operator']);

/**
 * The messages table's conversation FK. The conversation table's own name
 * seeds the vocabulary (`conversations` → `conversation_id`), so the pair the
 * generator matched stays coupled without any schema knowledge client-side.
 */
export function detectConversationFk(
  rows: readonly Record<string, unknown>[],
  conversationTable: string | null | undefined,
): string | undefined {
  const keys = keysOf(rows);
  const bare = (conversationTable ?? '').split('.').pop() ?? '';
  const singular = bare.endsWith('ies') ? `${bare.slice(0, -3)}y` : bare.endsWith('s') ? bare.slice(0, -1) : bare;
  const seeded = singular === '' ? [] : [`${singular}_id`, `${singular}Id`];
  return firstPresent(keys, [
    ...seeded,
    'conversation_id', 'thread_id', 'chat_id', 'channel_id', 'room_id', 'topic_id', 'parent_id',
  ]);
}

/** Rows scoped to one conversation; a missing FK column passes everything. */
export function filterMessagesRows(
  rows: readonly Record<string, unknown>[],
  fkColumn: string | undefined,
  conversationId: string | number | null,
): Record<string, unknown>[] {
  if (fkColumn === undefined || conversationId === null) return [...rows];
  return rows.filter((row) => String(row[fkColumn] ?? '') === String(conversationId));
}

/** Project raw message rows onto ChatMessage via the detected map. */
export function toChatMessages(
  data: unknown,
  map: ChatMessageFieldMap,
  ownAuthors: readonly string[] = [],
): ChatMessage[] {
  return chatRowsOf(data).map((row, index) => {
    const rawAuthor = str(row, map.author);
    const author = rawAuthor === undefined ? undefined : displayNameOf(rawAuthor);
    /*
     * THE KIND OUTRANKS THE NAME, WHERE THERE IS A KIND.
     *
     * Matching the author name is all there was, and it is a check the WRITER
     * of a row controls: on a table an anonymous visitor can write to — which
     * is the whole point of the public surface — somebody typing a support
     * agent's address into `author` would have their own message render as the
     * agent's, on the agent's side of the agent's own inbox.
     *
     * A sender-kind column is not writable by that visitor (the scope stamps it
     * server-side), so where the table has one it decides, in BOTH directions:
     * a row that says `customer` is the visitor's even if the name matches, and
     * a row that says `staff` is the viewer's even if it does not. The name
     * match remains for the tables — most of them — with no such column, and
     * for rows that leave it blank.
     */
    const kind = str(row, map.senderKind)?.toLowerCase();
    const own =
      kind !== undefined
        ? OWN_SENDER_KINDS.has(kind)
        : rawAuthor !== undefined &&
          ownAuthors.some((entry) => entry === rawAuthor || displayNameOf(entry) === author);
    const attachments = map.attachments === undefined ? [] : attachmentsOf(row[map.attachments]);
    return {
      id: (row['id'] as string | number | undefined) ?? index,
      ...(author === undefined ? {} : { author }),
      own,
      body: str(row, map.body) ?? '',
      sentAt: str(row, map.sentAt) ?? '',
      ...(attachments.length === 0 ? {} : { attachments }),
    };
  });
}

// ── conversations (inbox rail) ──────────────────────────────────────────────

export function detectConversationFields(rows: readonly Record<string, unknown>[]): ConversationFieldMap {
  const keys = keysOf(rows);
  return {
    name: firstPresent(keys, [
      'name', 'title', 'subject', 'participants', 'customer_name', 'contact_name', 'label',
      'customer_email', 'email',
    ]),
    preview: firstPresent(keys, ['preview', 'last_message', 'last_message_preview', 'snippet', 'description']),
    sentAt: firstPresent(keys, ['last_message_at', 'updated_at', 'created_at', 'ts']),
    unread: firstPresent(keys, ['unread', 'unread_count']),
    online: firstPresent(keys, ['online', 'is_online']),
    group: firstPresent(keys, ['group', 'is_group']),
  };
}

/** Project raw conversation rows onto the inbox model (email→name derived). */
export function toConversationRows(data: unknown, map: ConversationFieldMap): ConversationRow[] {
  return chatRowsOf(data).map((row, index) => {
    const rawName = str(row, map.name);
    const preview = str(row, map.preview);
    const ts = str(row, map.sentAt);
    const unreadRaw = map.unread === undefined ? undefined : Number(row[map.unread]);
    return {
      id: (row['id'] as string | number | undefined) ?? index,
      name: rawName === undefined ? `#${String(row['id'] ?? index + 1)}` : displayNameOf(rawName),
      ...(preview === undefined ? {} : { preview }),
      ...(ts === undefined ? {} : { ts }),
      ...(unreadRaw === undefined || !Number.isFinite(unreadRaw) ? {} : { unread: unreadRaw }),
      ...(map.online === undefined ? {} : { online: row[map.online] === true || row[map.online] === 1 }),
      ...(map.group === undefined ? {} : { group: row[map.group] === true || row[map.group] === 1 }),
    };
  });
}
