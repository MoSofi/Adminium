// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "A CHAT IS WAITING": staff are told that a visitor waits for a person, once
 * per conversation until someone opens it.
 *
 * A conversation waits when it starts with nobody's answers in hours, when a
 * question is left outside hours, when the answerer or the visitor hands it
 * over, and while the visitor writes into it and nobody has taken it. The
 * store says so after each such write (`store.ts`); this tells staff:
 *
 *  - once: a mark per conversation (`caps.once`), made before anybody is
 *    told, so ten messages, or two at the same moment, tell once. Opening the
 *    conversation (its page reads the visitor's presence, or someone takes or
 *    answers it) takes the mark back: the next wait tells again. The marks
 *    are the forms door's, swept after two days, so a conversation left
 *    waiting that long tells once more when the visitor writes again;
 *  - whom: the readers of the conversations among the people the chat's
 *    `tell` names; with no `tell`, every reader. A grant taken away since the
 *    chat named someone counts: they are not told;
 *  - how: a bell, and an e-mail only for a person who switched it on for
 *    `chat.waiting` (its default is the bell alone: one waiting chat never
 *    mails the whole staff), in each person's own language.
 *
 * Never awaited by the write it is about, and never throws: a visitor's
 * message is kept whatever this does.
 */
import { createHash } from 'node:crypto';

import type { MetaDb } from '@adminium/meta';

import type { EmailLogger } from '../email/send.js';
import { formsMailBlocked, holdersOf, toldBy } from '../forms/mail.js';
import { translatorFor } from '../i18n/server-i18n.js';
import { notify, type NotificationPublisher } from '../notifications/notify.js';
import { DAY_MS } from '../public-api/claim-code.js';
import { permissionSetAllows, resolvePermissionSet } from '../rbac/resolver.js';
import type { ChatCaps } from './caps.js';
import type { LiveChat } from './catalog.js';
import type { ChatConversation } from './store.js';

/** The notice's kind (what a person's notification settings switch). */
export const CHAT_WAITING_NOTICE = 'chat.waiting';
/** The marks' purpose (at most 16 characters). */
const PURPOSE = 'chat-waiting';
/** How long one notice holds the next back while nobody opens the conversation: the marks' own keeping time. */
export const CHAT_WAITING_HOLD_MS = 2 * DAY_MS;

/** One conversation's subject. */
export function waitingSubject(addOn: string, conversationId: string): string {
  return `chat-wait:${createHash('sha256').update(JSON.stringify([addOn, conversationId])).digest('hex')}`;
}

/** Where a conversation opens in its add-on's own page. */
export function chatConversationLink(addOn: string, conversationId: string): string {
  const key = encodeURIComponent(addOn);
  return `/add-ons/${key}/${key}?conversation=${encodeURIComponent(conversationId)}`;
}

/** Of `people`, those who may read the conversations now. */
async function readers(meta: MetaDb, people: readonly string[], permission: string): Promise<string[]> {
  const out: string[] = [];
  for (const userId of people) {
    try {
      if (permissionSetAllows(await resolvePermissionSet(meta, { kind: 'user', id: userId, label: '' }), permission)) out.push(userId);
    } catch {
      // A person whose rights cannot be read is not told.
    }
  }
  return out;
}

export interface ChatWaitingDeps {
  meta: MetaDb;
  secret: string;
  caps: Pick<ChatCaps, 'once' | 'clearOnce'>;
  hub?: () => NotificationPublisher | undefined;
  logger?: EmailLogger | undefined;
  now?: () => number;
}

export function createChatWaiting(deps: ChatWaitingDeps) {
  const { meta } = deps;
  const now = deps.now ?? Date.now;
  /** The notices still being written, so a test (and a shutdown) can wait for them. */
  const running = new Set<Promise<number>>();

  /** Tells the people the chat tells that this conversation waits; answers how many were told (0: told already). */
  async function tell(chat: Pick<LiveChat, 'addOn' | 'name' | 'connectionId' | 'conversations' | 'settings'>, conversation: Pick<ChatConversation, 'id' | 'state' | 'name' | 'outsideHours'>): Promise<number> {
    if (conversation.state !== 'waiting') return 0;
    const at = now();
    if (!(await deps.caps.once(waitingSubject(chat.addOn, conversation.id), PURPOSE, 1, CHAT_WAITING_HOLD_MS, at))) return 0;
    const permission = `table:${chat.connectionId}:${chat.conversations.table.id}:read`;
    const named = chat.settings.tell === null ? [] : await toldBy(meta, chat.settings.tell);
    const people = named.length > 0 ? await readers(meta, named, permission) : await holdersOf(meta, permission);
    const mail = (await formsMailBlocked(meta, deps.secret)) === null;
    const hub = deps.hub?.();
    let told = 0;
    for (const userId of people) {
      try {
        const i18n = await translatorFor(meta, userId);
        const who = conversation.name ?? i18n.t('email:chat.waitingSomeone', { defaultValue: 'A visitor' });
        await notify(
          meta,
          {
            userId,
            kind: CHAT_WAITING_NOTICE,
            title: i18n.t('email:chat.waitingTitle', { chat: chat.name, defaultValue: 'A chat is waiting: {chat}' }),
            body: conversation.outsideHours
              ? i18n.t('email:chat.waitingOutside', { name: who, defaultValue: '{name} left a question outside your hours and waits for a person to answer.' })
              : i18n.t('email:chat.waitingBody', { name: who, defaultValue: '{name} is waiting for a person to answer.' }),
            actionUrl: chatConversationLink(chat.addOn, conversation.id),
          },
          { at, email: mail, ...(hub === undefined ? {} : { hub }), ...(deps.logger === undefined ? {} : { logger: deps.logger }) },
        );
        told += 1;
      } catch (error) {
        deps.logger?.warn({ err: error, userId }, 'a chat waiting notice could not be written');
      }
    }
    return told;
  }

  return {
    tell,

    /** The store's hook: tells in the background, never throws. */
    heard(chat: LiveChat, conversation: ChatConversation): void {
      const work = tell(chat, conversation).catch((error: unknown) => {
        deps.logger?.warn({ err: error, addOn: chat.addOn }, 'a chat waiting notice could not be sent');
        return 0;
      });
      running.add(work);
      void work.finally(() => running.delete(work));
    },

    /** Someone opened the conversation: the next wait tells again. */
    async opened(chat: Pick<LiveChat, 'addOn'>, conversationId: string): Promise<void> {
      await deps.caps.clearOnce(waitingSubject(chat.addOn, conversationId), PURPOSE);
    },

    /** The notices still being written: a test waits for them before it reads. */
    settled: async (): Promise<void> => {
      while (running.size > 0) await Promise.all([...running]);
    },
  };
}

export type ChatWaiting = ReturnType<typeof createChatWaiting>;
