// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE CHAT'S BREAKER NOTICE: the people a chat tells learn, once, that new
 * conversations are paused (`caps.ts`), until when, and that they may resume
 * them sooner.
 *
 * Told: the people the chat's `tell` names, else those who may change its
 * settings. A bell, and an e-mail by each person's own notification settings
 * (`chat.paused`), in each person's own language.
 */
import type { MetaDb } from '@adminium/meta';

import { formsMailBlocked, holdersOf, toldBy } from '../forms/mail.js';
import { translatorFor } from '../i18n/server-i18n.js';
import { businessZone, notify, type NotificationPublisher } from '../notifications/notify.js';
import type { LiveChat } from './catalog.js';

/** The notice's kind (what a person's notification settings switch). */
export const CHAT_PAUSED_NOTICE = 'chat.paused';

/** Where a chat's settings open in its add-on's own page. */
export function chatSettingsLink(addOn: string): string {
  const key = encodeURIComponent(addOn);
  return `/add-ons/${key}/${key}?settings=1`;
}

export interface PausedNoticeInput {
  meta: MetaDb;
  secret: string;
  hub?: NotificationPublisher | undefined;
  chat: Pick<LiveChat, 'addOn' | 'name' | 'connectionId' | 'settings' | 'settingsTable'>;
  /** When new conversations open again by themselves. */
  until: number;
  at: number;
}

/** "New chats are paused": a notice to each person told. Answers how many were told; never throws. */
export async function tellChatPaused(input: PausedNoticeInput): Promise<number> {
  const { meta, chat } = input;
  try {
    const named = chat.settings.tell === null ? [] : await toldBy(meta, chat.settings.tell);
    const people = named.length > 0 ? named : await holdersOf(meta, `table:${chat.connectionId}:${chat.settingsTable.table.id}:update`);
    const mail = (await formsMailBlocked(meta, input.secret)) === null;
    const zone = await businessZone(meta);
    let told = 0;
    for (const userId of people) {
      const i18n = await translatorFor(meta, userId);
      const tag = String(i18n.language || 'en-US').replace('_', '-');
      const time = new Intl.DateTimeFormat(`${tag}-u-nu-latn`, { hour: '2-digit', minute: '2-digit', timeZone: zone }).format(new Date(input.until));
      await notify(
        meta,
        {
          userId,
          kind: CHAT_PAUSED_NOTICE,
          title: i18n.t('email:chat.pausedTitle', { chat: chat.name, defaultValue: 'New chats are paused: {chat}' }),
          body: i18n.t('email:chat.pausedBody', {
            time,
            defaultValue: 'So many new chats started within an hour that it looks like a script. New visitors cannot start a chat until {time}; visitors already chatting go on. You can resume new chats sooner in the chat’s settings.',
          }),
          actionUrl: chatSettingsLink(chat.addOn),
        },
        { at: input.at, email: mail, ...(input.hub === undefined ? {} : { hub: input.hub }) },
      );
      told += 1;
    }
    return told;
  } catch {
    return 0;
  }
}
