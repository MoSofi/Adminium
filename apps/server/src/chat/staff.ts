// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT STAFF DO IN A WEBSITE CHAT, each step judged before anything is
 * written. The routes (`routes/chat/index.ts`) check the person's grants and
 * read the request; this writes, always through the chat store (`store.ts`),
 * so the visitor's next poll and every open inbox hear it.
 *
 *  - take: the conversation is a person's now (`open`, who, when) with a
 *    system line `taken`. Someone else holding it is a refusal that names
 *    them ("Sam is answering"), unless the person forces it;
 *  - reply: a staff message (who wrote it, whether it was a Milo draft),
 *    which takes a waiting conversation first. When the visitor left the page
 *    (no heartbeat for {@link LEFT_AFTER_MS}) or the conversation came outside
 *    hours, and they gave an address, the reply is also mailed
 *    (`reply-mail.ts`): the answer says whether, and why not;
 *  - close and reopen, each with its line; a reopen is the reopener's to
 *    answer, and the visitor's window writes again;
 *  - presence: on the page or left, and the reply mail's state. A staff read
 *    is also when the `left` line is written (once, dated at the visitor's
 *    last heartbeat, never at the read), and when the conversation counts
 *    as opened for the "a chat is waiting" notice (`waiting.ts`).
 *
 * A staff line carries its author (`author_id`): the window names them by
 * first name and initials.
 */
import { createHash } from 'node:crypto';

import { usersRepo, type MetaDb } from '@adminium/meta';

import type { EmailLogger } from '../email/send.js';
import { formsMailBlocked } from '../forms/mail.js';
import { isSampleRow } from '../payments/rehearsal.js';
import { DAY_MS } from '../public-api/claim-code.js';
import type { ChatCaps } from './caps.js';
import type { LiveChat } from './catalog.js';
import { authorOf } from './door.js';
import { CHAT_REPLY_MAILS_PER_DAY, CHAT_REPLY_MAILS_PER_RECIPIENT_DAY, mailChatReply, replyMailsUsed, replyRecipientMailsUsed, type ChatReplyMailRefusal } from './reply-mail.js';
import { boundKey, SYSTEM_LINES, type ChatConversation, type ChatMessage, type ChatStore } from './store.js';
import type { ChatWaiting } from './waiting.js';

/** A visitor with no heartbeat for this long has left the page. */
export const LEFT_AFTER_MS = 3 * 60_000;

/** Who acts: the signed-in person. */
export interface ChatActor {
  id: string;
  name: string | null;
}

/** Why a staff action was refused, as the answer names it. */
export type ChatStaffRefusal =
  /** Someone else is answering it. */
  | { refused: 'taken'; by: ChatPerson | null }
  /** It is closed: reopen it first. */
  | { refused: 'closed' }
  /** It is not closed (a reopen). */
  | { refused: 'not-closed' }
  /** The automatic answers still have it: take it first. */
  | { refused: 'automatic' };

/** A colleague as a staff page shows them. */
export interface ChatPerson {
  id: string;
  name: string;
  firstName: string;
  initials: string;
}

/** A conversation as a staff action answers it: its state and stamps, nothing the visitor typed. */
export interface ChatConversationView {
  id: string;
  state: ChatConversation['state'];
  outsideHours: boolean;
  takenBy: ChatPerson | null;
  takenAt: string | null;
  lastVisitorAt: string | null;
  lastStaffAt: string | null;
  closedAt: string | null;
  became: { table: string; key: string } | null;
}

/** A message a staff action wrote. */
export interface ChatMessageView {
  id: string;
  kind: ChatMessage['kind'];
  body: string;
  event: string | null;
  authorId: string | null;
  drafted: boolean;
  sentAt: string;
  mailedAt: string | null;
}

/** Whether the visitor is on the page, by their last heartbeat. */
export type ChatPresence = 'on-page' | 'left';

/** The reply mail's state now: whether a reply would also be mailed once the visitor is gone, and why not. */
export interface ChatReplyMailState {
  ready: boolean;
  reason: ChatReplyMailRefusal | null;
  /** Replies mailed for this conversation in the last day, of {@link CHAT_REPLY_MAILS_PER_DAY}. */
  used: number;
  max: number;
}

const iso = (at: number | null): string | null => (at === null ? null : new Date(at).toISOString());

export function messageView(message: ChatMessage): ChatMessageView {
  return {
    id: message.id,
    kind: message.kind,
    body: message.body,
    event: message.event,
    authorId: message.authorId,
    drafted: message.drafted,
    sentAt: new Date(message.sentAt).toISOString(),
    mailedAt: iso(message.mailedAt),
  };
}

/** Whether the visitor is on the page at `at`. */
export function presenceOf(conversation: Pick<ChatConversation, 'lastVisitorAt'>, at: number): ChatPresence {
  return conversation.lastVisitorAt !== null && at - conversation.lastVisitorAt < LEFT_AFTER_MS ? 'on-page' : 'left';
}

export interface ChatStaffDeps {
  meta: MetaDb;
  secret: string;
  store: ChatStore;
  caps: Pick<ChatCaps, 'once' | 'used'>;
  waiting: Pick<ChatWaiting, 'opened'>;
  logger?: EmailLogger | undefined;
  now?: () => number;
}

export type ChatStaffResult<T> = { ok: true; value: T } | ({ ok: false } & ChatStaffRefusal);

export function createChatStaff(deps: ChatStaffDeps) {
  const { meta, store } = deps;
  const now = deps.now ?? Date.now;

  async function person(id: string | null): Promise<ChatPerson | null> {
    if (id === null) return null;
    const user = await usersRepo(meta).findById(id).catch(() => null);
    const name = user?.name ?? '';
    const author = authorOf(name);
    return { id, name, firstName: author?.firstName ?? '', initials: author?.initials ?? '' };
  }

  async function view(conversation: ChatConversation): Promise<ChatConversationView> {
    return {
      id: conversation.id,
      state: conversation.state,
      outsideHours: conversation.outsideHours,
      takenBy: await person(conversation.takenBy),
      takenAt: iso(conversation.takenAt),
      lastVisitorAt: iso(conversation.lastVisitorAt),
      lastStaffAt: iso(conversation.lastStaffAt),
      closedAt: iso(conversation.closedAt),
      became: conversation.becameTable === null || conversation.becameKey === null ? null : { table: conversation.becameTable, key: conversation.becameKey },
    };
  }

  const refused = async <T>(why: ChatStaffRefusal): Promise<ChatStaffResult<T>> => ({ ok: false, ...why });

  /** Someone else is answering it. */
  const heldByOther = (conversation: ChatConversation, actor: ChatActor): boolean => conversation.state === 'open' && conversation.takenBy !== null && conversation.takenBy !== actor.id;

  /**
   * The `left` line, written once and lazily: on a staff read three minutes
   * after the visitor's last heartbeat, dated at that heartbeat, and only
   * when no `left` line stands for it already. Never on a closed chat.
   */
  async function noteLeft(chat: LiveChat, conversation: ChatConversation, at: number): Promise<void> {
    const last = conversation.lastVisitorAt;
    if (conversation.state === 'closed' || last === null || at - last < LEFT_AFTER_MS) return;
    const written = await store.lastEvent(chat, conversation.id, 'left');
    if (written !== null && written.sentAt >= last) return;
    // Two staff reads at the same moment write one line.
    const subject = `chat-left:${createHash('sha256').update(JSON.stringify([chat.addOn, conversation.id, last])).digest('hex')}`;
    if (!(await deps.caps.once(subject, 'chat-left', 1, DAY_MS, at))) return;
    await store.add(chat, conversation.id, { kind: 'system', body: SYSTEM_LINES['left']!, event: 'left' }, {}, { at: last, keepLast: true });
  }

  /** Takes it for `actor`: the `taken` line and the stamps. */
  async function takeFor(chat: LiveChat, conversation: ChatConversation, actor: ChatActor, at: number): Promise<ChatConversation | null> {
    const added = await store.add(chat, conversation.id, { kind: 'system', body: SYSTEM_LINES['taken']!, event: 'taken', authorId: actor.id }, { state: 'open', takenBy: actor.id, takenAt: at }, { at });
    return added?.conversation ?? null;
  }

  /** The reply mail's state for this conversation now. */
  async function mailState(chat: LiveChat, conversation: ChatConversation, at: number): Promise<ChatReplyMailState> {
    const used = await replyMailsUsed(deps.caps, chat.addOn, conversation.id, at);
    const base = { used, max: CHAT_REPLY_MAILS_PER_DAY };
    if (conversation.email === null) return { ...base, ready: false, reason: 'no-email' };
    const blocked = await formsMailBlocked(meta, deps.secret);
    if (blocked !== null) return { ...base, ready: false, reason: blocked };
    if (await sample(chat, conversation.id)) return { ...base, ready: false, reason: 'sample' };
    if (used >= CHAT_REPLY_MAILS_PER_DAY) return { ...base, ready: false, reason: 'cap' };
    // The address had its day's mails from this install's other chats already.
    if ((await replyRecipientMailsUsed(deps.caps, deps.secret, chat.installId, conversation.email, at)) >= CHAT_REPLY_MAILS_PER_RECIPIENT_DAY) return { ...base, ready: false, reason: 'cap' };
    return { ...base, ready: true, reason: null };
  }

  /** Whether a conversation is one of the sample rows "Add sample data" made. */
  async function sample(chat: LiveChat, id: string): Promise<boolean> {
    return isSampleRow(meta, { connectionId: chat.connectionId, db: chat.db, dialect: chat.dialect, table: chat.conversations.table }, { [chat.conversations.pk]: boundKey(id) }).catch(() => false);
  }

  return {
    view,
    person,
    noteLeft,

    /** Takes the conversation (see the header). Null: it is gone. */
    async take(chat: LiveChat, conversation: ChatConversation, actor: ChatActor, force: boolean): Promise<ChatStaffResult<ChatConversationView>> {
      const at = now();
      if (conversation.state === 'closed') return refused({ refused: 'closed' });
      if (heldByOther(conversation, actor) && !force) return refused({ refused: 'taken', by: await person(conversation.takenBy) });
      await noteLeft(chat, conversation, at);
      await deps.waiting.opened(chat, conversation.id);
      if (conversation.state === 'open' && conversation.takenBy === actor.id) return { ok: true, value: await view(conversation) };
      const taken = (await takeFor(chat, conversation, actor, at)) ?? conversation;
      return { ok: true, value: await view(taken) };
    },

    /** A staff reply, and the reply mail when the visitor is gone (see the header). */
    async reply(
      chat: LiveChat,
      conversation: ChatConversation,
      actor: ChatActor,
      input: { body: string; drafted: boolean; force: boolean },
    ): Promise<ChatStaffResult<{ message: ChatMessageView; conversation: ChatConversationView; presence: ChatPresence; mailed: boolean; reason: ChatReplyMailRefusal | null }>> {
      const at = now();
      if (conversation.state === 'closed') return refused({ refused: 'closed' });
      if (conversation.state === 'bot') return refused({ refused: 'automatic' });
      if (heldByOther(conversation, actor) && !input.force) return refused({ refused: 'taken', by: await person(conversation.takenBy) });
      await noteLeft(chat, conversation, at);
      await deps.waiting.opened(chat, conversation.id);
      // Nobody holds it (or the person forced it): it is theirs before they answer.
      if (!(conversation.state === 'open' && conversation.takenBy === actor.id)) await takeFor(chat, conversation, actor, at);
      const added = await store.add(chat, conversation.id, { kind: 'staff', body: input.body, authorId: actor.id, drafted: input.drafted }, { lastStaffAt: at }, { at });
      if (added === null) return refused({ refused: 'closed' });
      const presence = presenceOf(conversation, at);
      let mailed = false;
      let reason: ChatReplyMailRefusal | null = null;
      // Mailed only to a visitor who is gone, or whose question came outside hours: one on the page reads it there.
      if (presence === 'left' || conversation.outsideHours) {
        const outcome = await mailChatReply({
          meta,
          secret: deps.secret,
          caps: deps.caps,
          chat,
          conversation,
          reply: input.body,
          sample: await sample(chat, conversation.id),
          at,
          logger: deps.logger,
        });
        if (outcome.mailed) {
          mailed = true;
          await store.markMailed(chat, added.message.id, at);
          added.message.mailedAt = at;
        } else {
          reason = outcome.reason;
        }
      }
      return { ok: true, value: { message: messageView(added.message), conversation: await view(added.conversation), presence, mailed, reason } };
    },

    /** Closes it, with the closer's line. A closed one stays as it is. */
    async close(chat: LiveChat, conversation: ChatConversation, actor: ChatActor): Promise<ChatStaffResult<ChatConversationView>> {
      const at = now();
      if (conversation.state === 'closed') return { ok: true, value: await view(conversation) };
      await noteLeft(chat, conversation, at);
      await deps.waiting.opened(chat, conversation.id);
      const added = await store.add(chat, conversation.id, { kind: 'system', body: SYSTEM_LINES['closed']!, event: 'closed', authorId: actor.id }, { state: 'closed', closedAt: at }, { at });
      return { ok: true, value: await view(added?.conversation ?? conversation) };
    },

    /** Reopens a closed one: the reopener's to answer, and the visitor's window writes again. */
    async reopen(chat: LiveChat, conversation: ChatConversation, actor: ChatActor): Promise<ChatStaffResult<ChatConversationView>> {
      const at = now();
      if (conversation.state !== 'closed') return refused({ refused: 'not-closed' });
      const added = await store.add(
        chat,
        conversation.id,
        { kind: 'system', body: SYSTEM_LINES['reopened']!, event: 'reopened', authorId: actor.id },
        { state: 'open', takenBy: actor.id, takenAt: at, closedAt: null },
        { at },
      );
      return { ok: true, value: await view(added?.conversation ?? conversation) };
    },

    /** Where the visitor is, and whether a reply would also be mailed; a staff read (see the header). */
    async presence(chat: LiveChat, conversation: ChatConversation): Promise<{ presence: ChatPresence; lastVisitorAt: string | null; outsideHours: boolean; mail: ChatReplyMailState; conversation: ChatConversationView }> {
      const at = now();
      await noteLeft(chat, conversation, at);
      await deps.waiting.opened(chat, conversation.id);
      return {
        presence: presenceOf(conversation, at),
        lastVisitorAt: iso(conversation.lastVisitorAt),
        outsideHours: conversation.outsideHours,
        mail: await mailState(chat, conversation, at),
        conversation: await view(conversation),
      };
    },
  };
}

export type ChatStaff = ReturnType<typeof createChatStaff>;
