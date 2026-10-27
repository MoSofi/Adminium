// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The marketing mail settings' bodies and replies (`routes/mail-settings/index.ts`).
 *
 * No reply here carries a private key, a pasted signing key or a password:
 * the DNS record of a DKIM key (its public half), the address a mail service
 * calls, and when a secret was set. The one exception is the user name and
 * password Adminium makes for Postmark and Brevo, which the owner copies into
 * them: they are in the reply that makes them, once, and never again.
 */
import { z } from 'zod';

import { MARKETING_REFUSALS } from '../../email/sender/refusals.js';
import { NOTICE_SERVICES } from '../../email/notices/types.js';

const dnsRecord = z.object({ name: z.string(), type: z.literal('TXT'), value: z.string(), text: z.string() });

/** Adminium's DKIM key for a sending domain, as the screen shows it: its DNS record. */
export const dkimKeyView = z.object({
  domain: z.string(),
  selector: z.string(),
  record: dnsRecord,
  createdAt: z.number(),
  /** False when the key no longer opens (the server's secret changed): "Make a key" makes a new one. */
  usable: z.boolean(),
});

const senderView = z.object({
  address: z.string(),
  name: z.string().nullable(),
  /** The SMTP From address, which every mail may use and which is not a row of the senders list. */
  implicit: z.boolean(),
  /** The address's domain; null when it has none. */
  domain: z.string().nullable(),
  /** At a public mailbox (gmail.com, …): marketing mail can never go from it. */
  freeMail: z.boolean(),
  /** Adminium's key that signs mail from it (its domain's, or a parent's); null when there is none. */
  key: dkimKeyView.nullable(),
});

export const marketingReply = z.object({
  data: z.object({
    postalAddress: z.string().nullable(),
    replyTo: z.string().nullable(),
    publicOrigin: z.string().nullable(),
    senders: z.array(senderView),
  }),
});

export const senderCheckBody = z.object({ address: z.string().trim().min(3).max(320) });

export const senderCheckReply = z.object({
  data: z.object({
    /** DMARC at the sender's domain; `unchecked` when DNS could not be asked; null for a public mailbox. */
    dmarc: z.union([z.object({ policy: z.enum(['none', 'quarantine', 'reject']).nullable(), recordDomain: z.string().nullable() }), z.literal('unchecked')]).nullable(),
    /** Whether DNS publishes Adminium's key; null when there is no key. */
    dkim: z.enum(['found', 'other-key', 'not-found', 'unchecked']).nullable(),
    /** What a marketing send from it meets now, in the send dialog's order. */
    refusals: z.array(z.enum(MARKETING_REFUSALS)),
  }),
});

export const makeKeyBody = z.object({ domain: z.string().trim().min(1).max(253) });
export const makeKeyReply = z.object({ data: z.object({ key: dkimKeyView }) });

export const replyToBody = z.object({ replyTo: z.string().trim().max(254).nullable() });
export const replyToReply = z.object({ data: z.object({ replyTo: z.string().nullable() }) });

export const noticeServiceParams = z.object({ service: z.enum(NOTICE_SERVICES) });

const endpointView = z.object({
  service: z.enum(NOTICE_SERVICES),
  /** Whether the service has its notice address yet. */
  opened: z.boolean(),
  /** What the card's secret row asks for. */
  secretRow: z.enum(['signing-key', 'verification-key', 'topic-arn', 'copy-credentials']),
  /** Whether the service's calls can be checked: its key, topic or credentials are kept. */
  ready: z.boolean(),
  /** "Set on …": when the key, topic or credentials were saved. */
  secretSetAt: z.number().nullable(),
  /** Amazon SNS: when the subscription handshake was answered. */
  confirmedAt: z.number().nullable(),
  lastNoticeAt: z.number().nullable(),
  noticeCount: z.number(),
  /** The address to paste into the service; null until it is made, or while this server has no public address. */
  address: z.string().nullable(),
});

export const endpointsReply = z.object({
  data: z.object({
    publicOrigin: z.string().nullable(),
    /** The service the SMTP host belongs to, when it is one of the five. */
    suggested: z.enum(NOTICE_SERVICES).nullable(),
    services: z.array(endpointView),
  }),
});

const credentials = z.object({ user: z.string(), pass: z.string() });

/** Making an endpoint, or new credentials for it: the credentials are here once, and never read back. */
export const endpointMadeReply = z.object({ data: z.object({ endpoint: endpointView, credentials: credentials.nullable() }) });

/** Named `secret` so the request log redacts it by name. */
export const endpointSecretBody = z.object({ secret: z.string().trim().min(1).max(2048) });
export const endpointReply = z.object({ data: z.object({ endpoint: endpointView }) });

export type EndpointView = z.infer<typeof endpointView>;
export type DkimKeyReply = z.infer<typeof dkimKeyView>;
