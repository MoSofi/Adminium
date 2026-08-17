// SPDX-License-Identifier: AGPL-3.0-only
/**
 * DSN encryption closures (01-architecture.md §3/§7.1): AES-256-GCM with an
 * HKDF key derived from `ADMINIUM_SECRET`, purpose-scoped so DSN, TOTP, and
 * session keys never coincide. `@adminium/meta` receives only these
 * closures — the meta store stays crypto-agnostic.
 */

import type { DsnCrypto } from '@adminium/meta';

import { decryptSecret, deriveKey, encryptSecret } from '../config/secrets.js';

const DSN_KEY_SALT = 'adminium:dsn:v1';

/**
 * A stored connection DSN will not decrypt under the current ADMINIUM_SECRET.
 *
 * WHY THIS DESERVES ITS OWN ERROR — the same argument as
 * {@link MetaSecretMismatchError} in `meta/store.ts`, which solves this for the
 * bootstrap file. The underlying failure is a `SecretIntegrityError` reading
 * "decryption failed — token was tampered with or the key is wrong": true, and
 * unactionable. It names no connection, no variable, and no way out.
 *
 * It is also just as likely here as it is there, and far more confusing when it
 * happens. Nothing surfaces at connect time — the connection row still says
 * `status: 'connected'` from whenever it last worked. The failure appears later
 * and sideways: every widget on a dashboard renders "The widget query failed",
 * every CRUD page comes up empty, and nothing anywhere mentions a secret. A
 * connection created under one ADMINIUM_SECRET and read back under another is
 * exactly the shape of "I re-ran the quickstart in a new terminal".
 */
export class DsnSecretMismatchError extends Error {
  override readonly name = 'DsnSecretMismatchError';
  constructor(cause?: unknown) {
    super(
      "This connection's stored credentials were encrypted with a different ADMINIUM_SECRET " +
        'and cannot be read back.\n' +
        '\n' +
        'The connection string is stored encrypted, keyed on the ADMINIUM_SECRET that was set\n' +
        'when the connection was created. The current one does not match, so Adminium cannot\n' +
        'open the database — pages and dashboards bound to it will fail to load any data.\n' +
        '\n' +
        'Either:\n' +
        '  • set ADMINIUM_SECRET back to the value used when this connection was created, or\n' +
        '  • delete this connection and create it again with the current secret.\n' +
        '\n' +
        'Note that `openssl rand -hex 32` produces a new value every time you run it, so a\n' +
        're-run quickstart in a fresh terminal is the usual cause. Your database is untouched\n' +
        'either way — only Adminium’s stored copy of the connection string is unreadable.',
      cause === undefined ? undefined : { cause },
    );
  }
}

export function dsnCryptoFromSecret(masterSecret: string): DsnCrypto {
  const key = deriveKey(masterSecret, DSN_KEY_SALT);
  return {
    encrypt: (plaintext) => encryptSecret(plaintext, key),
    // Wrapped here rather than at each call site: `getDsns` feeds the data
    // handle, the introspect adapter, the test route, backups and the desktop
    // handlers, and every one of them wants the same explanation.
    decrypt: (token) => {
      try {
        return decryptSecret(token, key);
      } catch (error) {
        throw new DsnSecretMismatchError(error);
      }
    },
  };
}
