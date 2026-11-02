// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE SIGN-UP CONFIRM TOKEN — what a confirmation mail's link carries
 * (`/m/c/<token>`), and what the mail door reads back.
 *
 * Signed and self-contained, in the shape of the unsubscribe token
 * (`email/unsubscribe-token.ts`): `base64url(JSON payload) ~ HMAC`. Nothing is
 * stored per mail: the sign-up that waits for the click is the answer row
 * itself (its `confirm` is `pending`, with the purpose, the wording, its
 * version, the network address and the browser). The payload names:
 *   - `i`: this install (`system.instanceId`): read only by the install that made it;
 *   - `a`: the forms add-on, `f`: the form's row, `r`: the answer's row;
 *   - `p`: the purpose the tick asked for (`newsletter`, `surveys`);
 *   - `t`: when it was made (epoch ms). It works for {@link CONFIRM_LINK_DAYS}
 *     days after that, and then says "too old".
 * No address: the page reads it from the answer, so an answer erased leaves
 * the link saying nothing about anyone.
 *
 * Signed with a key of its own, derived from `ADMINIUM_SECRET` under its own
 * salt. A token changed by one byte, made by another install or under
 * another secret reads as nothing ("This link doesn't work").
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import { deriveKey } from '../config/secrets.js';

/** Where the mail door serves the confirm page. */
export const CONFIRM_PATH = '/m/c/';
/** How long a confirm link works. */
export const CONFIRM_LINK_DAYS = 30;
export const CONFIRM_LINK_MS = CONFIRM_LINK_DAYS * 24 * 60 * 60_000;

const SIGN_SALT = 'adminium:sign-up-confirm:sign:v1';
const PURPOSES: ReadonlySet<string> = new Set(['newsletter', 'surveys']);
/** The longest token read. */
const TOKEN_MAX = 1024;
const TOKEN = /^([A-Za-z0-9_-]{16,900})~([A-Za-z0-9_-]{43})$/;

/** What a confirm token says. */
export interface ConfirmClaim {
  addOn: string;
  form: string;
  answer: string;
  purpose: 'newsletter' | 'surveys';
  /** When it was made, epoch ms. */
  issuedAt: number;
}

interface Payload {
  v: 1;
  i: string;
  a: string;
  f: string;
  r: string;
  p: string;
  t: number;
}

/** The key confirm tokens are signed under. */
export function confirmKey(secret: string): Buffer {
  return deriveKey(secret, SIGN_SALT, 'sign');
}

function sign(key: Buffer, text: string): string {
  return createHmac('sha256', key).update(text).digest('base64url');
}

/** A token for one waiting sign-up. */
export function makeConfirmToken(key: Buffer, install: string, claim: ConfirmClaim): string {
  const payload: Payload = { v: 1, i: install, a: claim.addOn, f: claim.form, r: claim.answer, p: claim.purpose, t: claim.issuedAt };
  const text = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${text}~${sign(key, text)}`;
}

/** What a token says, or null when this install did not make it with `key` (or it was changed by one byte). */
export function readConfirmToken(key: Buffer, install: string, token: unknown): ConfirmClaim | null {
  if (typeof token !== 'string' || token.length > TOKEN_MAX) return null;
  const match = TOKEN.exec(token);
  if (match === null) return null;
  const [, text = '', signature = ''] = match;
  // Compared as written, not as decoded: base64url's last character carries spare bits, and a link changed there must not read.
  const want = Buffer.from(sign(key, text), 'utf8');
  const got = Buffer.from(signature, 'utf8');
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  let payload: Partial<Payload>;
  try {
    payload = JSON.parse(Buffer.from(text, 'base64url').toString('utf8')) as Partial<Payload>;
  } catch {
    return null;
  }
  if (payload.v !== 1 || payload.i !== install) return null;
  if (typeof payload.a !== 'string' || typeof payload.f !== 'string' || typeof payload.r !== 'string' || typeof payload.t !== 'number' || !Number.isFinite(payload.t)) return null;
  if (typeof payload.p !== 'string' || !PURPOSES.has(payload.p)) return null;
  return { addOn: payload.a, form: payload.f, answer: payload.r, purpose: payload.p as ConfirmClaim['purpose'], issuedAt: payload.t };
}

/** Whether a link made at `issuedAt` still works at `now`. */
export function confirmLinkLive(issuedAt: number, now: number): boolean {
  return now - issuedAt <= CONFIRM_LINK_MS;
}

/** The confirm page's address on this server's public origin. */
export function confirmUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}${CONFIRM_PATH}${token}`;
}
