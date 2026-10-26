// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE UNSUBSCRIBE TOKEN — what every marketing mail's unsubscribe link and
 * its one-click header carry, and what the mail door reads back.
 *
 * A signed, self-contained token, in the shape of the public door's proof
 * (`public-api/proof.ts`): `base64url(JSON payload) ~ HMAC`. Nothing is
 * stored per mail, and it never expires: the law asks a link to work for at
 * least thirty days after the mail (CAN-SPAM), and a person may find an old
 * mail years later. The payload says:
 *   - `i`: this install (`system.instanceId`): a token is read only by the
 *     install that made it, even by another install that shares its secret;
 *   - `p`: the purpose the mail was sent for (`newsletter`, `surveys`), or
 *     none for a mail sent on the "existing customers" basis, whose page has
 *     the one button (the do-not-email list);
 *   - `a`: the address, SEALED (AES-256-GCM under a key of its own). The page
 *     shows the address it unsubscribes, and the do-not-email list keeps a
 *     display copy of it, so the token must carry it; sealed, a link
 *     forwarded or logged does not hand anyone the address in clear;
 *   - `s`: optionally, the send it came in (a campaign ledger row), so the
 *     send log can say "Unsubscribed" on that row;
 *   - `l`: optionally, the language the mail was written in (`de_DE`), so
 *     the page opens in it.
 *
 * The signing key and the sealing key are derived, under salts of their own,
 * from the link key (`link-keys.ts`): taken from the install's address keys,
 * not from `ADMINIUM_SECRET` itself, so a link keeps working after the
 * secret is changed. A token whose signature or seal does not hold, made by
 * another install, or of another version reads as nothing: the door then
 * shows "This link doesn't work" with the business's address.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import type { ConsentPurpose } from '@adminium/meta';

import { deriveKey } from '../config/secrets.js';

/** Where the mail door serves the unsubscribe page and takes the one-click POST. */
export const UNSUBSCRIBE_PATH = '/m/u/';

const SIGN_SALT = 'adminium:unsubscribe-token:sign:v1';
const SEAL_SALT = 'adminium:unsubscribe-token:seal:v1';
const PURPOSES: ReadonlySet<string> = new Set(['newsletter', 'surveys']);
/** The longest token read: a long address sealed, a send id, the signature. */
const TOKEN_MAX = 1024;
const TOKEN = /^([A-Za-z0-9_-]{16,900})~([A-Za-z0-9_-]{43})$/;

/** What a token says. */
export interface UnsubscribeClaim {
  /** As it was sent to: trimmed and in lower case. */
  address: string;
  /** The mail's purpose; null for a mail on the existing-customers basis. */
  purpose: ConsentPurpose | null;
  /** The campaign send (ledger row) it came in, when there is one. */
  send: string | null;
  /** The mail's language (`de_DE`), when it said. */
  language: string | null;
}

interface Payload {
  v: 1;
  i: string;
  p?: string;
  a: string;
  s?: string;
  l?: string;
}

const signKey = (key: string): Buffer => deriveKey(key, SIGN_SALT, 'sign');
const sealKey = (key: string): Buffer => deriveKey(key, SEAL_SALT, 'seal');
/** A language as the token keeps it: `de_DE`, `en_US`. */
const LANGUAGE = /^[a-z]{2,3}_[A-Z]{2}$/;

function sign(key: Buffer, text: string): string {
  return createHmac('sha256', key).update(text).digest('base64url');
}

function seal(key: Buffer, plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

function open(key: Buffer, sealed: string): string | null {
  const bytes = Buffer.from(sealed, 'base64url');
  if (bytes.length < 29) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** A token for one mail to `address`, signed and sealed with the link key `key`. */
export function makeUnsubscribeToken(
  key: string,
  install: string,
  claim: { address: string; purpose: ConsentPurpose | null; send?: string | null | undefined; language?: string | null | undefined },
): string {
  const language = claim.language?.replace('-', '_') ?? '';
  const payload: Payload = {
    v: 1,
    i: install,
    ...(claim.purpose === null ? {} : { p: claim.purpose }),
    a: seal(sealKey(key), claim.address.trim().toLowerCase()),
    ...(claim.send === null || claim.send === undefined ? {} : { s: claim.send }),
    ...(LANGUAGE.test(language) ? { l: language } : {}),
  };
  const text = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${text}~${sign(signKey(key), text)}`;
}

/** What a token says, read with any of `keys` (a link key's every version), or null when none made it. */
export function readUnsubscribeTokenWith(keys: readonly string[], install: string, token: unknown): UnsubscribeClaim | null {
  for (const key of keys) {
    const claim = readUnsubscribeToken(key, install, token);
    if (claim !== null) return claim;
  }
  return null;
}

/** What a token says, or null when it is not one this install made with `key` (or was changed by a single byte). */
export function readUnsubscribeToken(key: string, install: string, token: unknown): UnsubscribeClaim | null {
  if (typeof token !== 'string' || token.length > TOKEN_MAX) return null;
  const match = TOKEN.exec(token);
  if (match === null) return null;
  const [, text = '', signature = ''] = match;
  const want = Buffer.from(sign(signKey(key), text), 'base64url');
  const got = Buffer.from(signature, 'base64url');
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  let payload: Partial<Payload>;
  try {
    payload = JSON.parse(Buffer.from(text, 'base64url').toString('utf8')) as Partial<Payload>;
  } catch {
    return null;
  }
  if (payload.v !== 1 || payload.i !== install || typeof payload.a !== 'string') return null;
  if (payload.p !== undefined && !PURPOSES.has(payload.p)) return null;
  const address = open(sealKey(key), payload.a);
  if (address === null) return null;
  return {
    address,
    purpose: (payload.p as ConsentPurpose | undefined) ?? null,
    send: typeof payload.s === 'string' ? payload.s : null,
    language: typeof payload.l === 'string' && LANGUAGE.test(payload.l) ? payload.l : null,
  };
}

/** The unsubscribe page's address on this server's public origin. */
export function unsubscribeUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}${UNSUBSCRIBE_PATH}${token}`;
}
