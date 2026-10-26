// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Which mail service a send goes through, read from the SMTP host the owner
 * set (`email.smtp.host`), and the headers that switch that service's
 * tracking off.
 *
 * Tracking rewrites links and adds a pixel, which breaks Adminium's DKIM body
 * hash, and some services add their own unsubscribe footer and header. Where
 * a service has a per-message switch, a marketing send sets it:
 *   - Mailgun: `X-Mailgun-Track: no`, and the clicks and opens switches
 *     (https://documentation.mailgun.com/docs/mailgun/user-manual/sending-messages/send-smtp);
 *   - SendGrid: one `X-SMTPAPI` header turning click, open and subscription
 *     tracking off (https://www.twilio.com/docs/sendgrid/for-developers/sending-email/smtp-filters);
 *   - Postmark: `X-PM-TrackLinks: None`, and `X-PM-KeepID: true` so Postmark
 *     keeps the Message-ID (https://postmarkapp.com/developer/user-guide/send-email-with-smtp).
 *     Open tracking turned on for the whole Postmark server cannot be turned
 *     off per message; the sender guide says so;
 *   - Amazon SES: a configuration set the owner made with no open or click
 *     destination, named in `X-SES-CONFIGURATION-SET`; none when the owner
 *     named none (then SES tracks nothing, unless the identity has a default
 *     set: the sender guide says to check);
 *   - Brevo: no documented per-message switch. Its tracking is switched off
 *     in its account (the sender guide says so); nothing is sent.
 */

export const MAIL_RELAYS = ['ses', 'postmark', 'mailgun', 'brevo', 'sendgrid'] as const;
export type MailRelay = (typeof MAIL_RELAYS)[number];

const HOSTS: readonly { relay: MailRelay; pattern: RegExp }[] = [
  // email-smtp.<region>.amazonaws.com, and its FIPS twin.
  { relay: 'ses', pattern: /^email-smtp(?:-fips)?\.[a-z0-9-]+\.amazonaws\.com$/ },
  // smtp.postmarkapp.com, smtp-broadcasts.postmarkapp.com
  { relay: 'postmark', pattern: /(?:^|\.)postmarkapp\.com$/ },
  // smtp.mailgun.org, smtp.eu.mailgun.org
  { relay: 'mailgun', pattern: /(?:^|\.)mailgun\.org$/ },
  // smtp-relay.brevo.com, and the older smtp-relay.sendinblue.com
  { relay: 'brevo', pattern: /(?:^|\.)(?:brevo|sendinblue)\.com$/ },
  // smtp.sendgrid.net
  { relay: 'sendgrid', pattern: /(?:^|\.)sendgrid\.net$/ },
];

/** The mail service an SMTP host belongs to; null for any other host (the owner's own server, another service). */
export function relayOf(smtpHost: string): MailRelay | null {
  const host = smtpHost.trim().toLowerCase().replace(/\.$/, '');
  return HOSTS.find((entry) => entry.pattern.test(host))?.relay ?? null;
}

/** An SES configuration set's name: letters, digits, `_` and `-`, at most 64. */
const CONFIGURATION_SET = /^[A-Za-z0-9_-]{1,64}$/;

export class TrackingHeaderError extends Error {
  override readonly name = 'TrackingHeaderError';
}

/** The headers a marketing send through `relay` carries to switch its tracking off. */
export function trackingOffHeaders(relay: MailRelay | null, options: { sesConfigurationSet?: string | null } = {}): Record<string, string> {
  switch (relay) {
    case 'mailgun':
      return { 'X-Mailgun-Track': 'no', 'X-Mailgun-Track-Clicks': 'no', 'X-Mailgun-Track-Opens': 'no' };
    case 'sendgrid':
      return {
        'X-SMTPAPI': JSON.stringify({
          filters: {
            clicktrack: { settings: { enable: 0 } },
            opentrack: { settings: { enable: 0 } },
            subscriptiontrack: { settings: { enable: 0 } },
          },
        }),
      };
    case 'postmark':
      return { 'X-PM-TrackLinks': 'None', 'X-PM-KeepID': 'true' };
    case 'ses': {
      const set = options.sesConfigurationSet?.trim() ?? '';
      if (set === '') return {};
      if (!CONFIGURATION_SET.test(set)) throw new TrackingHeaderError('That is not an SES configuration set name.');
      return { 'X-SES-CONFIGURATION-SET': set };
    }
    case 'brevo':
    case null:
      return {};
  }
}
