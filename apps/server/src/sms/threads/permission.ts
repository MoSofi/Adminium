// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Who may read and answer customers' texts.
 *
 *   `texts.read`            every conversation, the console's own key
 *   `texts.reply`           every conversation, and answering it, and texting
 *                           the number on a record the person reaches
 *   `texts:<app>:read`      one app's conversations, as an app's role is
 *   `texts:<app>:reply`     given them (`texts:@:read`, `texts:@:reply`)
 *
 * A customer can write anything, a symptom included, so only the Super Admin
 * holds the console's keys unless they are granted on purpose. A conversation
 * that belongs to no app is read with the console's keys alone. Replying always
 * includes reading. An API key never reads or answers a conversation.
 */
export const TEXTS_READ_ACTION = 'texts.read';
export const TEXTS_REPLY_ACTION = 'texts.reply';
export const TEXTS_READ_PERMISSION = 'system:texts:read';
export const TEXTS_REPLY_PERMISSION = 'system:texts:reply';

/** The entries for the permissions screen's table (`routes/permissions/index.ts`). */
export const TEXTS_READ_LABEL = { label: "Read customers' texts", category: 'workspace' } as const;
export const TEXTS_REPLY_LABEL = { label: "Answer customers' texts", category: 'workspace' } as const;
