// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The two classes of mail to a contact. Kept apart from `mail-class.ts` so the
 * outbox and automation words can name them without importing the reader that
 * reads those words back (which would be an import cycle).
 */
export const MAIL_CLASSES = ['marketing', 'service'] as const;
export type MailClass = (typeof MAIL_CLASSES)[number];
