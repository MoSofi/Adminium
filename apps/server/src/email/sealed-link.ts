// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A LINK THAT CARRIES ITS OWN FACTS, SEALED: a review link, a calendar feed.
 *
 * AES-256-GCM under a key of its own for each kind of link, from the install's
 * link keys (`link-keys.ts`), so a link outlives a change of the server's
 * secret and one kind can never pass for another. Nothing is stored per link,
 * and whoever holds one reads nothing out of it: not the row it opens, nor the
 * address it was sent to.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { deriveKey } from '../config/secrets.js';

const TOKEN = /^[A-Za-z0-9_-]{40,1600}$/;

const keyOf = (key: string, kind: string): Buffer => deriveKey(key, `adminium:sealed-link:${kind}:v1`, 'seal');

/** A sealed link's token for one claim. */
export function sealLink(key: string, kind: string, claim: Readonly<Record<string, unknown>>): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyOf(key, kind), iv);
  cipher.setAAD(Buffer.from(kind));
  const body = Buffer.concat([cipher.update(JSON.stringify(claim), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

/** What a token says, read with any of `keys`; null when none of them sealed it, or a byte of it changed. */
export function openLink(keys: readonly string[], kind: string, token: unknown): Record<string, unknown> | null {
  if (typeof token !== 'string' || !TOKEN.test(token)) return null;
  const bytes = Buffer.from(token, 'base64url');
  // One token, one spelling: base64's spare last bits must not make a second link that opens the same claim.
  if (bytes.length < 29 || bytes.toString('base64url') !== token) return null;
  for (const key of keys) {
    try {
      const decipher = createDecipheriv('aes-256-gcm', keyOf(key, kind), bytes.subarray(0, 12));
      decipher.setAAD(Buffer.from(kind));
      decipher.setAuthTag(bytes.subarray(12, 28));
      const plain = Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
      const parsed = JSON.parse(plain) as unknown;
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      // Not this key's: the next.
    }
  }
  return null;
}
