// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The two classes of mail to a contact. Kept apart from `mail-class.ts` so the
 * outbox and automation words can name them without importing the reader that
 * reads those words back (which would be an import cycle).
 */
export const MAIL_CLASSES = ['marketing', 'service'] as const;
export type MailClass = (typeof MAIL_CLASSES)[number];

/**
 * The consent purposes a mail to a contact may be sent for: the consent log's
 * own (`CONSENT_PURPOSES` in `@adminium/meta`, spelled here so the manifest
 * imports no store). An outbox kind may name one (`outbox.purposes`).
 */
export const MAIL_PURPOSES = ['newsletter', 'surveys'] as const;
export type MailPurpose = (typeof MAIL_PURPOSES)[number];
