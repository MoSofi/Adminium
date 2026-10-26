// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Amazon SES, through Amazon SNS.
 *
 * SES tells an SNS topic of each bounce and complaint, and SNS calls this
 * server with a signed message (https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html).
 * Nothing is pasted from Amazon: the owner names the topic (its ARN), and the
 * signature is checked with Amazon's certificate.
 *
 * ─── The order of the checks, and why ──────────────────────────────────────
 * Two addresses arrive INSIDE the body: the signing certificate's
 * (`SigningCertURL`) and, on the first call, the subscribe address
 * (`SubscribeURL`). A forged body could name any host. So, before anything is
 * fetched:
 *   1. the path token (and the basic credentials, when some are kept);
 *   2. the topic is the pinned one;
 *   3. BOTH addresses are on `sns.<region>.amazonaws.com`, the region being the
 *      pinned topic's own, https, port 443, nothing else in the authority;
 *   4. the message's time is inside the window.
 * Only then is the certificate fetched (through `safeFetch`, no redirects)
 * and the signature checked; only after that is the call claimed against a
 * replay, and only after THAT is the subscribe address fetched: once per
 * confirmation message.
 *
 * The body is `text/plain` holding JSON; the SES notice is JSON again inside
 * `Message`. One notice may name several recipients. Only a `Permanent`
 * bounce is permanent: SES reports an out-of-office reply as a `Transient`
 * bounce (https://docs.aws.amazon.com/ses/latest/dg/notification-contents.html).
 *
 * The China partition (`*.amazonaws.com.cn`) is not taken: its host pattern
 * is unconfirmed.
 */
import { X509Certificate, createVerify } from 'node:crypto';

import { basicMatches, eventOf, headerOf, isRecord, isoTime, jsonOf, textOf, tokenMatches } from './common.js';
import type { NoticeEndpointConfig, NoticeEvent, NoticeRequest, NoticeVerdict, ReplayGuard, SnsFetch } from './types.js';

/** How far a message's own time may be from now. SNS's default policy retries 3 times, 20 s apart. */
export const SNS_WINDOW_MS = 60 * 60 * 1000;
/** How far ahead of this server's clock a message may be dated. */
const FUTURE_SLACK_MS = 5 * 60 * 1000;
/** How long a fetched certificate is used before it is fetched again. */
const CERT_KEEP_MS = 24 * 60 * 60 * 1000;
const CERT_CACHE_MAX = 32;

/** `arn:aws:sns:<region>:<12-digit account>:<topic name>`. */
const TOPIC_ARN = /^arn:aws:sns:([a-z]{2}(?:-[a-z]+)+-\d):(\d{12}):([A-Za-z0-9_-]{1,256}(?:\.fifo)?)$/;

/** The region of a topic ARN, or null when it is not one. */
export function regionOfTopic(arn: string): string | null {
  return TOPIC_ARN.exec(arn)?.[1] ?? null;
}

export function isTopicArn(arn: string): boolean {
  return TOPIC_ARN.test(arn);
}

/** Whether an address is on the SNS host of `region`: https, the standard port, no credentials. */
export function isSnsAddress(raw: string, region: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && (url.port === '' || url.port === '443') && url.username === '' && url.password === '' && url.hostname === `sns.${region}.amazonaws.com`;
}

export interface SesReaderDeps {
  now: () => number;
  replays: ReplayGuard;
  fetch: SnsFetch;
  /** Certificates already fetched, by address. */
  certificates?: Map<string, { cert: X509Certificate; until: number }>;
}

const NOTIFICATION_FIELDS = ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'] as const;
const CONFIRMATION_FIELDS = ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'] as const;

/** The text SNS signs: each field's name and value on lines of their own, in this order; `Subject` only when present. */
export function snsStringToSign(message: Record<string, unknown>): string | null {
  const type = message['Type'];
  const fields = type === 'Notification' ? NOTIFICATION_FIELDS : type === 'SubscriptionConfirmation' || type === 'UnsubscribeConfirmation' ? CONFIRMATION_FIELDS : null;
  if (fields === null) return null;
  let out = '';
  for (const field of fields) {
    const value = message[field];
    if (value === undefined || value === null) {
      if (field === 'Subject') continue;
      return null;
    }
    if (typeof value !== 'string') return null;
    out += `${field}\n${value}\n`;
  }
  return out;
}

async function certificateOf(url: string, deps: SesReaderDeps): Promise<X509Certificate | null> {
  const now = deps.now();
  const kept = deps.certificates?.get(url);
  if (kept !== undefined && kept.until > now) return kept.cert;
  let cert: X509Certificate;
  try {
    cert = new X509Certificate(await deps.fetch(url));
  } catch {
    return null;
  }
  // A certificate outside its own dates is not used, whoever signed it.
  if (Date.parse(cert.validFrom) > now || Date.parse(cert.validTo) < now) return null;
  if (deps.certificates !== undefined) {
    if (deps.certificates.size >= CERT_CACHE_MAX) deps.certificates.clear();
    deps.certificates.set(url, { cert, until: now + CERT_KEEP_MS });
  }
  return cert;
}

/** The events of one SES notice (the JSON inside `Message`). */
export function sesEvents(notice: unknown, messageId: string | null): NoticeEvent[] {
  if (!isRecord(notice)) return [];
  const type = textOf(notice['notificationType']) ?? textOf(notice['eventType']);
  if (type === 'Bounce' && isRecord(notice['bounce'])) {
    const bounce = notice['bounce'];
    const permanent = bounce['bounceType'] === 'Permanent';
    const id = textOf(bounce['feedbackId']) ?? messageId;
    const at = isoTime(bounce['timestamp']);
    const recipients = Array.isArray(bounce['bouncedRecipients']) ? bounce['bouncedRecipients'] : [];
    return recipients.flatMap((recipient) => (isRecord(recipient) ? eventOf(recipient['emailAddress'], 'bounce', permanent, id, at) : []));
  }
  if (type === 'Complaint' && isRecord(notice['complaint'])) {
    const complaint = notice['complaint'];
    // A recipient's "not spam" feedback is not a complaint.
    if (complaint['complaintFeedbackType'] === 'not-spam') return [];
    const id = textOf(complaint['feedbackId']) ?? messageId;
    const at = isoTime(complaint['timestamp']);
    const recipients = Array.isArray(complaint['complainedRecipients']) ? complaint['complainedRecipients'] : [];
    return recipients.flatMap((recipient) => (isRecord(recipient) ? eventOf(recipient['emailAddress'], 'complaint', true, id, at) : []));
  }
  // Deliveries, sends, opens, delays: nothing for the list.
  return [];
}

export async function readSes(request: NoticeRequest, endpoint: NoticeEndpointConfig, deps: SesReaderDeps): Promise<NoticeVerdict> {
  if (!tokenMatches(endpoint, request.pathToken)) return { genuine: false, why: 'wrong-token' };
  if (endpoint.basic !== null && !basicMatches(request, endpoint.basic)) return { genuine: false, why: 'wrong-credentials' };
  const pinned = endpoint.topicArn;
  const region = pinned === null ? null : regionOfTopic(pinned);
  if (pinned === null || region === null) return { genuine: false, why: 'not-set-up' };

  const message = jsonOf(request.body);
  if (!isRecord(message)) return { genuine: false, why: 'malformed' };
  const type = message['Type'];
  const declared = headerOf(request, 'x-amz-sns-message-type');
  if (declared !== null && declared !== type) return { genuine: false, why: 'malformed' };
  const toSign = snsStringToSign(message);
  const signature = message['Signature'];
  const version = message['SignatureVersion'];
  const certUrl = message['SigningCertURL'];
  if (toSign === null || typeof signature !== 'string' || (version !== '1' && version !== '2') || typeof certUrl !== 'string') return { genuine: false, why: 'malformed' };

  if (message['TopicArn'] !== pinned) return { genuine: false, why: 'wrong-topic' };
  const confirming = type === 'SubscriptionConfirmation';
  const subscribeUrl = confirming ? message['SubscribeURL'] : null;
  if (!isSnsAddress(certUrl, region) || !new URL(certUrl).pathname.endsWith('.pem')) return { genuine: false, why: 'wrong-host' };
  if (confirming && (typeof subscribeUrl !== 'string' || !isSnsAddress(subscribeUrl, region))) return { genuine: false, why: 'wrong-host' };

  const now = deps.now();
  const at = isoTime(message['Timestamp']);
  if (at === null || now - at > SNS_WINDOW_MS || at - now > FUTURE_SLACK_MS) return { genuine: false, why: 'stale' };

  const cert = await certificateOf(certUrl, deps);
  if (cert === null) return { genuine: false, why: 'certificate-unavailable' };
  let verified = false;
  try {
    verified = createVerify(version === '1' ? 'RSA-SHA1' : 'RSA-SHA256')
      .update(toSign, 'utf8')
      .verify(cert.publicKey, signature, 'base64');
  } catch {
    verified = false;
  }
  if (!verified) return { genuine: false, why: 'bad-signature' };

  const messageId = textOf(message['MessageId']);
  const replayKey = `ses:${messageId ?? signature}`;
  if (!deps.replays.claim(replayKey, at + SNS_WINDOW_MS + FUTURE_SLACK_MS)) return { genuine: false, why: 'replay' };

  if (confirming) {
    try {
      await deps.fetch(subscribeUrl as string);
    } catch {
      // Not answered: SNS's next try (or the owner's "Request confirmation") must be taken.
      deps.replays.release(replayKey);
      return { genuine: false, why: 'handshake-failed' };
    }
    return { genuine: true, events: [], reply: { kind: 'subscription-confirmed' } };
  }
  if (type === 'UnsubscribeConfirmation') return { genuine: true, events: [], reply: { kind: 'unsubscribed' } };

  const notice = typeof message['Message'] === 'string' ? jsonOf(Buffer.from(message['Message'], 'utf8')) : undefined;
  return { genuine: true, events: sesEvents(notice, messageId) };
}
