// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE CUSTOMER KEY — who somebody is, without keeping who.
 *
 * Some things are per customer: one use of an offer each, the members of a
 * group, the holder of a card. To count them a table needs something that is
 * the same for the same person and says nothing to whoever reads the row. A
 * column ruled `customerKey: {of: <address column>}` keeps exactly that: a
 * keyed hash of the address beside it, made by Adminium whenever the address
 * is written, and written by nobody else.
 *
 * The hash is made under a secret of its own, taken from the server's secret
 * for this one purpose, and over the CONNECTION as well as the address: the
 * same person in two databases has two keys, and a key lifted from one tells
 * nothing in the other. The address is compared as every door compares one
 * (`normaliseAddress`: trimmed, in lower case — nothing more).
 *
 * Changing the server's secret changes every key: stored keys then match
 * nobody, and whatever is counted per customer starts again.
 */
import { createHmac, hkdfSync } from 'node:crypto';

import { normaliseAddress } from './claim-code.js';

/** The key the hash is made under: its own derivation from the server's secret. */
export function customerKeySecret(secret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, 'adminium-customer-key-v1', 'customer-key', 32));
}

/** A customer's key in one database: 64 hex characters. */
export function customerKey(secret: Buffer, connectionId: string, address: string): string {
  return createHmac('sha256', secret).update(`${connectionId}\u0000${normaliseAddress(address)}`).digest('hex');
}

/** What a write service is handed: the key of an address in a connection. */
export type CustomerKeyOf = (connectionId: string, address: string) => string;

export const customerKeyOf = (secret: string): CustomerKeyOf => {
  const derived = customerKeySecret(secret);
  return (connectionId, address) => customerKey(derived, connectionId, address);
};

/*
 * ONE SERVER, ONE SECRET, ONE FUNCTION. A write service is built in a dozen
 * places (a save's, an import's, a sample's, the minute job's) from the
 * stores of the meta database, and none of them holds the server's secret.
 * So the server says it once, as it starts, and every service built
 * afterwards finds the function here. A service built before it is said (or
 * in a process that never says it) refuses a write that would make a key: a
 * row saved with no key would be counted as nobody's.
 */
let installed: CustomerKeyOf | null = null;

/** Said once, by the server as it is composed (and by a test that writes a keyed column). */
export function installCustomerKey(secret: string): void {
  installed = customerKeyOf(secret);
}

/** The key of an address, under the secret the server said; a wiring fault when none was. */
export const installedCustomerKey: CustomerKeyOf = (connectionId, address) => {
  if (installed === null) throw new Error('A customer key was asked for before the server said its secret (installCustomerKey).');
  return installed(connectionId, address);
};
