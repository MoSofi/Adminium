// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHICH SENDER A MAIL GOES AS: the server's, or a workspace's.
 *
 * A workspace may have a sender of its own: a name, a From address, a
 * reply-to and a postal address (`adminium_workspaces.sender_*`). Kiln Street
 * Pottery's mail then goes as Kiln Street Pottery, with its own postal address
 * at the foot of its marketing mail, even on a server that also runs Fernhill
 * Coffee.
 *
 * ─── The rule ───────────────────────────────────────────────────────────────
 *  1. A template that names a sender ("Send as") goes as it: `server`, or a
 *     workspace (one with no sender of its own goes as the server). A
 *     workspace that is gone is as if none was named.
 *  2. Else mail about a record goes as the workspace its database is in; a
 *     database in several workspaces goes as the first by position.
 *  3. Else, a database in no workspace or a workspace with no sender of its
 *     own, the server's sender, as before workspaces.
 * Only the send paths that are about a record ask (automation steps, the
 * digest, the outbox, document delivery, campaigns, invoices and pay mail):
 * mail with no record (sign-in, invitations, notices) never asks, and goes as
 * the server.
 *
 * ─── The From must be one the server can send for ──────────────────────────
 * The relay, the DKIM keys and the DNS checks are the server's: a workspace's
 * From is at a domain of one of the server's senders (the SMTP From and the
 * senders list) or a domain it holds a DKIM key for, or is one of those
 * senders itself (an address at a public mailbox is never a whole domain).
 * The form refuses anything else, and a send asks again: a From the settings
 * no longer cover goes as the server, never as an address the relay may
 * refuse or a receiver may take for spoofing.
 *
 * ─── What stays the server's ───────────────────────────────────────────────
 * The do-not-email list: someone who opted out anywhere on the server gets no
 * marketing mail from any business on it (`consent/`, asked by every
 * marketing send whatever its sender).
 */
import { emailTemplatesRepo, settingsRepo, TEMPLATE_SEND_AS_SERVER, workspacesRepo, type MetaDb, type Workspace } from '@adminium/meta';

import { bareAddress } from './document.js';
import { PLAIN_DOTTED } from './plain-address.js';
import { domainOfAddress, isFreeMailDomain } from './sender/free-mail.js';

export { TEMPLATE_SEND_AS_SERVER };

/** What a send knows of whose mail it is. */
export interface SendAbout {
  /** The database the mail's record is in; null for mail about no record (a campaign to the server's own people). */
  connectionId?: string | null | undefined;
  /** The template it renders: its family's "Send as" is asked. */
  templateKey?: string | null | undefined;
  /** "Send as" as the caller already read it; asked by `templateKey` when absent. */
  sendAs?: string | null | undefined;
}

/** The sender a mail goes as. Every field null: the server's, as before workspaces. */
export interface MailSender {
  /** The workspace it goes as; null for the server. */
  workspace: { id: string; name: string } | null;
  /** The From header (`"Name" <address>`, or the address alone); null = the document's own, else the relay's. */
  from: string | null;
  /** The business the mail is from, as a marketing mail's footer names it. */
  name: string | null;
  /** Where a reply goes when the mail names no reply address of its own. */
  replyTo: string | null;
  /** The postal address a marketing mail prints; null = the server's. */
  postal: string | null;
}

export const SERVER_SENDER: MailSender = Object.freeze({ workspace: null, from: null, name: null, replyTo: null, postal: null });

/** Where a server may send from. */
export interface SendingDomains {
  /** Any address at these domains: its own senders' domains, and the domains it holds a DKIM key for. */
  domains: string[];
  /** These addresses one by one: each sender (one at a public mailbox included). */
  addresses: string[];
}

/** The server's senders, their domains and the domains it signs for. */
export async function sendingDomains(meta: MetaDb): Promise<SendingDomains> {
  const settings = settingsRepo(meta);
  const [smtp, senders] = await Promise.all([settings.get('email.smtp'), settings.get('email.senders')]);
  const addresses = new Set<string>();
  const domains = new Set<string>();
  for (const raw of [...(smtp === null ? [] : [smtp.from]), ...(senders ?? []).map((sender) => sender.address)]) {
    const address = bareAddress(raw);
    if (!PLAIN_DOTTED.test(address)) continue;
    addresses.add(address);
    const domain = domainOfAddress(address);
    if (domain !== null && !isFreeMailDomain(domain)) domains.add(domain);
  }
  // A key is only ever made for a sender's domain or a parent of one (`routes/mail-settings`).
  for (const row of await meta.db.selectFrom('adminium_email_dkim_keys').select('domain').execute()) {
    const domain = row.domain.trim().toLowerCase();
    if (domain !== '' && !isFreeMailDomain(domain)) domains.add(domain);
  }
  return { domains: [...domains].sort(), addresses: [...addresses].sort() };
}

/** Whether the server can send from `address`: one of its senders, or at a domain it sends for. */
export function maySendFrom(address: string, sending: SendingDomains): boolean {
  const bare = address.trim().toLowerCase();
  if (!PLAIN_DOTTED.test(bare)) return false;
  if (sending.addresses.includes(bare)) return true;
  const domain = domainOfAddress(bare);
  return domain !== null && !isFreeMailDomain(domain) && sending.domains.includes(domain);
}

/**
 * The From header for a name and an address. The name is quoted, with
 * anything that could end the quote or split the header taken out.
 */
export function fromHeader(name: string | null, address: string): string {
  // eslint-disable-next-line no-control-regex -- a header must hold no control character
  const clean = (name ?? '').replace(/[\u0000-\u001f\u007f"\\]/g, '').trim();
  return clean === '' ? address : `"${clean}" <${address}>`;
}

function senderOf(workspace: Workspace): MailSender {
  const from = workspace.sender.from!;
  return {
    workspace: { id: workspace.id, name: workspace.name },
    from: fromHeader(workspace.sender.name, from),
    name: workspace.sender.name,
    replyTo: workspace.sender.replyTo,
    postal: workspace.sender.postal,
  };
}

/** The sender a mail about `about` goes as (see the header). */
export async function resolveMailSender(meta: MetaDb, about: SendAbout): Promise<MailSender> {
  const sendAs =
    about.sendAs !== undefined
      ? about.sendAs
      : about.templateKey === undefined || about.templateKey === null || about.templateKey === ''
        ? null
        : await emailTemplatesRepo(meta).sendAsOf(about.templateKey);
  if (sendAs === TEMPLATE_SEND_AS_SERVER) return SERVER_SENDER;
  const workspaces = workspacesRepo(meta);
  let workspace = sendAs === null ? null : await workspaces.findById(sendAs);
  if (workspace === null && about.connectionId !== undefined && about.connectionId !== null) {
    const [first] = await workspaces.forConnection(about.connectionId);
    workspace = first === undefined ? null : await workspaces.findById(first);
  }
  if (workspace === null || workspace.sender.from === null) return SERVER_SENDER;
  // Asked again at each send: settings changed since the sender was saved never make a From the relay may refuse.
  if (!maySendFrom(workspace.sender.from, await sendingDomains(meta))) return SERVER_SENDER;
  return senderOf(workspace);
}

/**
 * Whose mail a campaign run is: a run to a table's people is about that
 * table's database; a run to the server's own people is about none.
 */
export function campaignAbout(run: { audience: unknown }, templateKey: string): SendAbout {
  const audience = run.audience as { kind?: unknown; connectionId?: unknown } | null;
  const connectionId = audience?.kind === 'table' && typeof audience.connectionId === 'string' ? audience.connectionId : null;
  return { connectionId, templateKey };
}
