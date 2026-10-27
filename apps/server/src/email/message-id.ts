// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A campaign mail's `Message-ID`, which names its send-log row.
 *
 * A mail service reports a bounce or a spam report later, by its own call
 * (`email/notices/`), and says which address it was about. To mark the right
 * row of the send log "Bounced" or "Marked as spam", the notice must also
 * name the mail. Most services hand back the `Message-ID` the mail left with,
 * so a campaign mail leaves with one made from its row's id:
 *
 *     <esnd_01JB2Y7…@meridian.example>
 *
 * The right-hand side is the From's domain, as a `Message-ID` usually reads.
 * Nothing needs storing: the row's id is in the `Message-ID` itself, and
 * the same id goes with every try of the same message. A notice that names
 * a `Message-ID` of another shape (a service's own id, a mail not sent by a
 * campaign) finds no row, and the address still goes on the do-not-email
 * list as before.
 */
import { domainOfAddress } from './sender/free-mail.js';
import { bareAddress } from './document.js';

/** A send-log row's id: `esnd_` and a ULID (`newId('esnd')`). */
const SEND_ID = /^esnd_([0-9A-HJKMNP-TV-Z]{26})$/i;

/** How a send-log row names itself to the mail queue (the `report` of its `email.send` job). */
export const CAMPAIGN_REPORT_APP = 'adminium.campaign';
export const CAMPAIGN_REPORT_TABLE = 'adminium_email_sends';

/** The send-log row an `email.send` job's report names, or null when it is not a campaign mail's. */
export function campaignSendOfReport(report: { app: string; table: string; pk: Record<string, string | number> } | undefined): string | null {
  if (report === undefined || report.app !== CAMPAIGN_REPORT_APP || report.table !== CAMPAIGN_REPORT_TABLE) return null;
  const id = report.pk['id'];
  return typeof id === 'string' && SEND_ID.test(id) ? id : null;
}

/** The `Message-ID` of the campaign mail for send-log row `sendId`, sent from `from`. */
export function campaignMessageId(sendId: string, from: string): string {
  const domain = domainOfAddress(bareAddress(from));
  // Only a plain host name goes in a header; anything else (a typo in the From) reads `localhost`.
  return `<${sendId}@${domain !== null && /^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(domain) ? domain : 'localhost'}>`;
}

/**
 * The send-log row a `Message-ID` names, or null when it names none. Taken
 * with or without its angle brackets, in any case (a service may change
 * either); only the part before the `@` is read.
 */
export function sendIdOfMessageId(messageId: string | null | undefined): string | null {
  if (messageId === null || messageId === undefined) return null;
  const bare = messageId.trim().replace(/^</, '').replace(/>$/, '');
  const at = bare.lastIndexOf('@');
  if (at <= 0) return null;
  const match = SEND_ID.exec(bare.slice(0, at));
  return match === null ? null : `esnd_${match[1]!.toUpperCase()}`;
}
