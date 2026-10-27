// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A PERMANENT REFUSAL AT SEND TIME: the mail server said, while the message
 * was being handed to it, that the address does not take mail.
 *
 * nodemailer keeps the server's answer on the error it throws: `responseCode`
 * (550), `command` (the step that was refused) and `response` (the line).
 * Only a 5xx to `RCPT TO`, or after `DATA` (where some servers refuse a
 * recipient at the end instead), that names the MAILBOX is read as "this
 * address does not take mail":
 *   - with an enhanced status code (RFC 3463, right after the reply code:
 *     `550 5.1.1 …`): an address status `5.1.x` (no such mailbox, no such
 *     domain, a bad address, moved), except `5.1.7` and `5.1.8`, which are
 *     about the SENDER's address; and `5.2.1` (the mailbox is disabled).
 *     Any other class says nothing about the address: `5.7.x` is a policy
 *     (relaying denied, SPF or DMARC failed, the sender is blocked), `5.2.2`
 *     a full mailbox, `5.3.x`/`5.4.x` the receiving system or the network,
 *     `5.5.x` the protocol, `5.6.x` the message;
 *   - with none (an old server), at `RCPT TO` only, and only a 550, 551 or
 *     553 whose words say the user or mailbox is unknown ("User unknown",
 *     "No such user", "does not exist"). RFC 5321's own text for 550,
 *     "mailbox unavailable", is not enough: the same words cover "no
 *     access" and "rejected for policy reasons", and 553 is also qmail's
 *     "domain isn't in my list of allowed rcpthosts", a relay refusal.
 * A relay that will not relay refuses EVERY recipient at `RCPT TO` (`554
 * 5.7.1 Relay access denied`): read as the address, that would stop every
 * contact for good on one misconfiguration. A 5xx anywhere else is about the
 * sender, the login or the message (a refused From, a wrong password, a body
 * the server will not take); a 4xx is a "try again later". None of these
 * puts anybody on the do-not-email list.
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

/** The enhanced status code right after the reply code (`550 5.1.1 …`, `550-5.1.1 …`), as [class, subject, detail]; null when there is none. */
export function enhancedStatus(line: string): [number, number, number] | null {
  const found = /^\s*\d{3}[ -]#?([245])\.(\d{1,3})\.(\d{1,3})(?=[\s:;,.)]|$)/.exec(line);
  return found === null ? null : [Number(found[1]), Number(found[2]), Number(found[3])];
}

/** An enhanced status that says the recipient's mailbox takes no mail (see the header). */
function mailboxStatus([klass, subject, detail]: [number, number, number]): boolean {
  if (klass !== 5) return false;
  if (subject === 1) return detail !== 7 && detail !== 8;
  return subject === 2 && detail === 1;
}

/** An old server's words for "no such user or mailbox", with no enhanced code (see the header). */
const UNKNOWN_MAILBOX = /\b(?:user|mailbox|recipient|address|account)\b[^.\n]{0,40}\b(?:unknown|not found|does not exist|doesn['’]t exist|not exist|no longer exists)\b|\b(?:unknown|no such|invalid) (?:user|mailbox|recipient|account)\b/i;

/** A 5xx that says the address takes no mail; null for anything else (a 4xx, a refused sender, a policy, a lost connection). */
export function permanentRefusal(error: unknown): PermanentRefusal | null {
  if (typeof error !== 'object' || error === null) return null;
  const { responseCode, command, response } = error as { responseCode?: unknown; command?: unknown; response?: unknown };
  if (typeof responseCode !== 'number' || responseCode < 500 || responseCode > 599) return null;
  const line = typeof response === 'string' ? response : '';
  const step = typeof command === 'string' ? command.toUpperCase() : '';
  const rcpt = step.startsWith('RCPT');
  if (!rcpt && step !== 'DATA') return null;
  const status = enhancedStatus(line);
  const toAddress = status !== null ? mailboxStatus(status) : rcpt && [550, 551, 553].includes(responseCode) && UNKNOWN_MAILBOX.test(line);
  if (!toAddress) return null;
  return { code: responseCode, response: line.slice(0, 300) };
}

/** Whether the SMTP host is a direct relay, whose refusal at send time is believed (see the header). */
export function isDirectRelay(smtpHost: string): boolean {
  return relayOf(smtpHost) === null;
}
