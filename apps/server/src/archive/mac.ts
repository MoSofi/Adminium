// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Signing an archive, and knowing whether a restore may open its secrets.
 *
 * ─── WHICH KEY SIGNS ────────────────────────────────────────────────────────
 * `ADMINIUM_ARCHIVE_KEY` when the operator sets one, otherwise a key derived
 * from `ADMINIUM_SECRET` (HKDF, its own salt and purpose, so it equals no other
 * key the secret makes).
 *
 * The secret alone is not enough, because a restore must be able to go on
 * WITHOUT the old secret (`--drop-secrets`: the secret was lost, or each
 * instance has its own and the operator restores into a new one). A MAC keyed
 * by the old secret could never be checked there, so that path would be either
 * impossible or unsigned. A separate operator key, the same on every instance
 * the operator runs and kept apart from the archives, signs across them.
 *
 * The secret as the default is what makes a plain self-hoster's move need no new
 * variable: moving a server already means carrying `ADMINIUM_SECRET`, or every
 * encrypted connection string stays shut.
 *
 * Only the manifest is signed. It names every other member's size and SHA-256,
 * and the reader checks each member against it, so one MAC covers every byte.
 *
 * ─── THE SECRET CHECK ───────────────────────────────────────────────────────
 * A full archive's encrypted values open only with the same `ADMINIUM_SECRET`.
 * The manifest carries an HMAC that only that secret reproduces, so a restore
 * can refuse a different secret up front instead of booting into an instance
 * whose every connection fails to decrypt.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import { deriveKey } from '../config/secrets.js';
import { ArchiveFormatError, type ArchiveSignature } from './format.js';

export const ARCHIVE_MAC_SALT = 'adminium:archive-mac:v1';
export const ARCHIVE_SECRET_CHECK_SALT = 'adminium:archive-secret-check:v1';
/** Prefixed to the manifest before it is MACed: a signature over one kind of document is no signature over another. */
const MAC_CONTEXT = 'adminium-archive:v1\n';

export type ArchiveKeySource = ArchiveSignature['key'];

export interface ArchiveSigningKey {
  key: Buffer;
  source: ArchiveKeySource;
}

export interface ArchiveKeyEnv {
  ADMINIUM_SECRET: string;
  ADMINIUM_ARCHIVE_KEY?: string | undefined;
}

export function archiveSigningKey(env: ArchiveKeyEnv): ArchiveSigningKey {
  const operatorKey = env.ADMINIUM_ARCHIVE_KEY;
  if (operatorKey !== undefined && operatorKey !== '') {
    return { key: deriveKey(operatorKey, ARCHIVE_MAC_SALT, 'adminium:archive-mac'), source: 'archive-key' };
  }
  return { key: deriveKey(env.ADMINIUM_SECRET, ARCHIVE_MAC_SALT, 'adminium:archive-mac'), source: 'secret' };
}

function mac(key: Uint8Array, manifest: Uint8Array): Buffer {
  return createHmac('sha256', key).update(MAC_CONTEXT).update(manifest).digest();
}

export function signManifest(manifest: Uint8Array, signing: ArchiveSigningKey): ArchiveSignature {
  return { alg: 'HMAC-SHA256', key: signing.source, mac: mac(signing.key, manifest).toString('hex') };
}

/** Throws unless `signature` is this key's MAC over exactly these manifest bytes. */
export function verifyManifest(
  manifest: Uint8Array,
  signature: ArchiveSignature | null,
  signing: ArchiveSigningKey,
): void {
  if (signature === null) {
    throw new ArchiveFormatError(
      'This archive is not signed, so it is refused.',
      'Restore only archives made by `adminium archive create`.',
    );
  }
  const expected = mac(signing.key, manifest);
  const given = Buffer.from(signature.mac, 'hex');
  if (given.length === expected.length && timingSafeEqual(given, expected)) return;
  throw new ArchiveFormatError(
    'This archive was changed after it was made, or it was signed with another key, so it is refused.',
    signature.key === 'archive-key'
      ? 'It was signed with ADMINIUM_ARCHIVE_KEY: set the same ADMINIUM_ARCHIVE_KEY here.'
      : 'It was signed with a key made from ADMINIUM_SECRET: set the same ADMINIUM_SECRET here (or make archives with ADMINIUM_ARCHIVE_KEY set, the same on both servers).',
  );
}

/** An HMAC only the same `ADMINIUM_SECRET` reproduces. Says nothing about the secret itself. */
export function secretCheck(secret: string): string {
  const key = deriveKey(secret, ARCHIVE_SECRET_CHECK_SALT, 'adminium:archive-secret-check');
  return createHmac('sha256', key).update('adminium archive secret check v1').digest('hex');
}

export function sameSecret(check: string, secret: string): boolean {
  const mine = Buffer.from(secretCheck(secret), 'hex');
  const theirs = Buffer.from(check, 'hex');
  return mine.length === theirs.length && timingSafeEqual(mine, theirs);
}
