// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE MARKETING TEXT CONFIRM TOKEN: what the confirmation mail's link carries
 * (`/m/t/<token>`).
 *
 * Signed and self-contained, in the shape of the sign-up confirm token
 * (`forms/confirm-token.ts`): `base64url(JSON payload) ~ HMAC`, under a key of
 * its own derived from `ADMINIUM_SECRET`. The payload names this install
 * (`i`), the request it answers (`c`, a row of `adminium_text_confirmations`)
 * and when it was made (`t`). Nothing about the person rides in it: not the
 * number, not the address. The page reads what it shows from the request, so
 * a request erased leaves the link saying nothing about anyone.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import { deriveKey } from '../../config/secrets.js';

/** Where the mail door serves the page. */
export const TEXT_CONFIRM_PATH = '/m/t/';
/** How long a link works. */
export const TEXT_CONFIRM_DAYS = 30;
export const TEXT_CONFIRM_MS = TEXT_CONFIRM_DAYS * 24 * 60 * 60_000;

const SIGN_SALT = 'adminium:text-marketing-confirm:sign:v1';
const TOKEN_MAX = 512;
const TOKEN = /^([A-Za-z0-9_-]{16,400})~([A-Za-z0-9_-]{43})$/;

export interface TextConfirmClaim {
  confirmation: string;
  issuedAt: number;
}

interface Payload {
  v: 1;
  i: string;
  c: string;
  t: number;
}

export function textConfirmKey(secret: string): Buffer {
  return deriveKey(secret, SIGN_SALT, 'sign');
}

const sign = (key: Buffer, text: string): string => createHmac('sha256', key).update(text).digest('base64url');

export function makeTextConfirmToken(key: Buffer, install: string, claim: TextConfirmClaim): string {
  const payload: Payload = { v: 1, i: install, c: claim.confirmation, t: claim.issuedAt };
  const text = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${text}~${sign(key, text)}`;
}

/** What a token says, or null when this install did not make it with `key` (or it was changed by one byte). */
export function readTextConfirmToken(key: Buffer, install: string, token: unknown): TextConfirmClaim | null {
  if (typeof token !== 'string' || token.length > TOKEN_MAX) return null;
  const match = TOKEN.exec(token);
  if (match === null) return null;
  const [, text = '', signature = ''] = match;
  // Compared as written, not as decoded: base64url's last character carries spare bits.
  const want = Buffer.from(sign(key, text), 'utf8');
  const got = Buffer.from(signature, 'utf8');
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  let payload: Partial<Payload>;
  try {
    payload = JSON.parse(Buffer.from(text, 'base64url').toString('utf8')) as Partial<Payload>;
  } catch {
    return null;
  }
  if (payload.v !== 1 || payload.i !== install || typeof payload.c !== 'string' || payload.c === '' || typeof payload.t !== 'number' || !Number.isFinite(payload.t)) return null;
  return { confirmation: payload.c, issuedAt: payload.t };
}

export function textConfirmLive(issuedAt: number, now: number): boolean {
  return now - issuedAt <= TEXT_CONFIRM_MS;
}

export function textConfirmUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}${TEXT_CONFIRM_PATH}${token}`;
}
