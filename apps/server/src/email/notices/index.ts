// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The mail services' notice readers, behind one door.
 *
 * `createNoticeReader` gives `read(request, endpoint)`: it hands the call to
 * the reader of the endpoint's service and gives back its verdict. The route
 * that receives the call (`/api/v1/email/notices/<service>/<token>`) finds
 * the endpoint by the token, reads, writes the permanent events to the
 * do-not-email list, counts the notice, and answers with `noticeAnswer`.
 */
import { safeFetch } from '../../net/safe-fetch.js';
import { readBrevo } from './brevo.js';
import { readMailgun } from './mailgun.js';
import { readOther } from './other.js';
import { readPostmark } from './postmark.js';
import { createReplayGuard } from './replay.js';
import { readSendgrid } from './sendgrid.js';
import { readSes } from './ses.js';
import type { NoticeEndpointConfig, NoticeRequest, NoticeService, NoticeVerdict, ReplayGuard, SnsFetch } from './types.js';

export * from './types.js';
export { mintBasicCredentials, mintNoticeToken } from './common.js';
export { isTopicArn, regionOfTopic } from './ses.js';
export { sendgridKeyOf } from './sendgrid.js';
export { createReplayGuard } from './replay.js';

/** Where the notice routes live; the service and the token follow. */
export const NOTICE_PATH_PREFIX = '/api/v1/email/notices';

/** The address the owner pastes into the service. */
export function noticeAddress(origin: string, service: NoticeService, token: string): string {
  return `${origin.replace(/\/+$/, '')}${NOTICE_PATH_PREFIX}/${service}/${token}`;
}

/**
 * What the bounce card's secret row asks for, per service (the card keeps its
 * layout; its words change):
 *   - `signing-key`: Mailgun's webhook signing key, pasted;
 *   - `verification-key`: SendGrid's public verification key, pasted;
 *   - `topic-arn`: the Amazon SNS topic, typed;
 *   - `copy-credentials`: the user name and password Adminium made, copied INTO the service.
 */
export type NoticeSecretRow = 'signing-key' | 'verification-key' | 'topic-arn' | 'copy-credentials';

export const NOTICE_SECRET_ROW: Readonly<Record<NoticeService, NoticeSecretRow>> = {
  ses: 'topic-arn',
  postmark: 'copy-credentials',
  brevo: 'copy-credentials',
  mailgun: 'signing-key',
  sendgrid: 'verification-key',
  other: 'copy-credentials',
};

/** The most bytes read of a certificate or a subscribe answer from SNS. */
const SNS_FETCH_MAX_BYTES = 64 * 1024;

/** A GET to SNS through `safeFetch`: https, port 443, a public address, and no redirect followed. */
export const defaultSnsFetch: SnsFetch = async (url) => (await safeFetch(url, { maxBytes: SNS_FETCH_MAX_BYTES, timeoutMs: 10_000, maxRedirects: 0 })).body;

export interface NoticeReaderDeps {
  now?: () => number;
  replays?: ReplayGuard;
  /** Test seam: the GET to Amazon SNS. */
  snsFetch?: SnsFetch;
}

export interface NoticeReader {
  read(request: NoticeRequest, endpoint: NoticeEndpointConfig): Promise<NoticeVerdict>;
}

export function createNoticeReader(deps: NoticeReaderDeps = {}): NoticeReader {
  const now = deps.now ?? Date.now;
  const replays = deps.replays ?? createReplayGuard({ now });
  const sns = { now, replays, fetch: deps.snsFetch ?? defaultSnsFetch, certificates: new Map() };
  return {
    async read(request, endpoint) {
      switch (endpoint.service) {
        case 'ses':
          return readSes(request, endpoint, sns);
        case 'postmark':
          return readPostmark(request, endpoint);
        case 'brevo':
          return readBrevo(request, endpoint);
        case 'mailgun':
          return readMailgun(request, endpoint, { now, replays });
        case 'sendgrid':
          return readSendgrid(request, endpoint, { now, replays });
        case 'other':
          return readOther(request, endpoint);
      }
    },
  };
}

/**
 * The status the route answers with:
 *   - 200 for a genuine call, and for a replay (already taken: a 2xx stops the
 *     service sending it again);
 *   - 503 when the fault is on this side or passing (no key saved yet, the
 *     certificate or the handshake could not be fetched): the service keeps
 *     the call and tries again;
 *   - 401 for wrong credentials or a wrong token, 403 for a bad signature, a
 *     wrong topic or host, or a stale call; 400 for a body that is not the
 *     service's shape.
 */
export function noticeAnswer(verdict: NoticeVerdict): 200 | 400 | 401 | 403 | 503 {
  if (verdict.genuine) return 200;
  switch (verdict.why) {
    case 'replay':
      return 200;
    case 'not-set-up':
    case 'certificate-unavailable':
    case 'handshake-failed':
      return 503;
    case 'wrong-token':
    case 'wrong-credentials':
      return 401;
    case 'malformed':
      return 400;
    case 'bad-signature':
    case 'stale':
    case 'wrong-topic':
    case 'wrong-host':
      return 403;
  }
}
