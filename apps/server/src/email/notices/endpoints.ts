// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The notice endpoints' secrets: kept encrypted, read back only where they
 * are used.
 *
 * Each service's endpoint keeps a path token (always), and what proves its
 * calls: the credentials Adminium made (Postmark, Brevo, another service;
 * optionally Amazon SNS), Mailgun's signing key, SendGrid's verification key
 * (public), or the SNS topic. Secrets are encrypted under a key derived for
 * this purpose alone (`adminium:mail-notice:v1`), never a key another secret
 * uses.
 *
 * Nothing here logs. The plain values travel only in fields the log redacts by
 * name (`token`, `pass`, `secret`), and a stored secret that will not decrypt
 * (the server's `ADMINIUM_SECRET` changed) reads as "not set": the card asks
 * for it again, and the service's calls are answered 503 meanwhile, so the
 * service keeps them.
 */
import { emailNoticeEndpointsRepo, type MetaDb, type NoticeEndpointRow } from '@adminium/meta';
import { z } from 'zod';

import { decryptSecret, deriveKey, encryptSecret } from '../../config/secrets.js';
import { mintBasicCredentials, mintNoticeToken } from './common.js';
import { NOTICE_SECRET_ROW, isTopicArn, noticeAddress, sendgridKeyOf, type NoticeSecretRow } from './index.js';
import { NOTICE_SERVICES, type BasicCredentials, type NoticeEndpointConfig, type NoticeService } from './types.js';

/** The purpose the endpoints' key is derived for: its own. */
export const NOTICE_KEY_SALT = 'adminium:mail-notice:v1';

/** The longest signing key taken: Mailgun's are 32-character hex strings with a prefix. */
const SIGNING_KEY_MAX = 200;

/** What is kept encrypted: one of two shapes. */
const keptSecretSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('basic'), user: z.string().min(1), pass: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('signing-key'), secret: z.string().min(1) }).strict(),
]);
type KeptSecret = z.infer<typeof keptSecretSchema>;

export class NoticeEndpointError extends Error {
  override readonly name = 'NoticeEndpointError';
  constructor(
    readonly code: 'no-endpoint' | 'wrong-service' | 'invalid-signing-key' | 'invalid-verification-key' | 'invalid-topic',
    message: string,
  ) {
    super(message);
  }
}

/** What the bounce card shows: never a secret. */
export interface NoticeEndpointStatus {
  service: NoticeService;
  secretRow: NoticeSecretRow;
  /** Whether the service's calls can be checked: its key, topic or credentials are kept. */
  ready: boolean;
  /** The card's "Set on …". */
  secretSetAt: number | null;
  topicArn: string | null;
  /** Amazon SNS: when the subscription handshake was answered. */
  confirmedAt: number | null;
  lastNoticeAt: number | null;
  noticeCount: number;
}

/** What opening an endpoint gives back, once: the token, and the credentials when Adminium made some. */
export interface OpenedEndpoint {
  status: NoticeEndpointStatus;
  token: string;
  basic: BasicCredentials | null;
}

export interface NoticeEndpointsDeps {
  meta: MetaDb;
  /** `ADMINIUM_SECRET`. */
  secret: string;
  now?: () => number;
}

const isService = (value: string): value is NoticeService => (NOTICE_SERVICES as readonly string[]).includes(value);

/** Services whose calls are proved by credentials Adminium makes. */
const MADE_CREDENTIALS: ReadonlySet<NoticeService> = new Set(['postmark', 'brevo']);

export function createNoticeEndpoints(deps: NoticeEndpointsDeps) {
  const key = deriveKey(deps.secret, NOTICE_KEY_SALT);
  const now = deps.now ?? Date.now;
  const repo = emailNoticeEndpointsRepo(deps.meta, { encrypt: (plain) => encryptSecret(plain, key), decrypt: (token) => decryptSecret(token, key) });

  /** The kept secret, or null when there is none or it no longer decrypts. */
  async function keptOf(row: NoticeEndpointRow): Promise<KeptSecret | null> {
    if (!row.hasSecret) return null;
    try {
      const parsed = keptSecretSchema.safeParse(JSON.parse((await repo.secretOf(row.id)) ?? 'null'));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  async function statusOf(row: NoticeEndpointRow): Promise<NoticeEndpointStatus> {
    const service = row.service as NoticeService;
    const kept = await keptOf(row);
    const ready =
      service === 'ses'
        ? row.topicArn !== null
        : service === 'mailgun'
          ? kept?.kind === 'signing-key'
          : service === 'sendgrid'
            ? row.publicKey !== null
            : service === 'other'
              ? true
              : kept?.kind === 'basic';
    return {
      service,
      secretRow: NOTICE_SECRET_ROW[service],
      ready,
      secretSetAt: row.secretSetAt,
      topicArn: row.topicArn,
      confirmedAt: row.confirmedAt,
      lastNoticeAt: row.lastNoticeAt,
      noticeCount: row.noticeCount,
    };
  }

  async function rowFor(service: NoticeService): Promise<NoticeEndpointRow> {
    const row = await repo.byService(service);
    if (row === null) throw new NoticeEndpointError('no-endpoint', `There is no notice address for ${service} yet.`);
    return row;
  }

  function needs(service: NoticeService, allowed: NoticeService): void {
    if (service !== allowed) throw new NoticeEndpointError('wrong-service', `That is not something ${service} uses.`);
  }

  return {
    async status(service: NoticeService): Promise<NoticeEndpointStatus | null> {
      const row = await repo.byService(service);
      return row === null ? null : statusOf(row);
    },

    /**
     * Make the service's endpoint (a token, and for Postmark and Brevo the
     * credentials the owner copies into them). Null when it already has one:
     * its address and credentials are read with `addressOf` and `credentialsOf`.
     */
    async open(service: NoticeService, input: { createdBy?: string | null; basic?: boolean } = {}): Promise<OpenedEndpoint | null> {
      const token = mintNoticeToken();
      const basic = MADE_CREDENTIALS.has(service) || input.basic === true ? mintBasicCredentials(service) : null;
      const secret = basic === null ? null : JSON.stringify({ kind: 'basic', ...basic } satisfies KeptSecret);
      const row = await repo.create({ service, token, secret, createdBy: input.createdBy ?? null }, now());
      return row === null ? null : { status: await statusOf(row), token, basic };
    },

    /** The address to paste into the service, or null when it has none (or the token no longer decrypts). */
    async addressOf(service: NoticeService, origin: string): Promise<string | null> {
      const row = await repo.byService(service);
      if (row === null) return null;
      try {
        const token = await repo.tokenOf(row.id);
        return token === null ? null : noticeAddress(origin, service, token);
      } catch {
        return null;
      }
    },

    /** The credentials Adminium made for the service, to copy into it; null when it has none. */
    async credentialsOf(service: NoticeService): Promise<BasicCredentials | null> {
      const row = await repo.byService(service);
      const kept = row === null ? null : await keptOf(row);
      return kept?.kind === 'basic' ? { user: kept.user, pass: kept.pass } : null;
    },

    /** A new address: the old one stops working at once. */
    async replaceToken(service: NoticeService): Promise<string> {
      const row = await rowFor(service);
      const token = mintNoticeToken();
      await repo.replaceToken(row.id, token, now());
      return token;
    },

    /** New credentials: the old ones stop working at once. */
    async replaceCredentials(service: NoticeService): Promise<BasicCredentials> {
      const row = await rowFor(service);
      const basic = mintBasicCredentials(service);
      await repo.setSecret(row.id, JSON.stringify({ kind: 'basic', ...basic } satisfies KeptSecret), now());
      return basic;
    },

    /** Mailgun: the webhook signing key the owner pasted. */
    async setSigningKey(service: NoticeService, signingKey: string): Promise<void> {
      needs(service, 'mailgun');
      const clean = signingKey.trim();
      if (clean.length === 0 || clean.length > SIGNING_KEY_MAX || /\s/.test(clean)) throw new NoticeEndpointError('invalid-signing-key', 'That is not a signing key.');
      const row = await rowFor(service);
      await repo.setSecret(row.id, JSON.stringify({ kind: 'signing-key', secret: clean } satisfies KeptSecret), now());
    },

    /** SendGrid: the public verification key the owner pasted. */
    async setVerificationKey(service: NoticeService, verificationKey: string): Promise<void> {
      needs(service, 'sendgrid');
      if (sendgridKeyOf(verificationKey) === null) throw new NoticeEndpointError('invalid-verification-key', 'That is not a SendGrid verification key.');
      const row = await rowFor(service);
      await repo.setPublicKey(row.id, verificationKey.trim(), now());
    },

    /** Amazon SNS: the topic the owner named. */
    async setTopicArn(service: NoticeService, topicArn: string): Promise<void> {
      needs(service, 'ses');
      const clean = topicArn.trim();
      if (!isTopicArn(clean)) throw new NoticeEndpointError('invalid-topic', 'That is not an Amazon SNS topic ARN.');
      const row = await rowFor(service);
      await repo.setTopicArn(row.id, clean, now());
    },

    /** What a reader needs for a call to `…/<service>/<token>`; null when the token names no endpoint of that service. */
    async configFor(service: string, token: string): Promise<(NoticeEndpointConfig & { id: string }) | null> {
      if (!isService(service)) return null;
      const row = await repo.byToken(token);
      if (row === null || row.service !== service) return null;
      const kept = await keptOf(row);
      return {
        id: row.id,
        service,
        tokenHash: row.tokenHash,
        basic: kept?.kind === 'basic' ? { user: kept.user, pass: kept.pass } : null,
        signingKey: kept?.kind === 'signing-key' ? kept.secret : null,
        verificationKey: row.publicKey,
        topicArn: row.topicArn,
      };
    },

    /** A genuine notice arrived. */
    noticed: (id: string) => repo.noticed(id, now()),
    /** Amazon SNS's handshake was answered. */
    confirmed: (id: string) => repo.confirm(id, now()),

    async remove(service: NoticeService): Promise<boolean> {
      const row = await repo.byService(service);
      return row === null ? false : repo.remove(row.id);
    },
  };
}

export type NoticeEndpoints = ReturnType<typeof createNoticeEndpoints>;
