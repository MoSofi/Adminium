// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Add-on credential encryption closures (26-add-on-runtime.md §4, 26-T04).
 *
 * The exact shape `connections/crypto.ts` uses for DSNs, and for the same
 * reason: `@adminium/meta` stays crypto-agnostic and receives only closures, so
 * no key material crosses into the store layer (01-architecture.md §3/§7.1).
 *
 * ─── Its own salt, and why that is not a formality ─────────────────────────
 *
 * `deriveKey`'s `info`/salt parameters exist to keep purposes apart, and a
 * credential is a different purpose from a DSN in a way that matters: a DSN
 * opens the operator's OWN database, while this opens a THIRD PARTY's API on
 * the operator's behalf. Sharing a key would mean one derived secret unlocks
 * both, so a leak of either is a leak of both, and rotating one to contain an
 * incident would silently invalidate the other.
 *
 * `'adminium:addon-cred:v1'` is therefore a new salt, never
 * `'adminium:dsn:v1'`.
 *
 * ─── The mismatch error is its own type, for the same reason DSNs got one ──
 *
 * A credential that will not decrypt under the current `ADMINIUM_SECRET`
 * surfaces exactly the way a DSN one did: nothing at connect time, because the
 * manifest row still says installed — and then every call the add-on makes
 * fails, with nothing anywhere mentioning a secret. The underlying
 * `SecretIntegrityError` says "decryption failed — token was tampered with or
 * the key is wrong", which is true and unactionable.
 *
 * The remedy differs from the DSN case in one way worth stating in the message:
 * a credential can simply be re-entered. Nobody has to delete anything, and no
 * data is at risk — which is a much better answer than the DSN error can offer,
 * and the operator should hear it.
 */

import type { CredentialCrypto } from '@adminium/meta';

import { decryptSecret, deriveKey, encryptSecret } from '../config/secrets.js';

/** Never `'adminium:dsn:v1'` — see the header. */
const ADD_ON_CREDENTIAL_KEY_SALT = 'adminium:addon-cred:v1';

/** A stored add-on credential will not decrypt under the current secret. */
export class AddOnCredentialSecretMismatchError extends Error {
  override readonly name = 'AddOnCredentialSecretMismatchError';
  constructor(cause?: unknown) {
    super(
      "This add-on's stored credentials were encrypted with a different ADMINIUM_SECRET " +
        'and cannot be read back.\n' +
        '\n' +
        'The API key or access token you gave this add-on is stored encrypted, keyed on the\n' +
        'ADMINIUM_SECRET that was set when you connected it. The current one does not match,\n' +
        'so Adminium cannot use the credential and every call the add-on makes will fail.\n' +
        '\n' +
        'Either:\n' +
        '  • set ADMINIUM_SECRET back to the value used when the add-on was connected, or\n' +
        '  • disconnect the add-on and connect it again with the current secret.\n' +
        '\n' +
        'Reconnecting is safe: disconnecting an add-on deletes its keys and keeps every table\n' +
        'and every row it brought with it. Nothing you have stored is affected.',
      cause === undefined ? undefined : { cause },
    );
  }
}

export function addOnCredentialCryptoFromSecret(masterSecret: string): CredentialCrypto {
  const key = deriveKey(masterSecret, ADD_ON_CREDENTIAL_KEY_SALT);
  return {
    encrypt: (plaintext) => encryptSecret(plaintext, key),
    decrypt: (token) => {
      try {
        return decryptSecret(token, key);
      } catch (error) {
        throw new AddOnCredentialSecretMismatchError(error);
      }
    },
  };
}
