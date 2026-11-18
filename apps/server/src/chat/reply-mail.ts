// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A STAFF REPLY, MAILED TO A VISITOR WHO LEFT: the one mail that ever goes
 * to an address typed in a website chat.
 *
 * Anyone can type any address, so the mail is held to this:
 *  - it goes only for a staff member's reply, never for anything automatic,
 *    and only when the visitor left the page (no heartbeat for three
 *    minutes) or the conversation came outside hours, and gave an address
 *    (the route decides that, `staff.ts`);
 *  - its body is the business's name and the reply as the staff member wrote
 *    it: never a word the visitor typed, never the conversation, never a link
 *    back into it (the built-in `chat-reply`, reworded per language in Email
 *    templates, in the conversation's language);
 *  - service mail, as the sender of the workspace the chat's database is in
 *    (its postal address in the footer), else the server's;
 *  - nothing goes while this server's public address or a mail server is not
 *    set up (`formsMailBlocked`), at most {@link CHAT_REPLY_MAILS_PER_DAY}
 *    go for one conversation in a day, and at most
 *    {@link CHAT_REPLY_MAILS_PER_RECIPIENT_DAY} to one address in a day across
 *    every conversation of the install (anyone may type a stranger's address
 *    into many chats); that address is counted by a keyed hash, never
 *    kept. The reply is kept either way, and the staff member is told which
 *    it was;
 *  - a sample conversation ("Add sample data") sends nothing.
 */
import { createHash, createHmac } from 'node:crypto';

import type { MetaDb } from '@adminium/meta';

import { storedPublicOrigin } from '../email/door-reach.js';
import { postalAddressOf } from '../email/sender/marketing-settings.js';
import { CHAT_REPLY_TEMPLATE_KEY, enqueueEmail, type EmailLogger } from '../email/send.js';
import { resolveMailSender } from '../email/workspace-sender.js';
import { formsMailBlocked, type FormsMailBlock } from '../forms/mail.js';
import { businessName } from '../privacy/business.js';
import { DAY_MS, normaliseAddress } from '../public-api/claim-code.js';
import { chatCapKey, type ChatCaps } from './caps.js';
import type { LiveChat } from './catalog.js';
import type { ChatConversation } from './store.js';

/** The most replies one conversation mails in a day. */
export const CHAT_REPLY_MAILS_PER_DAY = 3;
/** The most replies one address is mailed in a day, across every conversation of an install. */
export const CHAT_REPLY_MAILS_PER_RECIPIENT_DAY = 5;
/** The marks' purposes (at most 16 characters). */
const PURPOSE = 'chat-reply-mail';
const TO_PURPOSE = 'chat-reply-to';

/** Why a reply was not mailed: the mail block, the day's three used, no address given, or a sample conversation. */
export type ChatReplyMailRefusal = FormsMailBlock | 'cap' | 'no-email' | 'sample';

export type ChatReplyMailOutcome = { mailed: true } | { mailed: false; reason: ChatReplyMailRefusal };

/** One conversation's subject for the day's count. */
export function replyMailSubject(addOn: string, conversationId: string): string {
  return `chat-mail:${createHash('sha256').update(JSON.stringify([addOn, conversationId])).digest('hex')}`;
}

/** One address's subject for the day's count, on one install: a keyed hash of the address as every door normalises it, never the address. */
export function replyRecipientSubject(secret: string, installId: string, email: string): string {
  return `chat-mail-to:${createHmac('sha256', chatCapKey(secret)).update(JSON.stringify([installId, normaliseAddress(email)])).digest('hex')}`;
}

/** How many of the day's mails one address has been sent from an install's chats. */
export async function replyRecipientMailsUsed(caps: Pick<ChatCaps, 'used'>, secret: string, installId: string, email: string, at: number): Promise<number> {
  return caps.used(replyRecipientSubject(secret, installId, email), TO_PURPOSE, DAY_MS, at);
}

/** How many of the day's mails one conversation has used. */
export async function replyMailsUsed(caps: Pick<ChatCaps, 'used'>, addOn: string, conversationId: string, at: number): Promise<number> {
  return caps.used(replyMailSubject(addOn, conversationId), PURPOSE, DAY_MS, at);
}

export interface ChatReplyMailInput {
  meta: MetaDb;
  secret: string;
  caps: Pick<ChatCaps, 'once' | 'used'>;
  chat: Pick<LiveChat, 'addOn' | 'connectionId' | 'installId'>;
  conversation: Pick<ChatConversation, 'id' | 'email' | 'language'>;
  /** What the staff member wrote. */
  reply: string;
  /** A sample conversation: nothing is sent. */
  sample: boolean;
  at: number;
  logger?: EmailLogger | undefined;
}

/** Mails a reply (see the header); answers whether it was queued, and why not. */
export async function mailChatReply(input: ChatReplyMailInput): Promise<ChatReplyMailOutcome> {
  const { meta, conversation } = input;
  if (input.sample) return { mailed: false, reason: 'sample' };
  const blocked = await formsMailBlocked(meta, input.secret);
  if (blocked !== null) return { mailed: false, reason: blocked };
  const origin = await storedPublicOrigin(meta);
  if (origin === null) return { mailed: false, reason: 'no-public-origin' };
  if (conversation.email === null) return { mailed: false, reason: 'no-email' };
  // Counted before it is queued: two replies at the same moment cannot both slip past the day's three.
  // The address's own day, across every conversation of the install: read first, so a refused one uses none of the conversation's three…
  const recipient = replyRecipientSubject(input.secret, input.chat.installId, conversation.email);
  if ((await input.caps.used(recipient, TO_PURPOSE, DAY_MS, input.at)) >= CHAT_REPLY_MAILS_PER_RECIPIENT_DAY) return { mailed: false, reason: 'cap' };
  if (!(await input.caps.once(replyMailSubject(input.chat.addOn, conversation.id), PURPOSE, CHAT_REPLY_MAILS_PER_DAY, DAY_MS, input.at))) return { mailed: false, reason: 'cap' };
  // …then counted as the conversation's is, so two replies at the same moment cannot both slip past the address's five.
  if (!(await input.caps.once(recipient, TO_PURPOSE, CHAT_REPLY_MAILS_PER_RECIPIENT_DAY, DAY_MS, input.at))) return { mailed: false, reason: 'cap' };
  const locale = conversation.language.replace('-', '_');
  const sender = await resolveMailSender(meta, { connectionId: input.chat.connectionId, templateKey: CHAT_REPLY_TEMPLATE_KEY });
  const business = sender.name ?? (await businessName(meta, { origin }));
  const queued = await enqueueEmail(
    { meta, secret: input.secret, ...(input.logger === undefined ? {} : { logger: input.logger }) },
    {
      to: conversation.email,
      templateKey: CHAT_REPLY_TEMPLATE_KEY,
      locale,
      mailClass: 'service',
      sender,
      vars: { business, reply: input.reply, postal: sender.postal ?? (await postalAddressOf(meta)) ?? business },
    },
  );
  return queued === null ? { mailed: false, reason: 'no-mail-server' } : { mailed: true };
}
