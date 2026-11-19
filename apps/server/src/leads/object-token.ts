// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE OBJECT LINK — what a found person's tell mail carries
 * (`{{object_link}}`), and what the Object page reads back.
 *
 * A signed, self-contained token in the unsubscribe token's shape
 * (`email/unsubscribe-token.ts`): `base64url(JSON payload) ~ HMAC`. Nothing
 * is stored per mail, and it never expires: a person may object long after
 * they were told. The payload says:
 *   - `i`: this install (`system.instanceId`): read only by the install that
 *     made it;
 *   - `m`: the add-on's install that found them, `r`: their found
 *     person's row in it, and `t`: when that row says they were found (in
 *     milliseconds). A row id alone may be given again to someone else (a
 *     SQLite table reuses the highest id once its row is deleted): the page
 *     acts only while the row still holds this moment AND this address;
 *   - `a`: the address the mail went to, SEALED (AES-256-GCM under a key of
 *     its own): the page shows it, and a link forwarded or logged does not
 *     hand anyone the address in clear;
 *   - `l`: the language the mail was written in, so the page opens in it.
 *
 * Its keys are derived from the install's address keys under a name of
 * their own (`consent/keys.ts`), as the mail's other links are
 * (`email/link-keys.ts`): an unsubscribe or click token never passes for
 * one, and a link keeps working after the server's secret is changed. A
 * token whose signature or seal does not hold, made by another install, or
 * changed by one byte reads as nothing: the page then says "This link
 * doesn't work". The engine fills the variable itself when the mail goes;
 * no column's value of that name is ever printed in its place.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import type { MetaDb } from '@adminium/meta';

import { deriveKey } from '../config/secrets.js';
import { addressKeyRing } from '../consent/keys.js';

/** Where the mail door serves the Object page. */
export const OBJECT_PATH = '/m/o/';
/** The name a tell mail's template prints the link under. */
export const OBJECT_LINK_VARIABLE = 'object_link';

const KEY_NAME = 'mail-link:object:v1';
const SIGN_SALT = 'adminium:object-token:sign:v1';
const SEAL_SALT = 'adminium:object-token:seal:v1';
const TOKEN_MAX = 1024;
const TOKEN = /^([A-Za-z0-9_-]{16,900})~([A-Za-z0-9_-]{43})$/;
const LANGUAGE = /^[a-z]{2,3}-[A-Z]{2}$/;
const ID = /^[A-Za-z0-9_:-]{1,64}$/;

/** What a token says. */
export interface ObjectClaim {
  /** As the mail went to: trimmed and in lower case. */
  address: string;
  /** The add-on's install that found them. */
  installId: string;
  /** Their found person's row, by its key. */
  found: string;
  /** When that row says they were found, as it reads back (milliseconds). */
  foundAt: number;
  /** The mail's language (`fr-FR`), when it said. */
  language: string | null;
}

interface Payload {
  v: 1;
  i: string;
  m: string;
  r: string;
  t: number;
  a: string;
  l?: string;
}

const signKey = (key: string): Buffer => deriveKey(key, SIGN_SALT, 'sign');
const sealKey = (key: string): Buffer => deriveKey(key, SEAL_SALT, 'seal');
const sign = (key: Buffer, text: string): string => createHmac('sha256', key).update(text).digest('base64url');

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

/** A token for one tell mail, signed and sealed with the link key `key`. */
export function makeObjectToken(key: string, install: string, claim: Omit<ObjectClaim, 'language'> & { language?: string | null | undefined }): string {
  const payload: Payload = {
    v: 1,
    i: install,
    m: claim.installId,
    r: claim.found,
    t: claim.foundAt,
    a: seal(sealKey(key), claim.address.trim().toLowerCase()),
    ...(claim.language !== null && claim.language !== undefined && LANGUAGE.test(claim.language) ? { l: claim.language } : {}),
  };
  const text = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${text}~${sign(signKey(key), text)}`;
}

/** What a token says, or null when it is not one this install made with `key` (or was changed by a single byte). */
export function readObjectToken(key: string, install: string, token: unknown): ObjectClaim | null {
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
  if (typeof payload.m !== 'string' || !ID.test(payload.m) || typeof payload.r !== 'string' || !ID.test(payload.r)) return null;
  if (typeof payload.t !== 'number' || !Number.isSafeInteger(payload.t)) return null;
  const address = open(sealKey(key), payload.a);
  if (address === null) return null;
  return { address, installId: payload.m, found: payload.r, foundAt: payload.t, language: typeof payload.l === 'string' && LANGUAGE.test(payload.l) ? payload.l : null };
}

/** The keys an Object link is made and read with: the newest, and every version there is. */
export function objectLinkKeys(meta: MetaDb, secret: string): { write(): Promise<string>; all(): Promise<string[]> } {
  const ring = addressKeyRing(meta, secret);
  return { write: () => ring.derivedForWrite(KEY_NAME), all: () => ring.derivedAll(KEY_NAME) };
}

/** What a token says, read with any of the link's key versions; null when none made it. */
export async function readObjectLink(meta: MetaDb, secret: string, install: string, token: unknown): Promise<ObjectClaim | null> {
  for (const key of await objectLinkKeys(meta, secret).all()) {
    const claim = readObjectToken(key, install, token);
    if (claim !== null) return claim;
  }
  return null;
}

/** The Object page's address on this server's public origin. */
export function objectUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}${OBJECT_PATH}${token}`;
}
