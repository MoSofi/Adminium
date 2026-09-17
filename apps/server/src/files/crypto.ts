// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Storage-credential encryption closures.
 *
 * The connection-DSN pattern verbatim (`connections/crypto.ts`), with ONE
 * deliberate difference: a different HKDF salt. `adminium:dsn:v1` and
 * `adminium:storage:v1` derive different keys from the same
 * `ADMINIUM_SECRET`, so a bucket credential and a database connection string
 * are never encrypted under the same key — which is what makes "this token
 * came out of the destinations table" a fact about scope, not just about
 * provenance.
 */

import type { DsnCrypto } from '@adminium/meta';

import { decryptSecret, deriveKey, encryptSecret } from '../config/secrets.js';

const STORAGE_KEY_SALT = 'adminium:storage:v1';

/**
 * A stored destination credential will not decrypt under the current
 * ADMINIUM_SECRET.
 *
 * Its own error for the same reason `DsnSecretMismatchError` has one: the
 * underlying `SecretIntegrityError` reads "decryption failed — token was
 * tampered with or the key is wrong", which is true, unactionable, and names
 * nothing the operator can look at.
 *
 * The failure mode here is quieter than the DSN one and therefore worse to
 * diagnose. The destination row still says `status: 'ok'` from whenever it was
 * last tested. Nothing surfaces at boot. What the operator sees is uploads
 * failing to one destination while the rest of the instance is healthy — and
 * on a store whose default destination is the broken one, every NEW file of
 * every kind fails while every existing file still downloads fine, because
 * reads of files already on the local disk never touch this key.
 */
export class StorageSecretMismatchError extends Error {
  override readonly name = 'StorageSecretMismatchError';
  constructor(cause?: unknown) {
    super(
      "This storage destination's stored credentials were encrypted with a different " +
        'ADMINIUM_SECRET and cannot be read back.\n' +
        '\n' +
        'Access keys and passwords for a destination are stored encrypted, keyed on the\n' +
        'ADMINIUM_SECRET that was set when the destination was saved. The current one does\n' +
        'not match, so Adminium cannot sign a request to it — uploads sent there will fail\n' +
        'and files already stored there cannot be read back.\n' +
        '\n' +
        'Either:\n' +
        '  • set ADMINIUM_SECRET back to the value used when this destination was saved, or\n' +
        '  • open Studio → Storage and enter the credentials again.\n' +
        '\n' +
        'Files on this server’s own disk are unaffected — they need no credential. Nothing\n' +
        'in the remote bucket or server has been changed; only Adminium’s stored copy of\n' +
        'the credentials is unreadable.',
      cause === undefined ? undefined : { cause },
    );
  }
}

export function storageCryptoFromSecret(masterSecret: string): DsnCrypto {
  const key = deriveKey(masterSecret, STORAGE_KEY_SALT);
  return {
    encrypt: (plaintext) => encryptSecret(plaintext, key),
    decrypt: (token) => {
      try {
        return decryptSecret(token, key);
      } catch (error) {
        throw new StorageSecretMismatchError(error);
      }
    },
  };
}
