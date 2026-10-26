// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The shapes every mail service's notice reader shares.
 *
 * A mail service tells Adminium, after the fact, that a mail bounced, was
 * marked as spam, or that its reader unsubscribed through the service's own
 * link. Each service proves its call its own way (a certificate, an HMAC, an
 * ECDSA key, or nothing at all), so each has a reader of its own. They all
 * take the same input and give the same answer:
 *
 *   - in: the raw body bytes, the headers, the token from the address, and
 *     what is kept for the service's endpoint;
 *   - out: not genuine, with why; or genuine, with the events it carried.
 *
 * A reader never writes anything. The route that calls it writes the events
 * (only the permanent ones go on the do-not-email list) and answers the
 * service: see `noticeAnswer`.
 */

/** The services the bounce card offers, by the key that ends their address. */
export const NOTICE_SERVICES = ['ses', 'postmark', 'mailgun', 'brevo', 'sendgrid', 'other'] as const;
export type NoticeService = (typeof NOTICE_SERVICES)[number];

export type NoticeEventKind = 'bounce' | 'complaint' | 'unsubscribe';

/** One thing a service reported about one address. */
export interface NoticeEvent {
  /** Trimmed and in lower case, as every door of Adminium compares an address. */
  address: string;
  kind: NoticeEventKind;
  /**
   * True when the address should never be mailed again: a hard bounce, a spam
   * report, an unsubscribe. A soft bounce (a full mailbox, an out-of-office
   * reply) is false and stays off the list.
   */
  permanent: boolean;
  /** The service's own id for the event, when it gives one. */
  relayEventId: string | null;
  /** When the service says it happened (epoch ms), when it says. */
  at: number | null;
}

/** Why a call was not taken as genuine. */
export type NoticeRefusal =
  /** The token in the address names no endpoint of this service. */
  | 'wrong-token'
  /** The user name and password the call carried are not the ones Adminium made. */
  | 'wrong-credentials'
  /** The endpoint has nothing to check this service's calls with yet (no signing key, no verification key, no topic). */
  | 'not-set-up'
  /** The body is not the shape the service sends. */
  | 'malformed'
  /** The signature does not verify. */
  | 'bad-signature'
  /** The call's own time is too far from now. */
  | 'stale'
  /** A call already taken, sent again. */
  | 'replay'
  /** Amazon SNS: a topic other than the one pinned. */
  | 'wrong-topic'
  /** Amazon SNS: a certificate or subscribe address on a host that is not the topic region's SNS host. */
  | 'wrong-host'
  /** Amazon SNS: the signing certificate could not be fetched or read. */
  | 'certificate-unavailable'
  /** Amazon SNS: the subscribe address could not be fetched. */
  | 'handshake-failed';

/** What a genuine call asks of the route beyond its events. */
export type NoticeReply =
  /** Amazon SNS's handshake was answered: the endpoint is confirmed. */
  | { kind: 'subscription-confirmed' }
  /** Amazon SNS says the subscription was removed at its end. */
  | { kind: 'unsubscribed' };

export type NoticeVerdict = { genuine: false; why: NoticeRefusal } | { genuine: true; events: NoticeEvent[]; reply?: NoticeReply };

/** A call as the route received it. */
export interface NoticeRequest {
  /** The exact bytes received: SendGrid signs them. */
  body: Buffer;
  /** As Node gives them: names in lower case. */
  headers: Readonly<Record<string, string | string[] | undefined>>;
  /** The token from the address (`…/notices/<service>/<token>`). */
  pathToken: string;
}

/** The user name and password Adminium made for a service that signs nothing. */
export interface BasicCredentials {
  user: string;
  pass: string;
}

/** What is kept for one service's endpoint, decrypted for the reader. */
export interface NoticeEndpointConfig {
  service: NoticeService;
  /** sha256 hex of the path token (`noticeTokenHash`). */
  tokenHash: string;
  /** Postmark, Brevo, another service, or (optionally) Amazon SNS: the credentials the call must carry. */
  basic: BasicCredentials | null;
  /** Mailgun: the account's webhook signing key. */
  signingKey: string | null;
  /** SendGrid: the public verification key (base64 of its DER, or PEM). */
  verificationKey: string | null;
  /** Amazon SNS: the topic the owner named. */
  topicArn: string | null;
}

/** Remembers the calls already taken, for as long as a replay could still pass the time check. */
export interface ReplayGuard {
  /** True the first time a key is seen (and keeps it until `until`); false for a key already kept. */
  claim(key: string, until: number): boolean;
  /** Forget a key: the work its call started failed, and the service's retry must be taken. */
  release(key: string): void;
}

/** A GET to an address on Amazon's SNS host: the certificate, or the subscribe address. */
export type SnsFetch = (url: string) => Promise<Buffer>;
