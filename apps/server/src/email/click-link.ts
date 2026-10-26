// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SIGNED CLICK LINKS — counting clicks on a marketing send, never an open
 * redirect.
 *
 * Off by default, and only ever on for a send whose own switch says so (plan
 * D13: no per-person open tracking at all, and clicks only when asked). With
 * it on, each `https://` or `http://` link of the mail's body is replaced by a
 * link to this server that carries a signed token: `base64url(JSON {v, t, s})
 * ~ HMAC`, an HMAC over the target and the send. The redirect route reads the
 * token with {@link readClickLink} and goes ONLY to the target the token
 * signs: a token changed by one byte, an unsigned target, or a target that is
 * not a web address is refused, so nobody can make this server send a person
 * anywhere it did not put in a mail itself.
 *
 * The route itself lives with the mail door (under `/m/`, `CLICK_PATH`); this
 * module is what it calls, and what the sending side calls to write the links.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import { deriveKey } from '../config/secrets.js';

/** Where the mail door's redirect answers. */
export const CLICK_PATH = '/m/l/';

const SALT = 'adminium:click-link:v1';
const TOKEN_MAX = 4096;
const TOKEN = /^([A-Za-z0-9_-]{8,4000})~([A-Za-z0-9_-]{43})$/;

/** What a click token says: where it goes, and the send it came in. */
export interface ClickClaim {
  target: string;
  send: string;
}

const keyOf = (secret: string): Buffer => deriveKey(secret, SALT, 'click');
const sign = (key: Buffer, text: string): string => createHmac('sha256', key).update(text).digest('base64url');

/** A web address a mail may link to: `https:` or `http:`, absolute, no credentials. */
function webTarget(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2000) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username !== '' || url.password !== '') return null;
  return url.toString();
}

/** A signed token for a link to `target` in the send `send`; null when the target is no web address. */
export function signClickLink(secret: string, claim: ClickClaim): string | null {
  const target = webTarget(claim.target);
  if (target === null) return null;
  const text = Buffer.from(JSON.stringify({ v: 1, t: target, s: claim.send })).toString('base64url');
  return `${text}~${sign(keyOf(secret), text)}`;
}

/** Where a click token leads, or null for anything this server did not sign as it is. */
export function readClickLink(secret: string, token: unknown): ClickClaim | null {
  if (typeof token !== 'string' || token.length > TOKEN_MAX) return null;
  const match = TOKEN.exec(token);
  if (match === null) return null;
  const [, text = '', signature = ''] = match;
  const want = Buffer.from(sign(keyOf(secret), text), 'base64url');
  const got = Buffer.from(signature, 'base64url');
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  let payload: { v?: unknown; t?: unknown; s?: unknown };
  try {
    payload = JSON.parse(Buffer.from(text, 'base64url').toString('utf8')) as typeof payload;
  } catch {
    return null;
  }
  const target = webTarget(payload.t);
  if (payload.v !== 1 || target === null || typeof payload.s !== 'string') return null;
  return { target, send: payload.s };
}

/** A click link on this server's public origin. */
export function clickUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}${CLICK_PATH}${token}`;
}

/**
 * The mail's HTML with each web link (`href="http…"`) replaced by a signed
 * click link. `keep` names links left as they are (the unsubscribe link: a
 * person must reach it without passing through a count).
 */
export function withClickLinks(html: string, input: { secret: string; origin: string; send: string; keep?: (href: string) => boolean }): string {
  return html.replace(/href="(https?:\/\/[^"]*)"/g, (whole, raw: string) => {
    const href = raw.replaceAll('&amp;', '&');
    if (input.keep?.(href) === true) return whole;
    const token = signClickLink(input.secret, { target: href, send: input.send });
    return token === null ? whole : `href="${clickUrl(input.origin, token)}"`;
  });
}
