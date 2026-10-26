// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A PERMANENT REFUSAL AT SEND TIME: the mail server said, while the message
 * was being handed to it, that the address does not take mail.
 *
 * nodemailer keeps the server's answer on the error it throws: `responseCode`
 * (550), `command` (the step that was refused) and `response` (the line).
 * Only two answers are read as "this address does not take mail":
 *   - a 5xx to `RCPT TO`: the server refused the recipient itself;
 *   - a 5xx after `DATA` whose enhanced status says the mailbox is bad
 *     (`5.1.x`, RFC 3463), which some servers give at the end instead.
 * A 5xx anywhere else is about the sender, the login or the message (a
 * refused From, a wrong password, a body the server will not take) and says
 * nothing about the address; a 4xx is a "try again later". Neither puts
 * anybody on the do-not-email list.
 *
 * The large mail services (SES, Postmark, Mailgun, Brevo, SendGrid) take
 * every message at SMTP and report a bounce later through their notices. A
 * 5xx from one of them at send time is far more often about the account (an
 * unverified sender, a sending pause) than the address, so only a direct
 * relay (the owner's own server, any other host) is believed
 * ({@link isDirectRelay}).
 */
import { relayOf } from './sender/relay.js';

/** What the server said when it refused the address for good. */
export interface PermanentRefusal {
  code: number;
  /** The server's line, cut to a length a log keeps. */
  response: string;
}

/** A 5xx that says the address takes no mail; null for anything else (a 4xx, a refused sender, a lost connection). */
export function permanentRefusal(error: unknown): PermanentRefusal | null {
  if (typeof error !== 'object' || error === null) return null;
  const { responseCode, command, response } = error as { responseCode?: unknown; command?: unknown; response?: unknown };
  if (typeof responseCode !== 'number' || responseCode < 500 || responseCode > 599) return null;
  const line = typeof response === 'string' ? response : '';
  const step = typeof command === 'string' ? command.toUpperCase() : '';
  const toAddress = step.startsWith('RCPT') || (step === 'DATA' && /\b5\.1\.\d{1,3}\b/.test(line));
  if (!toAddress) return null;
  return { code: responseCode, response: line.slice(0, 300) };
}

/** Whether the SMTP host is a direct relay, whose refusal at send time is believed (see the header). */
export function isDirectRelay(smtpHost: string): boolean {
  return relayOf(smtpHost) === null;
}
