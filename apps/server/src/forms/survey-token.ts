// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A NAMED SURVEY'S ONE-USE TOKEN: what an invitation's link carries
 * (`/x/forms/<slug>?t=<token>`), made when the invitation's mail goes.
 *
 * The token is 32 url-safe characters (24 random bytes). The invitation keeps
 * only its hash (`token_hash`, 64 hex characters): the link is sealed into
 * the mail's envelope with the rest of the message and is never stored in
 * clear, never logged. The door finds an invitation by hashing the `t` it is
 * given the same way, so a stolen copy of the invitations table opens no
 * survey.
 *
 * Plain SHA-256, not a keyed hash: the token is random and long, so nobody
 * finds one from its hash, and a change of the server's secret leaves every
 * link that was sent working.
 */
import { createHash, randomBytes } from 'node:crypto';

/** How many characters a token has. */
export const SURVEY_TOKEN_LENGTH = 32;

/** A token as a link carries it: url-safe letters, digits, `-` and `_`. */
export const SURVEY_TOKEN = /^[A-Za-z0-9_-]{32}$/;

/** A new token, for one invitation's mail. */
export function mintSurveyToken(): string {
  return randomBytes(24).toString('base64url');
}

/** What the invitation keeps of a token: its SHA-256, in lower-case hex. */
export function surveyTokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** A survey's address on this server: `{origin}/x/forms/<slug>`, with the token when it has one. */
export function surveyUrl(origin: string, slug: string, token: string | null): string {
  const base = `${origin.replace(/\/+$/, '')}/x/forms/${encodeURIComponent(slug)}`;
  return token === null ? base : `${base}?t=${token}`;
}
