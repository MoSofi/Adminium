// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Keyed hashes of a carrier key and of the account it opens.
 *
 *  - The KEY's hash ties what a carrier said (test or live) to the exact key
 *    it said it of, so a key changed any other way reads as one nobody checked.
 *  - The ACCOUNT's fingerprint says whether a new key opens the same account.
 *    It hashes the account id when the carrier gives one. Without one, each
 *    key counts as its own account, so a replacement always asks first. The
 *    mode is part of it: one account's test and live sides never pass for each
 *    other, so a test purchase is never looked up under a live key.
 *
 * Both are HMACs with a key derived from `ADMINIUM_SECRET`: a plain hash of a
 * short or known key could be tested offline.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import { deriveKey } from '../config/secrets.js';

const hashKeyOf = (secret: string) => deriveKey(secret, 'adminium:shipping-account:v1', 'account');

function keyed(secret: string, parts: readonly string[]): string {
  return createHmac('sha256', hashKeyOf(secret)).update(JSON.stringify(parts)).digest('hex');
}

const sortedFields = (credentials: Readonly<Record<string, string>>) =>
  Object.entries(credentials)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .flat();

/** The keyed hash of one carrier's saved key fields. */
export function credentialHash(secret: string, carrierKey: string, credentials: Readonly<Record<string, string>>): string {
  return keyed(secret, ['key', carrierKey, ...sortedFields(credentials)]);
}

/** The keyed fingerprint of the account: the carrier's own id for it when it gives one, else the key. */
export function accountFingerprintOf(secret: string, carrierKey: string, mode: 'live' | 'test', said: string | undefined, credentials: Readonly<Record<string, string>>): string {
  return said === undefined ? keyed(secret, ['account-key', carrierKey, mode, ...sortedFields(credentials)]) : keyed(secret, ['account', carrierKey, mode, said]);
}

export function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}
